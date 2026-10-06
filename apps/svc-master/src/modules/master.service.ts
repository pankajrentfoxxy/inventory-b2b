/**
 * Master data domain (phase-03). All tenant operations run under the RLS tenant context; every
 * write emits an audit event and, for replicated entities (products, warehouses, bins, grades), a
 * domain event carrying the full snapshot + version so consumers never call back.
 */
import { EVENT_TYPES, LAPTOP_SPEC_FIELDS, type LaptopSpecKind, type LaptopSpecs, type ProductSnapshot, type WarehouseSnapshot } from '@b2b/contracts';
import { HttpError, businessRuleError, conflict, decodeCursor, encodeCursor, enqueueEvent, forbidden, inWarehouseScope, notFound, setTenantContext, uuidv7, type TenantContext } from '@b2b/platform-kit';
import type { Prisma, PrismaClient, Tx } from '../db.js';
import { DEFAULT_GRADES, DEFAULT_LAPTOP_SPECS, DEFAULT_NUMBERING, DEFAULT_PAYMENT_TERMS, DEFAULT_TAX_RATES, DEFAULT_UNITS, DOC_TYPES, type DocType } from './defaults.js';
import type { LaptopInput, LaptopPatch, LaptopSpecIds, ProductInput, SpecOptionInput } from './master.schema.js';

/** Product columns holding the eight laptop spec ids, keyed like LaptopSpecIds. */
const SPEC_COLUMNS: Record<keyof LaptopSpecIds, { kind: LaptopSpecKind; column: string; key: keyof LaptopSpecs }> = {
  brandId: { kind: 'BRAND', column: 'brandSpecId', key: 'brand' },
  modelId: { kind: 'MODEL', column: 'modelSpecId', key: 'model' },
  generationId: { kind: 'GENERATION', column: 'generationSpecId', key: 'generation' },
  processorId: { kind: 'PROCESSOR', column: 'processorSpecId', key: 'processor' },
  ramId: { kind: 'RAM', column: 'ramSpecId', key: 'ram' },
  ssdId: { kind: 'SSD', column: 'ssdSpecId', key: 'ssd' },
  gpuId: { kind: 'GPU', column: 'gpuSpecId', key: 'gpu' },
  screenSizeId: { kind: 'SCREEN_SIZE', column: 'screenSizeSpecId', key: 'screenSize' },
};
const SPEC_ID_KEYS = Object.keys(SPEC_COLUMNS) as (keyof LaptopSpecIds)[];

/** Letters and digits only, upper case; RAM / SSD drop a trailing GB so "16 GB" becomes 16. */
export function deriveSpecCode(kind: LaptopSpecKind, name: string): string {
  let code = name.toUpperCase().split('').filter((c) => (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')).join('');
  if ((kind === 'RAM' || kind === 'SSD') && code.endsWith('GB') && code.length > 2) code = code.slice(0, -2);
  return (code || 'X').slice(0, 20);
}

interface LaptopColumns {
  brandSpecId: string; modelSpecId: string; generationSpecId: string; processorSpecId: string; ramSpecId: string; ssdSpecId: string; gpuSpecId: string; screenSizeSpecId: string;
  specs: LaptopSpecs;
  configKey: string;
}

export const PRODUCER = 'svc-master';

export interface Actor {
  userId: string | null;
  name: string | null;
  correlationId: string;
}
export const actorFrom = (ctx: TenantContext): Actor => ({ userId: ctx.userId, name: ctx.userName, correlationId: ctx.correlationId });

/** Phase 4 seam: does svc-inventory know movements for this item? Before Phase 4: never. */
export interface MovementSource {
  hasMovements(tenantId: string, itemId: string): Promise<boolean>;
}
export const noMovements: MovementSource = { hasMovements: async () => false };

type ProductRow = Prisma.ProductGetPayload<{ include: { unit: true; hsn: true; taxRate: true } }>;
const productInclude = { unit: true, hsn: true, taxRate: true } as const;

const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; meta?: { code?: string } };
  return e?.code === 'P2002' || (e?.code === 'P2010' && e.meta?.code === '23505');
};

export class MasterService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly movements: MovementSource,
  ) {}

  tx<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, tenantId);
      return fn(tx);
    }, { maxWait: 15_000, timeout: 30_000 });
  }

  private async audit(tx: Tx, tenantId: string, actor: Actor, entry: { action: string; entityType: string; entityId: string; summary?: string; oldValue?: unknown; newValue?: unknown; version?: number | null }) {
    await enqueueEvent(tx, PRODUCER, {
      eventType: EVENT_TYPES.AUDIT_RECORDED,
      tenantId,
      aggregate: { type: entry.entityType.toLowerCase(), id: entry.entityId, version: entry.version ?? null },
      actor: { type: actor.userId ? 'user' : 'system', id: actor.userId, name: actor.name },
      correlationId: actor.correlationId,
      payload: { action: entry.action, entityType: entry.entityType, entityId: entry.entityId, summary: entry.summary ?? null, oldValue: entry.oldValue ?? null, newValue: entry.newValue ?? null, actorName: actor.name },
    });
  }

  /* ---- seeding (tenant.activated) ---------------------------------------- */

  async seedTenant(tx: Tx, tenantId: string, input: { stateCode: string | null; address: Record<string, unknown> | null; correlationId: string }): Promise<void> {
    for (const u of DEFAULT_UNITS) {
      const exists = await tx.unit.findFirst({ where: { tenantId, code: u.code } });
      if (!exists) await tx.unit.create({ data: { id: uuidv7(), tenantId, ...u } });
    }
    for (const t of DEFAULT_TAX_RATES) {
      const exists = await tx.taxRate.findFirst({ where: { tenantId, name: t.name } });
      if (!exists) await tx.taxRate.create({ data: { id: uuidv7(), tenantId, name: t.name, gstRate: t.gstRate, effectiveFrom: new Date('2017-07-01') } });
    }
    for (const p of DEFAULT_PAYMENT_TERMS) {
      const exists = await tx.paymentTerm.findFirst({ where: { tenantId, name: p.name } });
      if (!exists) await tx.paymentTerm.create({ data: { id: uuidv7(), tenantId, name: p.name, days: p.days, isDefault: p.isDefault ?? false } });
    }
    for (const g of DEFAULT_GRADES) {
      const exists = await tx.conditionGrade.findFirst({ where: { tenantId, code: g.code } });
      if (!exists) await tx.conditionGrade.create({ data: { id: uuidv7(), tenantId, ...g } });
    }
    await this.seedLaptopSpecs(tx, tenantId);
    for (const docType of DOC_TYPES) {
      await tx.numberingConfig.upsert({ where: { tenantId_docType: { tenantId, docType } }, update: {}, create: { tenantId, docType, ...DEFAULT_NUMBERING[docType] } });
    }
    const hasWarehouse = await tx.warehouse.count({ where: { tenantId } });
    if (hasWarehouse === 0) {
      const stateCode = input.stateCode && input.stateCode.length === 2 ? input.stateCode : '27';
      const address = input.address ?? { line1: 'Registered office', city: '', stateCode, pincode: '', country: 'IN' };
      const wh = await tx.warehouse.create({ data: { id: uuidv7(), tenantId, code: 'MAIN', name: 'Main Warehouse', address: address as Prisma.InputJsonValue, stateCode, isDefault: true, status: 'ACTIVE' } });
      await tx.location.create({ data: { id: uuidv7(), tenantId, warehouseId: wh.id, code: 'STORE', name: 'Storage', purpose: 'STORAGE' } });
      await this.emitWarehouse(tx, tenantId, EVENT_TYPES.MASTER_WAREHOUSE_CREATED, wh.id, { userId: null, name: 'system', correlationId: input.correlationId });
    }
    await this.emitGrades(tx, tenantId, { userId: null, name: 'system', correlationId: input.correlationId });
  }

  /** Idempotent: adds the default laptop spec values a tenant does not have yet. */
  async seedLaptopSpecs(tx: Tx, tenantId: string): Promise<number> {
    let added = 0;
    for (const [i, s] of DEFAULT_LAPTOP_SPECS.entries()) {
      const exists = await tx.laptopSpecOption.findFirst({ where: { tenantId, kind: s.kind, name: { equals: s.name, mode: 'insensitive' } } });
      if (exists) continue;
      await tx.laptopSpecOption.create({ data: { id: uuidv7(), tenantId, kind: s.kind, name: s.name, code: s.code, sortOrder: i } });
      added += 1;
    }
    return added;
  }

  /* ---- products ------------------------------------------------------------ */

  snapshot(p: ProductRow): ProductSnapshot {
    return { id: p.id, tenantId: p.tenantId, sku: p.sku, name: p.name, type: p.type as 'GOODS' | 'SERVICE', trackInventory: p.trackInventory, isSerialized: p.isSerialized, requiresImei: p.requiresImei, serialPattern: p.serialPattern, qcRequired: p.qcRequired, unitCode: p.unit.code, hsnCode: p.hsn?.code ?? null, taxRate: p.taxRate ? Number(p.taxRate.gstRate) : null, status: p.status, version: p.version, specs: (p.specs as LaptopSpecs | null) ?? null };
  }

  serializeProduct(p: ProductRow) {
    const specIds = p.configKey ? { brandId: p.brandSpecId, modelId: p.modelSpecId, generationId: p.generationSpecId, processorId: p.processorSpecId, ramId: p.ramSpecId, ssdId: p.ssdSpecId, gpuId: p.gpuSpecId, screenSizeId: p.screenSizeSpecId } : null;
    return { ...this.snapshot(p), isLaptop: Boolean(p.configKey), specIds, description: p.description, categoryId: p.categoryId, brandId: p.brandId, unitId: p.unitId, hsnId: p.hsnId, taxRateId: p.taxRateId, defaultWarrantyId: p.defaultWarrantyId, purchasePrice: p.purchasePrice === null ? null : Number(p.purchasePrice), sellingPrice: p.sellingPrice === null ? null : Number(p.sellingPrice), reorderLevel: p.reorderLevel === null ? null : Number(p.reorderLevel), attributes: p.attributes, customFields: p.customFields, createdAt: p.createdAt, updatedAt: p.updatedAt };
  }

  private validateProductRules(p: { type: string; trackInventory: boolean; isSerialized: boolean; requiresImei: boolean }) {
    const problems: { path: string; message: string }[] = [];
    if (p.type === 'SERVICE' && (p.trackInventory || p.isSerialized)) problems.push({ path: 'trackInventory', message: 'Services cannot track inventory or be serialized' });
    if (p.isSerialized && !p.trackInventory) problems.push({ path: 'isSerialized', message: 'Serialized items must track inventory' });
    if (p.requiresImei && !p.isSerialized) problems.push({ path: 'requiresImei', message: 'IMEI capture requires a serialized item' });
    if (problems.length) throw businessRuleError('MASTER_RULE_VIOLATION', 'Product settings are inconsistent', problems);
  }

  private async validateRefs(tx: Tx, tenantId: string, p: Partial<ProductInput>) {
    const problems: { path: string; message: string }[] = [];
    if (p.unitId !== undefined) {
      const unit = await tx.unit.findFirst({ where: { id: p.unitId, tenantId, status: 'ACTIVE' } });
      if (!unit) problems.push({ path: 'unitId', message: 'Select a valid unit' });
    }
    const check = async (id: string | null | undefined, path: string, find: () => Promise<unknown>) => {
      if (!id) return;
      if (!(await find())) problems.push({ path, message: `Select a valid ${path.replace('Id', '')}` });
    };
    await check(p.categoryId, 'categoryId', () => tx.category.findFirst({ where: { id: p.categoryId!, tenantId } }));
    await check(p.brandId, 'brandId', () => tx.brand.findFirst({ where: { id: p.brandId!, tenantId } }));
    await check(p.hsnId, 'hsnId', () => tx.hsnCode.findFirst({ where: { id: p.hsnId!, tenantId } }));
    await check(p.taxRateId, 'taxRateId', () => tx.taxRate.findFirst({ where: { id: p.taxRateId!, tenantId } }));
    await check(p.defaultWarrantyId, 'defaultWarrantyId', () => tx.warrantyPolicy.findFirst({ where: { id: p.defaultWarrantyId!, tenantId } }));
    if (problems.length) throw businessRuleError('VALIDATION_FAILED', 'Please fix the highlighted fields', problems);
  }

  private async emitProduct(tx: Tx, tenantId: string, type: string, id: string, actor: Actor) {
    const p = await tx.product.findUniqueOrThrow({ where: { id }, include: productInclude });
    await enqueueEvent(tx, PRODUCER, { eventType: type, tenantId, aggregate: { type: 'product', id, version: p.version }, actor: { type: actor.userId ? 'user' : 'system', id: actor.userId, name: actor.name }, correlationId: actor.correlationId, payload: this.snapshot(p) as unknown as Record<string, unknown> });
    return p;
  }

  async createProduct(tenantId: string, actor: Actor, input: ProductInput) {
    return this.tx(tenantId, (tx) => this.createProductIn(tx, tenantId, actor, input));
  }

  private async createProductIn(tx: Tx, tenantId: string, actor: Actor, input: ProductInput, laptop?: LaptopColumns) {
    const trackInventory = input.trackInventory ?? input.type === 'GOODS';
    const rules = { type: input.type, trackInventory, isSerialized: input.isSerialized, requiresImei: input.requiresImei };
    this.validateProductRules(rules);
    await this.validateRefs(tx, tenantId, input);
    const dup = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "products" WHERE "tenant_id" = ${tenantId}::uuid AND lower("sku") = lower(${input.sku})`;
    if (dup.length) throw businessRuleError('MASTER_DUPLICATE_SKU', `SKU ${input.sku} already exists`, [{ path: 'sku', message: 'This SKU is already used' }]);
    const id = uuidv7();
    try {
      await tx.product.create({
        data: {
          id, tenantId, sku: input.sku, name: input.name, description: input.description ?? null, type: input.type, trackInventory, isSerialized: input.isSerialized, requiresImei: input.requiresImei,
          serialPattern: input.serialPattern ?? null, qcRequired: input.qcRequired ?? (trackInventory ? true : false), categoryId: input.categoryId ?? null, brandId: input.brandId ?? null, unitId: input.unitId, hsnId: input.hsnId ?? null,
          taxRateId: input.taxRateId ?? null, defaultWarrantyId: input.defaultWarrantyId ?? null, purchasePrice: input.purchasePrice ?? null, sellingPrice: input.sellingPrice ?? null, reorderLevel: input.reorderLevel ?? null,
          attributes: input.attributes as Prisma.InputJsonValue, customFields: input.customFields as Prisma.InputJsonValue, status: input.activate ? 'ACTIVE' : 'DRAFT',
          ...(laptop ? { ...laptop, specs: laptop.specs as unknown as Prisma.InputJsonValue } : {}),
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw businessRuleError('MASTER_DUPLICATE_SKU', `SKU ${input.sku} already exists`, [{ path: 'sku', message: 'This SKU is already used' }]);
      throw err;
    }
    const p = await this.emitProduct(tx, tenantId, EVENT_TYPES.MASTER_PRODUCT_CREATED, id, actor);
    await this.audit(tx, tenantId, actor, { action: laptop ? 'LAPTOP_CONFIGURATION_CREATED' : 'PRODUCT_CREATED', entityType: 'PRODUCT', entityId: id, summary: `${p.sku} ${p.name}`, newValue: { sku: p.sku, status: p.status, ...(laptop ? { specs: laptop.specs } : {}) }, version: 0 });
    return this.serializeProduct(p);
  }

  async importProducts(tenantId: string, actor: Actor, rows: Omit<ProductInput, 'activate'>[], activate: boolean) {
    const results: { row: number; sku: string; status: 'CREATED' | 'FAILED'; id?: string; error?: string; details?: unknown }[] = [];
    for (const [i, row] of rows.entries()) {
      try {
        const created = await this.createProduct(tenantId, actor, { ...row, activate });
        results.push({ row: i + 1, sku: row.sku, status: 'CREATED', id: created.id });
      } catch (err) {
        const e = err as HttpError;
        results.push({ row: i + 1, sku: row.sku, status: 'FAILED', error: e.message, details: e.details });
      }
    }
    return { total: rows.length, created: results.filter((r) => r.status === 'CREATED').length, failed: results.filter((r) => r.status === 'FAILED').length, results };
  }

  /** Fields frozen once the item has stock movements (phase-03 product rules). */
  static readonly LOCKED_AFTER_MOVEMENTS = ['isSerialized', 'trackInventory', 'unitId', 'type'] as const;

  async patchProduct(tenantId: string, actor: Actor, id: string, patch: Partial<ProductInput>, expectedVersion: number | null) {
    return this.tx(tenantId, async (tx) => {
      const current = await tx.product.findFirst({ where: { id, tenantId }, include: productInclude });
      if (!current) throw notFound('Product not found');
      if (expectedVersion !== null && expectedVersion !== current.version) throw conflict('The product was modified by someone else', 'VERSION_CONFLICT');
      if (current.status === 'ARCHIVED') throw conflict('Archived products cannot be edited', 'MASTER_INVALID_TRANSITION');
      const changed: Record<string, unknown> = {};
      const before: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        const prev = (current as unknown as Record<string, unknown>)[k];
        const prevNorm = prev !== null && typeof prev === 'object' && 'toNumber' in (prev as object) ? Number(prev) : prev;
        if (JSON.stringify(prevNorm) !== JSON.stringify(v)) {
          changed[k] = v;
          before[k] = prevNorm;
        }
      }
      if (Object.keys(changed).length === 0) return this.serializeProduct(current);
      const lockedTouched = MasterService.LOCKED_AFTER_MOVEMENTS.filter((f) => f in changed);
      if (lockedTouched.length && (await this.movements.hasMovements(tenantId, id))) {
        throw businessRuleError('MASTER_FIELD_LOCKED', 'These fields cannot change once the item has stock movements', lockedTouched.map((f) => ({ path: f, message: 'Locked after first stock movement' })));
      }
      const next = { type: (changed.type as string) ?? current.type, trackInventory: (changed.trackInventory as boolean) ?? current.trackInventory, isSerialized: (changed.isSerialized as boolean) ?? current.isSerialized, requiresImei: (changed.requiresImei as boolean) ?? current.requiresImei };
      this.validateProductRules(next);
      await this.validateRefs(tx, tenantId, changed as Partial<ProductInput>);
      if (changed.sku) {
        const dup = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "products" WHERE "tenant_id" = ${tenantId}::uuid AND lower("sku") = lower(${String(changed.sku)}) AND "id" <> ${id}::uuid`;
        if (dup.length) throw businessRuleError('MASTER_DUPLICATE_SKU', `SKU ${String(changed.sku)} already exists`, [{ path: 'sku', message: 'This SKU is already used' }]);
      }
      const data = { ...changed } as Prisma.ProductUncheckedUpdateInput;
      const updated = await tx.product.updateMany({ where: { id, version: current.version }, data: { ...data, version: current.version + 1 } });
      if (updated.count !== 1) throw conflict('The product was modified by someone else', 'VERSION_CONFLICT');
      const p = await this.emitProduct(tx, tenantId, EVENT_TYPES.MASTER_PRODUCT_UPDATED, id, actor);
      await this.audit(tx, tenantId, actor, { action: 'PRODUCT_UPDATED', entityType: 'PRODUCT', entityId: id, summary: `Updated ${Object.keys(changed).join(', ')}`, oldValue: before, newValue: changed, version: p.version });
      return this.serializeProduct(p);
    });
  }

  async transitionProduct(tenantId: string, actor: Actor, id: string, command: 'activate' | 'deactivate' | 'archive', reason: string | null) {
    const table = { activate: { from: ['DRAFT', 'INACTIVE'], to: 'ACTIVE' }, deactivate: { from: ['ACTIVE'], to: 'INACTIVE' }, archive: { from: ['DRAFT', 'ACTIVE', 'INACTIVE'], to: 'ARCHIVED' } } as const;
    const spec = table[command];
    return this.tx(tenantId, async (tx) => {
      const current = await tx.product.findFirst({ where: { id, tenantId } });
      if (!current) throw notFound('Product not found');
      if (!(spec.from as readonly string[]).includes(current.status)) throw conflict(`Product is ${current.status}; cannot ${command}`, 'MASTER_INVALID_TRANSITION');
      const r = await tx.product.updateMany({ where: { id, status: current.status, version: current.version }, data: { status: spec.to, version: current.version + 1 } });
      if (r.count !== 1) throw conflict('The product was modified by someone else', 'VERSION_CONFLICT');
      const p = await this.emitProduct(tx, tenantId, EVENT_TYPES.MASTER_PRODUCT_STATUS_CHANGED, id, actor);
      await this.audit(tx, tenantId, actor, { action: `PRODUCT_${spec.to}`, entityType: 'PRODUCT', entityId: id, oldValue: { status: current.status }, newValue: { status: spec.to, reason }, version: p.version });
      return this.serializeProduct(p);
    });
  }

  /** Hard delete only for never-used drafts; everything else must be archived (delete guard). */
  async deleteProduct(tenantId: string, actor: Actor, id: string) {
    return this.tx(tenantId, async (tx) => {
      const current = await tx.product.findFirst({ where: { id, tenantId } });
      if (!current) throw notFound('Product not found');
      const refs = await tx.entityReference.findMany({ where: { tenantId, entityType: 'PRODUCT', entityId: id } });
      if (refs.length || current.status !== 'DRAFT' || (await this.movements.hasMovements(tenantId, id))) {
        throw businessRuleError('MASTER_IN_USE', 'This product is referenced by other documents; archive it instead', refs.map((r) => ({ path: 'referencedBy', message: r.referencedBy })));
      }
      await tx.product.delete({ where: { id } });
      await this.audit(tx, tenantId, actor, { action: 'PRODUCT_DELETED', entityType: 'PRODUCT', entityId: id, oldValue: { sku: current.sku } });
      return { id, deleted: true };
    });
  }

  async getProduct(tenantId: string, id: string) {
    const p = await this.tx(tenantId, (tx) => tx.product.findFirst({ where: { id, tenantId }, include: productInclude }));
    if (!p) throw notFound('Product not found');
    const refs = await this.tx(tenantId, (tx) => tx.entityReference.findMany({ where: { tenantId, entityType: 'PRODUCT', entityId: id } }));
    return { ...this.serializeProduct(p), referencedBy: refs.map((r) => r.referencedBy), lockedFields: (await this.movements.hasMovements(tenantId, id)) ? [...MasterService.LOCKED_AFTER_MOVEMENTS] : [] };
  }

  async listProducts(tenantId: string, q: { q?: string; status?: string; type?: string; categoryId?: string; brandId?: string; isSerialized?: string; trackInventory?: string; laptop?: string; limit: number; cursor?: string } & Partial<LaptopSpecIds>) {
    const cursor = decodeCursor(q.cursor);
    const where: Prisma.ProductWhereInput = { tenantId };
    if (q.status) where.status = q.status;
    if (q.type) where.type = q.type;
    if (q.categoryId) where.categoryId = q.categoryId;
    if (q.brandId && q.laptop !== 'true') where.brandId = q.brandId;
    if (q.isSerialized) where.isSerialized = q.isSerialized === 'true';
    if (q.trackInventory) where.trackInventory = q.trackInventory === 'true';
    if (q.laptop) where.configKey = q.laptop === 'true' ? { not: null } : null;
    if (q.laptop) where.configKey = q.laptop === 'true' ? { not: null } : null;
    for (const k of SPEC_ID_KEYS) {
      const v = (q as Record<string, unknown>)[k];
      if (typeof v === 'string') (where as Record<string, unknown>)[SPEC_COLUMNS[k].column] = v;
    }
    if (q.q) where.OR = [{ name: { contains: q.q, mode: 'insensitive' } }, { sku: { contains: q.q, mode: 'insensitive' } }];
    if (cursor && typeof cursor[0] === 'string' && typeof cursor[1] === 'string') where.AND = [{ OR: [{ name: { gt: cursor[0] } }, { name: cursor[0], id: { gt: cursor[1] } }] }];
    const rows = await this.tx(tenantId, (tx) => tx.product.findMany({ where, include: productInclude, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: q.limit + 1 }));
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return { data: page.map((p) => this.serializeProduct(p)), nextCursor: rows.length > q.limit && last ? encodeCursor([last.name, last.id]) : null };
  }

  async lookupProducts(tenantId: string, q: { q?: string; status?: string; trackInventory?: string; laptop?: string }) {
    const where: Prisma.ProductWhereInput = { tenantId, status: q.status ?? 'ACTIVE' };
    if (q.trackInventory) where.trackInventory = q.trackInventory === 'true';
    if (q.laptop) where.configKey = q.laptop === 'true' ? { not: null } : null;
    if (q.q) {
      // laptop configurations also match on their spec values ("i7", "16 GB", "Iris Xe")
      const specPaths = ['generation', 'processor', 'ram', 'ssd', 'gpu', 'screenSize'];
      where.OR = [{ name: { contains: q.q, mode: 'insensitive' } }, { sku: { contains: q.q, mode: 'insensitive' } }, ...specPaths.map((p) => ({ specs: { path: [p], string_contains: q.q } }))];
    }
    const rows = await this.tx(tenantId, (tx) => tx.product.findMany({ where, include: productInclude, orderBy: { name: 'asc' }, take: 20 }));
    return rows.map((p) => this.snapshot(p));
  }

  async productsBatch(tenantId: string, ids: string[]): Promise<ProductSnapshot[]> {
    const rows = await this.tx(tenantId, (tx) => tx.product.findMany({ where: { tenantId, id: { in: ids } }, include: productInclude }));
    return rows.map((p) => this.snapshot(p));
  }

  /* ---- laptop specification masters ------------------------------------------ */

  specOptionView(o: { id: string; kind: string; name: string; code: string; brandId: string | null; sortOrder: number; status: string; version: number; brand?: { name: string } | null }) {
    return { id: o.id, kind: o.kind, name: o.name, code: o.code, brandId: o.brandId, brandName: o.brand?.name ?? null, sortOrder: o.sortOrder, status: o.status, version: o.version };
  }

  async listSpecOptions(tenantId: string, q: { kind?: string; brandId?: string; includeInactive?: string }) {
    const rows = await this.tx(tenantId, (tx) => tx.laptopSpecOption.findMany({
      where: { tenantId, ...(q.kind ? { kind: q.kind } : {}), ...(q.brandId ? { brandId: q.brandId } : {}), ...(q.includeInactive === 'true' ? {} : { status: 'ACTIVE' }) },
      include: { brand: { select: { name: true } } },
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    }));
    return rows.map((o) => this.specOptionView(o));
  }

  async createSpecOption(tenantId: string, actor: Actor, input: SpecOptionInput) {
    return this.tx(tenantId, async (tx) => {
      let brandName: string | null = null;
      if (input.kind === 'MODEL') {
        if (!input.brandId) throw businessRuleError('VALIDATION_FAILED', 'A model belongs to a brand', [{ path: 'brandId', message: 'Select the brand' }]);
        const brand = await tx.laptopSpecOption.findFirst({ where: { id: input.brandId, tenantId, kind: 'BRAND' } });
        if (!brand) throw businessRuleError('VALIDATION_FAILED', 'Brand not found', [{ path: 'brandId', message: 'Select a valid brand' }]);
        if (brand.status !== 'ACTIVE') throw businessRuleError('VALIDATION_FAILED', 'Brand is inactive', [{ path: 'brandId', message: 'This brand is inactive' }]);
        brandName = brand.name;
      } else if (input.brandId) {
        throw businessRuleError('VALIDATION_FAILED', 'Only models belong to a brand', [{ path: 'brandId', message: 'Not allowed for this specification' }]);
      }
      const id = uuidv7();
      try {
        await tx.laptopSpecOption.create({ data: { id, tenantId, kind: input.kind, name: input.name, code: input.code ?? deriveSpecCode(input.kind, input.name), brandId: input.kind === 'MODEL' ? input.brandId! : null, sortOrder: input.sortOrder } });
      } catch (err) {
        if (isUniqueViolation(err)) throw businessRuleError('MASTER_DUPLICATE', `${input.name} already exists${brandName ? ` for ${brandName}` : ''}`, [{ path: 'name', message: 'This value already exists' }]);
        throw err;
      }
      const row = await tx.laptopSpecOption.findUniqueOrThrow({ where: { id }, include: { brand: { select: { name: true } } } });
      await this.audit(tx, tenantId, actor, { action: 'LAPTOP_SPEC_CREATED', entityType: 'LAPTOP_SPEC', entityId: id, summary: `${input.kind} ${row.name}`, newValue: this.specOptionView(row), version: 0 });
      return this.specOptionView(row);
    });
  }

  async setSpecOptionStatus(tenantId: string, actor: Actor, id: string, status: 'ACTIVE' | 'INACTIVE') {
    return this.tx(tenantId, async (tx) => {
      const current = await tx.laptopSpecOption.findFirst({ where: { id, tenantId } });
      if (!current) throw notFound('Specification not found');
      if (current.status === status) return this.specOptionView(current);
      if (status === 'ACTIVE' && current.brandId) {
        const brand = await tx.laptopSpecOption.findFirst({ where: { id: current.brandId, tenantId } });
        if (brand?.status !== 'ACTIVE') throw businessRuleError('VALIDATION_FAILED', 'Activate the brand first', [{ path: 'brandId', message: 'The brand is inactive' }]);
      }
      const row = await tx.laptopSpecOption.update({ where: { id }, data: { status, version: { increment: 1 } }, include: { brand: { select: { name: true } } } });
      await this.audit(tx, tenantId, actor, { action: `LAPTOP_SPEC_${status}`, entityType: 'LAPTOP_SPEC', entityId: id, summary: `${row.kind} ${row.name}`, oldValue: { status: current.status }, newValue: { status }, version: row.version });
      return this.specOptionView(row);
    });
  }

  /* ---- laptop configurations ------------------------------------------------- */

  /** Resolves and checks the eight spec ids; returns the columns to store and the SKU parts. */
  private async resolveLaptopSpecs(tx: Tx, tenantId: string, ids: LaptopSpecIds) {
    const rows = await tx.laptopSpecOption.findMany({ where: { tenantId, id: { in: SPEC_ID_KEYS.map((k) => ids[k]) } } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const problems: { path: string; message: string }[] = [];
    const picked = {} as Record<keyof LaptopSpecIds, (typeof rows)[number]>;
    for (const k of SPEC_ID_KEYS) {
      const { kind } = SPEC_COLUMNS[k];
      const label = LAPTOP_SPEC_FIELDS.find((f) => f.kind === kind)!.label;
      const row = byId.get(ids[k]);
      if (!row || row.kind !== kind) problems.push({ path: k, message: `Select a valid ${label.toLowerCase()}` });
      else if (row.status !== 'ACTIVE') problems.push({ path: k, message: `${row.name} is inactive` });
      else picked[k] = row;
    }
    if (picked.modelId && picked.brandId && picked.modelId.brandId !== picked.brandId.id) problems.push({ path: 'modelId', message: `${picked.modelId.name} is not a ${picked.brandId.name} model` });
    if (problems.length) throw businessRuleError('VALIDATION_FAILED', 'Please fix the highlighted specifications', problems);
    const specs = Object.fromEntries(SPEC_ID_KEYS.map((k) => [SPEC_COLUMNS[k].key, picked[k].name])) as unknown as LaptopSpecs;
    const columns: LaptopColumns = {
      brandSpecId: ids.brandId, modelSpecId: ids.modelId, generationSpecId: ids.generationId, processorSpecId: ids.processorId,
      ramSpecId: ids.ramId, ssdSpecId: ids.ssdId, gpuSpecId: ids.gpuId, screenSizeSpecId: ids.screenSizeId,
      specs,
      configKey: SPEC_ID_KEYS.map((k) => ids[k]).join('|'),
    };
    const skuBase = [picked.brandId.code, picked.modelId.code, picked.processorId.code, picked.ramId.code, picked.ssdId.code].join('-').slice(0, 36);
    return { columns, skuBase, defaultName: `${picked.brandId.name} ${picked.modelId.name}` };
  }

  private async duplicateConfiguration(tx: Tx, tenantId: string, configKey: string, exceptId?: string) {
    return tx.product.findFirst({ where: { tenantId, configKey, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true, sku: true, name: true, status: true } });
  }

  /** First free SKU: base, then base-2, base-3 ... (SKUs are unique ignoring case). */
  private async freeSku(tx: Tx, tenantId: string, base: string, exceptId?: string): Promise<string> {
    for (let n = 1; n < 100; n += 1) {
      const candidate = n === 1 ? base : `${base}-${n}`;
      const taken = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "products" WHERE "tenant_id" = ${tenantId}::uuid AND lower("sku") = lower(${candidate}) AND (${exceptId ?? null}::uuid IS NULL OR "id" <> ${exceptId ?? null}::uuid)`;
      if (!taken.length) return candidate;
    }
    throw businessRuleError('MASTER_DUPLICATE_SKU', 'Could not generate a free SKU; enter one manually', [{ path: 'sku', message: 'Enter a SKU' }]);
  }

  /** What the configuration would be called, and whether it already exists (no writes). */
  async previewLaptop(tenantId: string, ids: LaptopSpecIds) {
    return this.tx(tenantId, async (tx) => {
      const r = await this.resolveLaptopSpecs(tx, tenantId, ids);
      const duplicateOf = await this.duplicateConfiguration(tx, tenantId, r.columns.configKey);
      return { sku: duplicateOf ? duplicateOf.sku : await this.freeSku(tx, tenantId, r.skuBase), name: r.defaultName, specs: r.columns.specs, duplicateOf };
    });
  }

  private async laptopTaxDefaults(tx: Tx, tenantId: string) {
    const unit = (await tx.unit.findFirst({ where: { tenantId, code: 'NOS', status: 'ACTIVE' } })) ?? (await tx.unit.findFirst({ where: { tenantId, code: 'PCS', status: 'ACTIVE' } })) ?? (await tx.unit.findFirst({ where: { tenantId, status: 'ACTIVE' } }));
    if (!unit) throw businessRuleError('VALIDATION_FAILED', 'Create a unit of measure first', [{ path: 'unitId', message: 'No active unit' }]);
    const tax = await tx.taxRate.findFirst({ where: { tenantId, gstRate: 18, status: 'ACTIVE' } });
    return { unitId: unit.id, taxRateId: tax?.id ?? null };
  }

  async createLaptop(tenantId: string, actor: Actor, input: LaptopInput) {
    return this.tx(tenantId, async (tx) => {
      const r = await this.resolveLaptopSpecs(tx, tenantId, input);
      const dup = await this.duplicateConfiguration(tx, tenantId, r.columns.configKey);
      if (dup) throw businessRuleError('MASTER_DUPLICATE_CONFIGURATION', `This configuration already exists as ${dup.sku}`, [{ path: 'modelId', message: `Same specifications as ${dup.sku} (${dup.name})` }]);
      const defaults = await this.laptopTaxDefaults(tx, tenantId);
      const sku = input.sku ?? (await this.freeSku(tx, tenantId, r.skuBase));
      const product: ProductInput = {
        sku, name: input.name ?? r.defaultName, description: input.description ?? null, type: 'GOODS', trackInventory: true, isSerialized: true, requiresImei: false,
        serialPattern: input.serialPattern ?? null, qcRequired: true, categoryId: null, brandId: null, unitId: defaults.unitId, hsnId: input.hsnId ?? null,
        taxRateId: input.taxRateId === undefined ? defaults.taxRateId : input.taxRateId, defaultWarrantyId: input.defaultWarrantyId ?? null,
        purchasePrice: input.purchasePrice ?? null, sellingPrice: input.sellingPrice ?? null, reorderLevel: input.reorderLevel ?? null, attributes: {}, customFields: {}, activate: input.activate,
      };
      try {
        return await this.createProductIn(tx, tenantId, actor, product, r.columns);
      } catch (err) {
        if (isUniqueViolation(err)) throw businessRuleError('MASTER_DUPLICATE_CONFIGURATION', 'This configuration already exists', [{ path: 'modelId', message: 'Same specifications as an existing configuration' }]);
        throw err;
      }
    });
  }

  /**
   * Specifications define what the SKU is, so they can change only while the configuration is a
   * DRAFT; afterwards create a new configuration. Prices, tax, HSN, warranty and name stay editable.
   */
  async patchLaptop(tenantId: string, actor: Actor, id: string, patch: LaptopPatch, expectedVersion: number | null) {
    const specPatch = SPEC_ID_KEYS.filter((k) => patch[k] !== undefined);
    const rest: Partial<ProductInput> = {};
    for (const k of ['sku', 'name', 'description', 'serialPattern', 'hsnId', 'taxRateId', 'defaultWarrantyId', 'purchasePrice', 'sellingPrice', 'reorderLevel'] as const) {
      if (patch[k] !== undefined) (rest as Record<string, unknown>)[k] = patch[k];
    }
    if (specPatch.length) {
      await this.tx(tenantId, async (tx) => {
        const current = await tx.product.findFirst({ where: { id, tenantId } });
        if (!current || !current.configKey) throw notFound('Laptop configuration not found');
        if (expectedVersion !== null && expectedVersion !== current.version) throw conflict('The configuration was modified by someone else', 'VERSION_CONFLICT');
        const currentIds = { brandId: current.brandSpecId!, modelId: current.modelSpecId!, generationId: current.generationSpecId!, processorId: current.processorSpecId!, ramId: current.ramSpecId!, ssdId: current.ssdSpecId!, gpuId: current.gpuSpecId!, screenSizeId: current.screenSizeSpecId! };
        const next = { ...currentIds, ...Object.fromEntries(specPatch.map((k) => [k, patch[k]])) } as LaptopSpecIds;
        const changed = SPEC_ID_KEYS.filter((k) => next[k] !== currentIds[k]);
        if (!changed.length) return;
        if (current.status !== 'DRAFT') throw businessRuleError('MASTER_FIELD_LOCKED', 'Specifications are fixed once the configuration is active; create a new configuration instead', changed.map((k) => ({ path: k, message: 'Locked after activation' })));
        const r = await this.resolveLaptopSpecs(tx, tenantId, next);
        const dup = await this.duplicateConfiguration(tx, tenantId, r.columns.configKey, id);
        if (dup) throw businessRuleError('MASTER_DUPLICATE_CONFIGURATION', `This configuration already exists as ${dup.sku}`, [{ path: changed[0], message: `Same specifications as ${dup.sku}` }]);
        // A draft's SKU and default name are derived from its specs, so they follow the new specs
        // (drafts cannot be on documents yet). An explicit sku / name in the same patch wins.
        const oldSpecs = current.specs as LaptopSpecs | null;
        const derived: { sku?: string; name?: string } = {};
        if (patch.sku === undefined) derived.sku = await this.freeSku(tx, tenantId, r.skuBase, id);
        if (patch.name === undefined && oldSpecs && current.name === `${oldSpecs.brand} ${oldSpecs.model}`) derived.name = r.defaultName;
        const done = await tx.product.updateMany({ where: { id, version: current.version }, data: { ...r.columns, ...derived, specs: r.columns.specs as unknown as Prisma.InputJsonValue, version: current.version + 1 } });
        if (done.count !== 1) throw conflict('The configuration was modified by someone else', 'VERSION_CONFLICT');
        const p = await this.emitProduct(tx, tenantId, EVENT_TYPES.MASTER_PRODUCT_UPDATED, id, actor);
        await this.audit(tx, tenantId, actor, { action: 'LAPTOP_SPECS_UPDATED', entityType: 'PRODUCT', entityId: id, summary: `Specifications of ${p.sku}`, oldValue: current.specs, newValue: r.columns.specs, version: p.version });
        expectedVersion = p.version;
      });
    }
    if (Object.keys(rest).length) return this.patchProduct(tenantId, actor, id, rest, expectedVersion);
    return this.getProduct(tenantId, id);
  }

  /* ---- warehouses ------------------------------------------------------------ */

  warehouseSnapshot(w: { id: string; tenantId: string; code: string; name: string; stateCode: string; gstin: string | null; address: unknown; isDefault: boolean; status: string; version: number }): WarehouseSnapshot {
    return { id: w.id, tenantId: w.tenantId, code: w.code, name: w.name, stateCode: w.stateCode, gstin: w.gstin, address: (w.address ?? {}) as Record<string, unknown>, isDefault: w.isDefault, status: w.status, version: w.version };
  }

  private async emitWarehouse(tx: Tx, tenantId: string, type: string, id: string, actor: Actor) {
    const w = await tx.warehouse.findUniqueOrThrow({ where: { id } });
    await enqueueEvent(tx, PRODUCER, { eventType: type, tenantId, aggregate: { type: 'warehouse', id, version: w.version }, actor: { type: actor.userId ? 'user' : 'system', id: actor.userId, name: actor.name }, correlationId: actor.correlationId, payload: this.warehouseSnapshot(w) as unknown as Record<string, unknown> });
    return w;
  }

  private async emitBin(tx: Tx, tenantId: string, type: string, id: string, actor: Actor) {
    const b = await tx.bin.findUniqueOrThrow({ where: { id }, include: { location: true } });
    await enqueueEvent(tx, PRODUCER, { eventType: type, tenantId, aggregate: { type: 'bin', id, version: b.version }, actor: { type: actor.userId ? 'user' : 'system', id: actor.userId, name: actor.name }, correlationId: actor.correlationId, payload: { id: b.id, tenantId, warehouseId: b.location.warehouseId, locationId: b.locationId, code: b.code, status: b.status, version: b.version } });
    return b;
  }

  async createWarehouse(tenantId: string, actor: Actor, input: { code: string; name: string; address: Record<string, unknown> & { stateCode: string }; stateCode?: string; gstin?: string | null; isDefault: boolean }) {
    return this.tx(tenantId, async (tx) => {
      const dup = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "warehouses" WHERE "tenant_id" = ${tenantId}::uuid AND lower("code") = lower(${input.code})`;
      if (dup.length) throw businessRuleError('MASTER_DUPLICATE_CODE', `Warehouse code ${input.code} already exists`, [{ path: 'code', message: 'This code is already used' }]);
      const count = await tx.warehouse.count({ where: { tenantId } });
      const isDefault = input.isDefault || count === 0;
      if (isDefault) await tx.warehouse.updateMany({ where: { tenantId, isDefault: true }, data: { isDefault: false } });
      const id = uuidv7();
      await tx.warehouse.create({ data: { id, tenantId, code: input.code, name: input.name, address: input.address as Prisma.InputJsonValue, stateCode: input.stateCode ?? input.address.stateCode, gstin: input.gstin ?? null, isDefault, status: 'ACTIVE' } });
      await tx.location.create({ data: { id: uuidv7(), tenantId, warehouseId: id, code: 'STORE', name: 'Storage', purpose: 'STORAGE' } });
      const w = await this.emitWarehouse(tx, tenantId, EVENT_TYPES.MASTER_WAREHOUSE_CREATED, id, actor);
      await this.audit(tx, tenantId, actor, { action: 'WAREHOUSE_CREATED', entityType: 'WAREHOUSE', entityId: id, summary: `${w.code} ${w.name}`, newValue: { code: w.code, isDefault }, version: 0 });
      return this.warehouseSnapshot(w);
    });
  }

  async patchWarehouse(tenantId: string, actor: Actor, id: string, patch: Record<string, unknown>, expectedVersion: number | null) {
    return this.tx(tenantId, async (tx) => {
      const current = await tx.warehouse.findFirst({ where: { id, tenantId } });
      if (!current) throw notFound('Warehouse not found');
      if (expectedVersion !== null && expectedVersion !== current.version) throw conflict('The warehouse was modified by someone else', 'VERSION_CONFLICT');
      const data: Prisma.WarehouseUncheckedUpdateInput = {};
      if (patch.name !== undefined) data.name = patch.name as string;
      if (patch.address !== undefined) data.address = patch.address as Prisma.InputJsonValue;
      if (patch.stateCode !== undefined) data.stateCode = patch.stateCode as string;
      if (patch.gstin !== undefined) data.gstin = (patch.gstin as string | null) ?? null;
      if (patch.isDefault === true) await tx.warehouse.updateMany({ where: { tenantId, isDefault: true, id: { not: id } }, data: { isDefault: false } });
      if (patch.isDefault !== undefined) data.isDefault = Boolean(patch.isDefault);
      const r = await tx.warehouse.updateMany({ where: { id, version: current.version }, data: { ...data, version: current.version + 1 } });
      if (r.count !== 1) throw conflict('The warehouse was modified by someone else', 'VERSION_CONFLICT');
      const w = await this.emitWarehouse(tx, tenantId, EVENT_TYPES.MASTER_WAREHOUSE_UPDATED, id, actor);
      await this.audit(tx, tenantId, actor, { action: 'WAREHOUSE_UPDATED', entityType: 'WAREHOUSE', entityId: id, newValue: patch, version: w.version });
      return this.warehouseSnapshot(w);
    });
  }

  async setWarehouseStatus(tenantId: string, actor: Actor, id: string, status: 'ACTIVE' | 'INACTIVE') {
    return this.tx(tenantId, async (tx) => {
      const current = await tx.warehouse.findFirst({ where: { id, tenantId } });
      if (!current) throw notFound('Warehouse not found');
      if (current.status === status) throw conflict(`Warehouse is already ${status}`, 'MASTER_INVALID_TRANSITION');
      if (status === 'INACTIVE' && current.isDefault) throw businessRuleError('MASTER_RULE_VIOLATION', 'Make another warehouse the default before deactivating this one');
      await tx.warehouse.update({ where: { id }, data: { status, version: { increment: 1 } } });
      const w = await this.emitWarehouse(tx, tenantId, EVENT_TYPES.MASTER_WAREHOUSE_UPDATED, id, actor);
      await this.audit(tx, tenantId, actor, { action: `WAREHOUSE_${status}`, entityType: 'WAREHOUSE', entityId: id, oldValue: { status: current.status }, newValue: { status }, version: w.version });
      return this.warehouseSnapshot(w);
    });
  }

  async listWarehouses(ctx: TenantContext) {
    const rows = await this.tx(ctx.tenantId!, (tx) => tx.warehouse.findMany({ where: { tenantId: ctx.tenantId! }, orderBy: [{ isDefault: 'desc' }, { code: 'asc' }], include: { locations: { include: { bins: true }, orderBy: { code: 'asc' } } } }));
    return rows.filter((w) => inWarehouseScope(ctx, w.id)).map((w) => ({ ...this.warehouseSnapshot(w), locations: w.locations.map((l) => ({ id: l.id, code: l.code, name: l.name, purpose: l.purpose, status: l.status, bins: l.bins.map((b) => ({ id: b.id, code: b.code, capacity: b.capacity === null ? null : Number(b.capacity), status: b.status })) })) }));
  }

  async getWarehouse(ctx: TenantContext, id: string) {
    if (!inWarehouseScope(ctx, id)) throw notFound('Warehouse not found');
    const list = await this.listWarehouses(ctx);
    const w = list.find((x) => x.id === id);
    if (!w) throw notFound('Warehouse not found');
    return w;
  }

  async warehousesBatch(tenantId: string, ids: string[]): Promise<WarehouseSnapshot[]> {
    const rows = await this.tx(tenantId, (tx) => tx.warehouse.findMany({ where: { tenantId, id: { in: ids } } }));
    return rows.map((w) => this.warehouseSnapshot(w));
  }

  async createLocation(tenantId: string, actor: Actor, warehouseId: string, input: { code: string; name?: string | null; purpose?: string | null }) {
    return this.tx(tenantId, async (tx) => {
      const wh = await tx.warehouse.findFirst({ where: { id: warehouseId, tenantId } });
      if (!wh) throw notFound('Warehouse not found');
      const dup = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "locations" WHERE "tenant_id" = ${tenantId}::uuid AND "warehouse_id" = ${warehouseId}::uuid AND lower("code") = lower(${input.code})`;
      if (dup.length) throw businessRuleError('MASTER_DUPLICATE_CODE', 'Location code already exists in this warehouse', [{ path: 'code', message: 'Duplicate code' }]);
      const loc = await tx.location.create({ data: { id: uuidv7(), tenantId, warehouseId, code: input.code, name: input.name ?? null, purpose: input.purpose ?? null } });
      await this.audit(tx, tenantId, actor, { action: 'LOCATION_CREATED', entityType: 'LOCATION', entityId: loc.id, newValue: { warehouseId, code: loc.code } });
      return loc;
    });
  }

  async createBin(tenantId: string, actor: Actor, locationId: string, input: { code: string; capacity?: number | null }) {
    return this.tx(tenantId, async (tx) => {
      const loc = await tx.location.findFirst({ where: { id: locationId, tenantId } });
      if (!loc) throw notFound('Location not found');
      const dup = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "bins" WHERE "tenant_id" = ${tenantId}::uuid AND "location_id" = ${locationId}::uuid AND lower("code") = lower(${input.code})`;
      if (dup.length) throw businessRuleError('MASTER_DUPLICATE_CODE', 'Bin code already exists in this location', [{ path: 'code', message: 'Duplicate code' }]);
      const id = uuidv7();
      await tx.bin.create({ data: { id, tenantId, locationId, code: input.code, capacity: input.capacity ?? null } });
      const b = await this.emitBin(tx, tenantId, EVENT_TYPES.MASTER_BIN_CREATED, id, actor);
      await this.audit(tx, tenantId, actor, { action: 'BIN_CREATED', entityType: 'BIN', entityId: id, newValue: { locationId, code: b.code } });
      return { id: b.id, code: b.code, locationId: b.locationId, capacity: b.capacity === null ? null : Number(b.capacity), status: b.status, version: b.version };
    });
  }

  async setBinStatus(tenantId: string, actor: Actor, id: string, status: 'ACTIVE' | 'INACTIVE') {
    return this.tx(tenantId, async (tx) => {
      const b = await tx.bin.findFirst({ where: { id, tenantId } });
      if (!b) throw notFound('Bin not found');
      await tx.bin.update({ where: { id }, data: { status, version: { increment: 1 } } });
      await this.emitBin(tx, tenantId, EVENT_TYPES.MASTER_BIN_UPDATED, id, actor);
      await this.audit(tx, tenantId, actor, { action: `BIN_${status}`, entityType: 'BIN', entityId: id, oldValue: { status: b.status }, newValue: { status } });
      return { id, status };
    });
  }

  /* ---- simple masters ------------------------------------------------------------ */

  private async emitGrades(tx: Tx, tenantId: string, actor: Actor) {
    const grades = await tx.conditionGrade.findMany({ where: { tenantId, status: 'ACTIVE' }, orderBy: { sortOrder: 'asc' } });
    await enqueueEvent(tx, PRODUCER, { eventType: EVENT_TYPES.MASTER_GRADE_UPDATED, tenantId, aggregate: { type: 'condition_grades', id: tenantId, version: null }, actor: { type: actor.userId ? 'user' : 'system', id: actor.userId, name: actor.name }, correlationId: actor.correlationId, payload: { tenantId, grades: grades.map((g) => ({ code: g.code, name: g.name, sellable: g.sellable, sortOrder: g.sortOrder })) } });
  }

  /** Generic create/list/archive for the simple masters; duplicate names/codes -> 422. */
  async simpleList(tenantId: string, model: SimpleModel, includeInactive = false) {
    return this.tx(tenantId, (tx) => (delegate(tx, model) as SimpleDelegate).findMany({ where: { tenantId, ...(includeInactive ? {} : { status: 'ACTIVE' }) }, orderBy: orderFor(model) }));
  }

  async simpleCreate(tenantId: string, actor: Actor, model: SimpleModel, data: Record<string, unknown>) {
    return this.tx(tenantId, async (tx) => {
      if (model === 'category' && data.parentId) {
        const parent = await tx.category.findFirst({ where: { id: data.parentId as string, tenantId } });
        if (!parent) throw businessRuleError('VALIDATION_FAILED', 'Parent category not found', [{ path: 'parentId', message: 'Unknown category' }]);
      }
      if (model === 'paymentTerm' && data.isDefault) await tx.paymentTerm.updateMany({ where: { tenantId, isDefault: true }, data: { isDefault: false } });
      if (model === 'hsnCode' && data.defaultTaxRateId) {
        const tr = await tx.taxRate.findFirst({ where: { id: data.defaultTaxRateId as string, tenantId } });
        if (!tr) throw businessRuleError('VALIDATION_FAILED', 'Tax rate not found', [{ path: 'defaultTaxRateId', message: 'Unknown tax rate' }]);
      }
      const id = uuidv7();
      let row: Record<string, unknown>;
      try {
        if (model === 'category') {
          const parent = data.parentId ? await tx.category.findFirst({ where: { id: data.parentId as string } }) : null;
          const path = parent ? `${parent.path}.${id.replace(/-/g, '')}` : id.replace(/-/g, '');
          row = await tx.category.create({ data: { id, tenantId, name: data.name as string, parentId: (data.parentId as string | null) ?? null, path } });
        } else if (model === 'taxRate') {
          row = await tx.taxRate.create({ data: { id, tenantId, name: data.name as string, gstRate: data.gstRate as number, cessRate: (data.cessRate as number) ?? 0, effectiveFrom: new Date(data.effectiveFrom as string), effectiveTo: data.effectiveTo ? new Date(data.effectiveTo as string) : null } });
        } else if (model === 'customFieldDef') {
          row = await tx.customFieldDef.create({ data: { id, tenantId, entity: data.entity as string, key: data.key as string, label: data.label as string, dataType: data.dataType as string, options: (data.options as Prisma.InputJsonValue | undefined) ?? undefined, required: Boolean(data.required) } });
        } else {
          row = await (delegate(tx, model) as SimpleDelegate).create({ data: { id, tenantId, ...data } });
        }
      } catch (err) {
        if (isUniqueViolation(err)) throw businessRuleError('MASTER_DUPLICATE_CODE', 'A record with this code or name already exists', [{ path: 'name', message: 'Already exists' }]);
        const e = err as { code?: string; meta?: { code?: string } };
        if (e?.code === 'P2010' && e.meta?.code === '23514') throw businessRuleError('MASTER_RULE_VIOLATION', 'Value not allowed');
        throw err;
      }
      if (model === 'conditionGrade') await this.emitGrades(tx, tenantId, actor);
      await this.audit(tx, tenantId, actor, { action: `${model.toUpperCase()}_CREATED`, entityType: model.toUpperCase(), entityId: id, newValue: data });
      return row;
    });
  }

  async simpleSetStatus(tenantId: string, actor: Actor, model: SimpleModel, id: string, status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED') {
    return this.tx(tenantId, async (tx) => {
      const d = delegate(tx, model) as SimpleDelegate;
      const current = await d.findFirst({ where: { id, tenantId } });
      if (!current) throw notFound('Not found');
      if (status !== 'ACTIVE') {
        const refs = await this.simpleReferences(tx, tenantId, model, id);
        if (refs > 0 && status === 'ARCHIVED') throw businessRuleError('MASTER_IN_USE', `In use by ${refs} record(s); deactivate instead of archiving`);
      }
      await d.update({ where: { id }, data: { status } });
      if (model === 'conditionGrade') await this.emitGrades(tx, tenantId, actor);
      await this.audit(tx, tenantId, actor, { action: `${model.toUpperCase()}_${status}`, entityType: model.toUpperCase(), entityId: id, oldValue: { status: (current as { status?: string }).status }, newValue: { status } });
      return { id, status };
    });
  }

  private async simpleReferences(tx: Tx, tenantId: string, model: SimpleModel, id: string): Promise<number> {
    switch (model) {
      case 'unit':
        return tx.product.count({ where: { tenantId, unitId: id } });
      case 'taxRate':
        return tx.product.count({ where: { tenantId, taxRateId: id } });
      case 'hsnCode':
        return tx.product.count({ where: { tenantId, hsnId: id } });
      case 'category':
        return (await tx.product.count({ where: { tenantId, categoryId: id } })) + (await tx.category.count({ where: { tenantId, parentId: id } }));
      case 'brand':
        return tx.product.count({ where: { tenantId, brandId: id } });
      case 'warrantyPolicy':
        return tx.product.count({ where: { tenantId, defaultWarrantyId: id } });
      default:
        return 0;
    }
  }

  /* ---- numbering & references -------------------------------------------------- */

  async listNumbering(tenantId: string) {
    return this.tx(tenantId, (tx) => tx.numberingConfig.findMany({ where: { tenantId }, orderBy: { docType: 'asc' } }));
  }

  async setNumbering(tenantId: string, actor: Actor, docType: DocType, input: { prefixTemplate: string; padding: number; resetEachFy: boolean }) {
    return this.tx(tenantId, async (tx) => {
      const before = await tx.numberingConfig.findUnique({ where: { tenantId_docType: { tenantId, docType } } });
      const row = await tx.numberingConfig.upsert({ where: { tenantId_docType: { tenantId, docType } }, update: input, create: { tenantId, docType, ...input } });
      await this.audit(tx, tenantId, actor, { action: 'NUMBERING_UPDATED', entityType: 'NUMBERING', entityId: tenantId, summary: docType, oldValue: before, newValue: input });
      return row;
    });
  }

  async recordReferences(tx: Tx, tenantId: string, refs: { entityType: 'PRODUCT' | 'WAREHOUSE'; entityId: string; referencedBy: string }[]) {
    for (const r of refs) {
      await tx.$executeRaw`INSERT INTO "entity_references" ("tenant_id", "entity_type", "entity_id", "referenced_by") VALUES (${tenantId}::uuid, ${r.entityType}, ${r.entityId}::uuid, ${r.referencedBy}) ON CONFLICT DO NOTHING`;
    }
  }
}

export type SimpleModel = 'unit' | 'taxRate' | 'hsnCode' | 'category' | 'brand' | 'conditionGrade' | 'warrantyPolicy' | 'paymentTerm' | 'customFieldDef';

interface SimpleDelegate {
  findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<Record<string, unknown>[]>;
  findFirst(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
  create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<Record<string, unknown>>;
}

function delegate(tx: Tx, model: SimpleModel): unknown {
  return (tx as unknown as Record<string, unknown>)[model];
}

function orderFor(model: SimpleModel): unknown {
  switch (model) {
    case 'conditionGrade':
      return { sortOrder: 'asc' };
    case 'paymentTerm':
      return { days: 'asc' };
    case 'taxRate':
      return { gstRate: 'asc' };
    case 'customFieldDef':
      return [{ entity: 'asc' }, { key: 'asc' }];
    default:
      return { name: 'asc' };
  }
}

export function assertScopedWarehouse(ctx: TenantContext, warehouseId: string) {
  if (!inWarehouseScope(ctx, warehouseId)) throw forbidden('This warehouse is outside your scope', 'FORBIDDEN', [{ path: 'warehouseId', message: 'Not in your warehouse scope' }]);
}
