/**
 * Procurement domain (phase-05). PO state machine with approval and revisions, GRNs whose receipt is
 * posted to inventory by event, and the GRN cancellation saga. Money math comes from
 * `@b2b/shared` (`computePurchaseOrderTotals`); numbers from `document_sequences`; snapshots from
 * master / party at document time so documents never change retroactively.
 */
import { EVENT_TYPES, type PartySnapshot, type ProductSnapshot, type WarehouseSnapshot } from '@b2b/contracts';
import { computePurchaseOrderTotals } from '@b2b/shared';
import { HttpError, businessRuleError, conflict, enqueueEvent, forbidden, inWarehouseScope, nextDocumentNumber, notFound, setTenantContext, uuidv7, validationError, type ErrorDetail, type NumberingSource, type TenantContext } from '@b2b/platform-kit';
import { Prisma, type PrismaClient, type Tx } from '../db.js';
import type { GrnInput, PoInput, PoPatch, ReviseInput } from './procurement.schema.js';
import type { ProcurementSources } from './sources.js';

export const PRODUCER = 'svc-procurement';

export interface Actor {
  userId: string | null;
  name: string | null;
  correlationId: string;
}
export const actorFrom = (ctx: TenantContext): Actor => ({ userId: ctx.userId, name: ctx.userName, correlationId: ctx.correlationId });
const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';

export interface StorageSource {
  presign(objectKey: string, contentType: string): Promise<string>;
}
export const localStorage: StorageSource = { presign: async (key) => `local://${key}` };

type PoRow = Prisma.PurchaseOrderGetPayload<{ include: { lines: true } }>;
type GrnRow = Prisma.GrnGetPayload<{ include: { lines: { include: { serials: true } } } }> & { po?: { number: string } | null };
const num = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? null : Number(v));
const n = (v: Prisma.Decimal | number) => Number(v);
const round3 = (x: number) => Math.round(x * 1000) / 1000;
/** A line as priced and stored: API input, or an existing line reused by a header-only edit (rental terms may be null on old lines). */
type LineValues = Omit<PoInput['lines'][number], 'monthlyRentalAmount' | 'tenureMonths'> & { monthlyRentalAmount: number | null; tenureMonths: number | null };

export const PO_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'] as const;
export type PoStatus = (typeof PO_STATUSES)[number];
export const PO_COMMANDS = ['submit', 'approve', 'reject', 'issue', 'revise', 'cancel', 'short-close', 'close'] as const;
export type PoCommand = (typeof PO_COMMANDS)[number];
/** From-status per command (5.3 table). */
export const PO_TRANSITIONS: Record<PoCommand, readonly PoStatus[]> = {
  submit: ['DRAFT'],
  approve: ['PENDING_APPROVAL'],
  reject: ['PENDING_APPROVAL'],
  issue: ['APPROVED'],
  revise: ['ISSUED', 'PARTIALLY_RECEIVED'],
  cancel: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED'],
  'short-close': ['PARTIALLY_RECEIVED'],
  close: ['RECEIVED'],
};

export class ProcurementService {
  storage: StorageSource = localStorage;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly numbering: NumberingSource,
    private readonly sources: ProcurementSources,
  ) {}

  tx<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, tenantId);
      return fn(tx);
    }, { maxWait: 20_000, timeout: 30_000 });
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

  private async emitPo(tx: Tx, tenantId: string, po: PoRow, eventType: string, actor: Actor, previousStatus: string | null, reason: string | null) {
    await enqueueEvent(tx, PRODUCER, {
      eventType,
      tenantId,
      aggregate: { type: 'purchase_order', id: po.id, version: po.version },
      actor: { type: actor.userId ? 'user' : 'system', id: actor.userId, name: actor.name },
      correlationId: actor.correlationId,
      payload: { poId: po.id, number: po.number, revision: po.revision, status: po.status, previousStatus, supplierId: po.supplierId, shipToWarehouseId: po.shipToWarehouseId, total: n(po.total), reason, lines: po.lines.map((l) => ({ poLineId: l.id, itemId: l.itemId, orderedQty: n(l.orderedQty) })) },
    });
  }

  /* ---- settings ------------------------------------------------------------------- */

  private async settingsIn(tx: Tx, tenantId: string) {
    const s = await tx.procurementSettings.findUnique({ where: { tenantId } });
    return { approverMustDiffer: s?.approverMustDiffer ?? true, approvalLimit: s ? num(s.approvalLimit) : null, closeRequiresQc: s?.closeRequiresQc ?? true, overReceiptTolerancePct: s ? n(s.overReceiptTolerancePct) : 0 };
  }
  getSettings(tenantId: string) {
    return this.tx(tenantId, (tx) => this.settingsIn(tx, tenantId));
  }
  updateSettings(tenantId: string, actor: Actor, input: { approverMustDiffer?: boolean; approvalLimit?: number | null; closeRequiresQc?: boolean; overReceiptTolerancePct?: number }) {
    return this.tx(tenantId, async (tx) => {
      const before = await this.settingsIn(tx, tenantId);
      await tx.procurementSettings.upsert({ where: { tenantId }, update: input, create: { tenantId, ...before, ...input } });
      await this.audit(tx, tenantId, actor, { action: 'PROCUREMENT_SETTINGS_UPDATED', entityType: 'PROCUREMENT_SETTINGS', entityId: tenantId, oldValue: before, newValue: input });
      return this.settingsIn(tx, tenantId);
    });
  }

  /* ---- snapshots and totals ---------------------------------------------------------- */

  private async supplierSnapshot(tenantId: string, supplierId: string, correlationId: string): Promise<PartySnapshot> {
    const s = await this.sources.party.supplier(tenantId, supplierId, correlationId);
    if (!s || s.partyType !== 'SUPPLIER') throw validationError([{ path: 'supplierId', message: 'Select a valid supplier' }]);
    if (s.status !== 'ACTIVE') throw businessRuleError('PO_SUPPLIER_BLOCKED', s.status === 'BLOCKED' ? `Supplier ${s.displayName} is blocked: ${s.blockedReason ?? 'no reason given'}` : `Supplier ${s.displayName} is ${s.status.toLowerCase()}`, [{ path: 'supplierId', message: 'Supplier cannot receive new orders' }]);
    return s;
  }

  private async warehouseSnapshot(ctx: TenantContext, warehouseId: string, fallback: WarehouseSnapshot | null): Promise<WarehouseSnapshot> {
    if (!inWarehouseScope(ctx, warehouseId)) throw forbidden('This warehouse is outside your scope', 'GRN_WAREHOUSE_SCOPE');
    const w = fallback?.id === warehouseId ? fallback : await this.sources.master.warehouse(ctx.tenantId!, warehouseId, ctx.correlationId);
    if (!w) throw validationError([{ path: 'warehouseId', message: 'Select a valid warehouse' }]);
    if (w.status !== 'ACTIVE') throw validationError([{ path: 'warehouseId', message: `Warehouse ${w.code} is inactive` }]);
    return w;
  }

  /**
   * Resolves every line's laptop configuration from svc-master (tenant-scoped: another tenant's id
   * resolves to nothing, exactly like an unknown id). A configuration may appear on one line only,
   * must be a laptop (carries the eight specs) and must be ACTIVE.
   */
  private async itemSnapshots(tenantId: string, lines: { itemId: string }[], correlationId: string): Promise<Map<string, ProductSnapshot>> {
    const firstLine = new Map<string, number>();
    const duplicates: ErrorDetail[] = [];
    lines.forEach((l, i) => {
      const first = firstLine.get(l.itemId);
      if (first === undefined) firstLine.set(l.itemId, i);
      else duplicates.push({ path: `lines.${i}.itemId`, message: `This laptop is already on line ${first + 1}; increase the quantity there instead` });
    });
    if (duplicates.length) throw businessRuleError('PO_DUPLICATE_LINE', 'The same laptop configuration is on more than one line', duplicates);

    const items = await this.sources.master.products(tenantId, [...firstLine.keys()], correlationId);
    const map = new Map(items.map((i) => [i.id, i]));
    const notLaptop: ErrorDetail[] = [];
    const problems: ErrorDetail[] = [];
    lines.forEach((l, i) => {
      const item = map.get(l.itemId);
      if (!item) problems.push({ path: `lines.${i}.itemId`, message: 'Select a valid laptop' });
      else if (!item.specs) notLaptop.push({ path: `lines.${i}.itemId`, message: `${item.sku} is not a laptop configuration` });
      else if (item.status !== 'ACTIVE') problems.push({ path: `lines.${i}.itemId`, message: `${item.sku} is ${item.status.toLowerCase()}` });
    });
    if (notLaptop.length) throw businessRuleError('PO_ITEM_NOT_LAPTOP', 'Purchase orders can only order laptop configurations', notLaptop);
    if (problems.length) throw businessRuleError('PO_ITEM_INACTIVE', 'One or more laptops cannot be ordered', problems);
    return map;
  }

  private computeTotals(lines: LineValues[], items: Map<string, ProductSnapshot>, discountType: 'PERCENT' | 'AMOUNT', discountValue: number, intraState: boolean) {
    const totals = computePurchaseOrderTotals({
      lines: lines.map((l) => ({ quantity: l.orderedQty, rate: l.unitPrice, taxRate: l.taxRate ?? items.get(l.itemId)?.taxRate ?? 0 })),
      discountType, discountValue, taxDeductionType: 'NONE', taxDeductionRate: 0, adjustment: 0, intraState,
    });
    return { totals, lineRows: lines.map((l, i) => ({ itemId: l.itemId, itemSnapshot: items.get(l.itemId) as unknown as Prisma.InputJsonValue, orderedQty: l.orderedQty, unitPrice: l.unitPrice, taxRate: totals.lines[i].taxRate, taxableAmount: totals.lines[i].taxableAmount, taxAmount: totals.lines[i].taxAmount, lineTotal: totals.lines[i].total, monthlyRentalAmount: l.monthlyRentalAmount, tenureMonths: l.tenureMonths })) };
  }

  private intraState(supplier: PartySnapshot, warehouse: WarehouseSnapshot): boolean {
    const supplierState = supplier.stateCode ?? (supplier.billingAddress as { stateCode?: string } | null)?.stateCode ?? null;
    return supplierState ? supplierState === warehouse.stateCode : true;
  }

  /* ---- purchase orders ------------------------------------------------------------------- */

  async create(ctx: TenantContext, actor: Actor, input: PoInput) {
    const tenantId = ctx.tenantId!;
    const supplier = await this.supplierSnapshot(tenantId, input.supplierId, actor.correlationId);
    const warehouse = await this.warehouseSnapshot(ctx, input.shipToWarehouseId, null);
    const items = await this.itemSnapshots(tenantId, input.lines, actor.correlationId);
    const intra = this.intraState(supplier, warehouse);
    const { totals, lineRows } = this.computeTotals(input.lines, items, input.discountType, input.discountValue, intra);
    const config = await this.numbering.configFor(tenantId, 'PO', actor.correlationId);
    return this.tx(tenantId, async (tx) => {
      const id = uuidv7();
      const number = await nextDocumentNumber(tx, { tenantId, docType: 'PO', config });
      await tx.purchaseOrder.create({
        data: {
          id, tenantId, number, supplierId: supplier.id, supplierSnapshot: supplier as unknown as Prisma.InputJsonValue, shipToWarehouseId: warehouse.id, shipToSnapshot: warehouse as unknown as Prisma.InputJsonValue,
          orderDate: new Date(input.orderDate), expectedDate: input.expectedDate ? new Date(input.expectedDate) : null, paymentTermId: input.paymentTermId ?? supplier.paymentTermId, discountType: input.discountType, discountValue: input.discountValue, intraState: intra,
          subtotal: totals.subTotal, discountAmount: totals.discountAmount, taxTotal: totals.taxTotal, taxBreakup: totals.taxBreakup as unknown as Prisma.InputJsonValue, total: totals.total,
          status: 'DRAFT', notes: input.notes ?? null, terms: input.terms ?? null, createdBy: actor.userId ?? SYSTEM_USER,
          lines: { create: lineRows.map((l, i) => ({ id: uuidv7(), tenantId, lineNo: i + 1, ...l })) },
        },
      });
      const po = await this.load(tx, id);
      await this.audit(tx, tenantId, actor, { action: 'PO_CREATED', entityType: 'PURCHASE_ORDER', entityId: id, summary: `${number} for ${supplier.displayName} (${totals.total})`, newValue: { supplierId: supplier.id, total: totals.total, lines: lineRows.length }, version: 0 });
      await this.emitPo(tx, tenantId, po, EVENT_TYPES.PO_CREATED, actor, null, null);
      return this.poView(po);
    });
  }

  private async load(tx: Tx, id: string): Promise<PoRow> {
    const po = await tx.purchaseOrder.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!po) throw notFound('Purchase order not found');
    return po;
  }

  private async lockPo(tx: Tx, tenantId: string, id: string): Promise<PoRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "purchase_orders" WHERE "id" = ${id}::uuid AND "tenant_id" = ${tenantId}::uuid FOR UPDATE`;
    if (!locked.length) throw notFound('Purchase order not found');
    await tx.$executeRaw`SELECT "id" FROM "po_lines" WHERE "po_id" = ${id}::uuid ORDER BY "line_no" FOR UPDATE`;
    return this.load(tx, id);
  }

  private guard(po: PoRow, command: PoCommand) {
    if (!PO_TRANSITIONS[command].includes(po.status as PoStatus)) throw conflict(`Cannot ${command} a purchase order that is ${po.status}`, 'PO_INVALID_TRANSITION');
  }

  async patch(ctx: TenantContext, actor: Actor, id: string, patch: PoPatch, expectedVersion: number | null) {
    const tenantId = ctx.tenantId!;
    const current = await this.tx(tenantId, (tx) => this.load(tx, id));
    if (current.status !== 'DRAFT') throw conflict('Only draft purchase orders can be edited; revise issued orders instead', 'PO_INVALID_TRANSITION');
    if (expectedVersion !== null && expectedVersion !== current.version) throw conflict('The purchase order was modified by someone else. Reload and try again.', 'VERSION_CONFLICT');
    const supplier = patch.supplierId && patch.supplierId !== current.supplierId ? await this.supplierSnapshot(tenantId, patch.supplierId, actor.correlationId) : (current.supplierSnapshot as unknown as PartySnapshot);
    const warehouse = patch.shipToWarehouseId && patch.shipToWarehouseId !== current.shipToWarehouseId ? await this.warehouseSnapshot(ctx, patch.shipToWarehouseId, null) : (current.shipToSnapshot as unknown as WarehouseSnapshot);
    const lines: LineValues[] = patch.lines ?? current.lines.map((l) => ({ itemId: l.itemId, orderedQty: n(l.orderedQty), unitPrice: n(l.unitPrice), taxRate: n(l.taxRate), monthlyRentalAmount: num(l.monthlyRentalAmount), tenureMonths: l.tenureMonths }));
    const items = patch.lines ? await this.itemSnapshots(tenantId, lines, actor.correlationId) : new Map(current.lines.map((l) => [l.itemId, l.itemSnapshot as unknown as ProductSnapshot]));
    const discountType = patch.discountType ?? (current.discountType as 'PERCENT' | 'AMOUNT');
    const discountValue = patch.discountValue ?? n(current.discountValue);
    const intra = this.intraState(supplier, warehouse);
    const { totals, lineRows } = this.computeTotals(lines, items, discountType, discountValue, intra);
    return this.tx(tenantId, async (tx) => {
      const po = await this.lockPo(tx, tenantId, id);
      if (po.version !== current.version) throw conflict('The purchase order was modified by someone else. Reload and try again.', 'VERSION_CONFLICT');
      await tx.poLine.deleteMany({ where: { poId: id } });
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          supplierId: supplier.id, supplierSnapshot: supplier as unknown as Prisma.InputJsonValue, shipToWarehouseId: warehouse.id, shipToSnapshot: warehouse as unknown as Prisma.InputJsonValue,
          orderDate: patch.orderDate ? new Date(patch.orderDate) : undefined, expectedDate: patch.expectedDate !== undefined ? (patch.expectedDate ? new Date(patch.expectedDate) : null) : undefined,
          paymentTermId: patch.paymentTermId !== undefined ? patch.paymentTermId : undefined, discountType, discountValue, intraState: intra,
          subtotal: totals.subTotal, discountAmount: totals.discountAmount, taxTotal: totals.taxTotal, taxBreakup: totals.taxBreakup as unknown as Prisma.InputJsonValue, total: totals.total,
          notes: patch.notes !== undefined ? patch.notes : undefined, terms: patch.terms !== undefined ? patch.terms : undefined, version: { increment: 1 },
          lines: { create: lineRows.map((l, i) => ({ id: uuidv7(), tenantId, lineNo: i + 1, ...l })) },
        },
      });
      const updated = await this.load(tx, id);
      await this.audit(tx, tenantId, actor, { action: 'PO_UPDATED', entityType: 'PURCHASE_ORDER', entityId: id, summary: `${po.number} edited`, newValue: { fields: Object.keys(patch), total: totals.total }, version: updated.version });
      return this.poView(updated);
    });
  }

  async command(ctx: TenantContext, actor: Actor, id: string, command: Exclude<PoCommand, 'revise'>, body: { reason?: string | null; comment?: string | null }) {
    const tenantId = ctx.tenantId!;
    // Re-validate supplier and items on submit with fresh snapshots (they may have been blocked since the draft).
    let fresh: { supplier: PartySnapshot; items: ProductSnapshot[] } | null = null;
    if (command === 'submit') {
      const current = await this.tx(tenantId, (tx) => this.load(tx, id));
      const supplier = await this.supplierSnapshot(tenantId, current.supplierId, actor.correlationId);
      const items = await this.sources.master.products(tenantId, [...new Set(current.lines.map((l) => l.itemId))], actor.correlationId);
      fresh = { supplier, items };
    }
    return this.tx(tenantId, async (tx) => {
      const po = await this.lockPo(tx, tenantId, id);
      this.guard(po, command);
      const settings = await this.settingsIn(tx, tenantId);
      const previous = po.status;
      const data: Prisma.PurchaseOrderUpdateInput = { version: { increment: 1 } };
      let eventType: string;
      let auditAction: string;
      let selfApproved = false;
      switch (command) {
        case 'submit': {
          if (!po.lines.length) throw businessRuleError('PO_INVALID_TRANSITION', 'Add at least one line before submitting', [{ path: 'lines', message: 'At least one line is required' }]);
          const inactive = po.lines.filter((l) => { const it = fresh!.items.find((i) => i.id === l.itemId); return it && it.status !== 'ACTIVE'; });
          if (inactive.length) throw businessRuleError('PO_ITEM_INACTIVE', 'Some items are no longer active', inactive.map((l) => ({ path: `lines.${l.lineNo - 1}.itemId`, message: `${(l.itemSnapshot as { sku?: string }).sku ?? l.itemId} is not active` })));
          Object.assign(data, { status: 'PENDING_APPROVAL', submittedBy: actor.userId, submittedAt: new Date(), statusReason: null, supplierSnapshot: fresh!.supplier as unknown as Prisma.InputJsonValue });
          eventType = EVENT_TYPES.PO_SUBMITTED; auditAction = 'PO_SUBMITTED';
          break;
        }
        case 'approve': {
          // Four eyes: the submitter cannot approve, except administrators (settings.manage, i.e. owner /
          // admin), who are trusted like for the approval limit; their self-approval is flagged in the audit.
          const ownOrder = Boolean(actor.userId && (po.submittedBy === actor.userId || (!po.submittedBy && po.createdBy === actor.userId)));
          const isAdmin = ctx.permissions.has('settings.manage');
          if (settings.approverMustDiffer && ownOrder && !isAdmin) throw conflict('The person who submitted a purchase order cannot approve it', 'PO_SELF_APPROVAL');
          selfApproved = settings.approverMustDiffer && ownOrder;
          if (settings.approvalLimit !== null && n(po.total) > settings.approvalLimit && !ctx.permissions.has('settings.manage')) throw forbidden(`Purchase orders above ${settings.approvalLimit} need an administrator's approval`, 'PO_APPROVAL_LIMIT');
          await tx.poApproval.create({ data: { id: uuidv7(), tenantId, poId: id, revision: po.revision, decision: 'APPROVED', actorId: actor.userId ?? SYSTEM_USER, comment: body.comment ?? null } });
          Object.assign(data, { status: 'APPROVED', approvedBy: actor.userId, approvedAt: new Date(), statusReason: null });
          eventType = EVENT_TYPES.PO_APPROVED; auditAction = 'PO_APPROVED';
          break;
        }
        case 'reject': {
          if (!body.reason) throw validationError([{ path: 'reason', message: 'A reason is required to reject' }]);
          await tx.poApproval.create({ data: { id: uuidv7(), tenantId, poId: id, revision: po.revision, decision: 'REJECTED', actorId: actor.userId ?? SYSTEM_USER, comment: body.reason } });
          Object.assign(data, { status: 'DRAFT', statusReason: body.reason, submittedBy: null, submittedAt: null });
          eventType = EVENT_TYPES.PO_REJECTED; auditAction = 'PO_REJECTED';
          break;
        }
        case 'issue': {
          Object.assign(data, { status: this.receiptStatus(po, 'ISSUED'), issuedAt: po.issuedAt ?? new Date(), statusReason: null });
          eventType = EVENT_TYPES.PO_ISSUED; auditAction = 'PO_ISSUED';
          break;
        }
        case 'cancel': {
          const live = await tx.grn.count({ where: { poId: id, status: { not: 'CANCELLED' } } });
          if (live) throw businessRuleError('PO_HAS_RECEIVES', 'This purchase order has goods receipts; cancel them first or short-close the order', [{ path: 'status', message: `${live} live receipt(s)` }]);
          Object.assign(data, { status: 'CANCELLED', statusReason: body.reason ?? null, cancelledAt: new Date() });
          eventType = EVENT_TYPES.PO_CANCELLED; auditAction = 'PO_CANCELLED';
          break;
        }
        case 'short-close': {
          if (!body.reason) throw validationError([{ path: 'reason', message: 'A reason is required to short-close' }]);
          for (const l of po.lines) {
            const remaining = round3(n(l.orderedQty) - n(l.receivedQty) - n(l.cancelledQty));
            if (remaining > 0) await tx.poLine.update({ where: { id: l.id }, data: { cancelledQty: round3(n(l.cancelledQty) + remaining) } });
          }
          Object.assign(data, { status: 'CLOSED', statusReason: body.reason, closedAt: new Date() });
          eventType = EVENT_TYPES.PO_CLOSED; auditAction = 'PO_SHORT_CLOSED';
          break;
        }
        case 'close': {
          if (settings.closeRequiresQc) {
            const pending = await tx.grn.count({ where: { poId: id, status: { notIn: ['QC_COMPLETED', 'CANCELLED'] } } });
            if (pending) throw conflict('All goods receipts must complete QC before the order can be closed', 'PO_INVALID_TRANSITION');
          }
          Object.assign(data, { status: 'CLOSED', statusReason: body.reason ?? null, closedAt: new Date() });
          eventType = EVENT_TYPES.PO_CLOSED; auditAction = 'PO_CLOSED';
          break;
        }
        default:
          throw conflict(`Unknown command ${String(command)}`, 'PO_INVALID_TRANSITION');
      }
      await tx.purchaseOrder.update({ where: { id }, data });
      const updated = await this.load(tx, id);
      await this.audit(tx, tenantId, actor, { action: auditAction, entityType: 'PURCHASE_ORDER', entityId: id, summary: `${po.number}: ${previous} -> ${updated.status}${selfApproved ? ' (self-approved by an administrator)' : ''}`, oldValue: { status: previous }, newValue: { status: updated.status, reason: body.reason ?? body.comment ?? null, ...(selfApproved ? { selfApproved: true } : {}) }, version: updated.version });
      await this.emitPo(tx, tenantId, updated, eventType, actor, previous, body.reason ?? null);
      return this.poView(updated);
    });
  }

  /** ISSUED / PARTIALLY_RECEIVED / RECEIVED derived from the lines (used on issue after revision and on receipt / reversal). */
  private receiptStatus(po: PoRow, base: 'ISSUED'): PoStatus {
    const received = po.lines.reduce((s, l) => s + n(l.receivedQty), 0);
    const allDone = po.lines.every((l) => n(l.receivedQty) + n(l.cancelledQty) >= n(l.orderedQty) - 1e-9);
    if (allDone && received > 0) return 'RECEIVED';
    if (received > 0) return 'PARTIALLY_RECEIVED';
    return base;
  }

  async revise(ctx: TenantContext, actor: Actor, id: string, input: ReviseInput) {
    const tenantId = ctx.tenantId!;
    const current = await this.tx(tenantId, (tx) => this.load(tx, id));
    this.guard(current, 'revise');
    const items = await this.itemSnapshots(tenantId, input.lines, actor.correlationId);
    return this.tx(tenantId, async (tx) => {
      const po = await this.lockPo(tx, tenantId, id);
      this.guard(po, 'revise');
      const inFlight = await tx.grn.count({ where: { poId: id, status: { in: ['RECEIVED', 'POSTING_FAILED', 'CANCELLATION_PENDING'] } } });
      if (inFlight) throw conflict('A goods receipt is still being processed; revise after it settles', 'PO_HAS_RECEIVES');
      const problems: ErrorDetail[] = [];
      for (const existing of po.lines) {
        const incoming = input.lines.find((l) => l.poLineId === existing.id);
        const received = n(existing.receivedQty);
        if (!incoming) {
          if (received > 0) problems.push({ path: 'lines', message: `Line ${existing.lineNo} has received ${received} and cannot be removed` });
          continue;
        }
        if (received > 0) {
          if (incoming.itemId !== existing.itemId || incoming.unitPrice !== n(existing.unitPrice)) problems.push({ path: `lines.${input.lines.indexOf(incoming)}`, message: `Line ${existing.lineNo} has receipts; item and price are immutable` });
          if (incoming.orderedQty < received) problems.push({ path: `lines.${input.lines.indexOf(incoming)}.orderedQty`, message: `Line ${existing.lineNo} has already received ${received}` });
        }
      }
      if (problems.length) throw businessRuleError('PO_LINE_IMMUTABLE', 'Received lines cannot be changed that way', problems);
      const intra = po.intraState;
      const { totals, lineRows } = this.computeTotals(input.lines, items, po.discountType as 'PERCENT' | 'AMOUNT', n(po.discountValue), intra);
      await tx.poRevision.create({ data: { id: uuidv7(), tenantId, poId: id, revision: po.revision, snapshot: this.poView(po) as unknown as Prisma.InputJsonValue, reason: input.reason, createdBy: actor.userId ?? SYSTEM_USER } });
      const keep = new Set(input.lines.map((l) => l.poLineId).filter(Boolean));
      await tx.poLine.deleteMany({ where: { poId: id, id: { notIn: [...keep] as string[] } } });
      for (const [i, l] of input.lines.entries()) {
        const row = { itemId: lineRows[i].itemId, itemSnapshot: lineRows[i].itemSnapshot, orderedQty: l.orderedQty, unitPrice: l.unitPrice, taxRate: lineRows[i].taxRate, taxableAmount: lineRows[i].taxableAmount, taxAmount: lineRows[i].taxAmount, lineTotal: lineRows[i].lineTotal, monthlyRentalAmount: l.monthlyRentalAmount, tenureMonths: l.tenureMonths, lineNo: i + 1 };
        if (l.poLineId && po.lines.some((x) => x.id === l.poLineId)) await tx.poLine.update({ where: { id: l.poLineId }, data: { ...row, lineNo: 1000 + i } });
        else await tx.poLine.create({ data: { id: uuidv7(), tenantId, poId: id, ...row, lineNo: 1000 + i } });
      }
      // renumber in one pass (unique (po_id, line_no))
      const renumber = await tx.poLine.findMany({ where: { poId: id }, orderBy: { lineNo: 'asc' } });
      for (const [i, l] of renumber.entries()) await tx.poLine.update({ where: { id: l.id }, data: { lineNo: i + 1 } });
      await tx.purchaseOrder.update({ where: { id }, data: { revision: { increment: 1 }, status: 'PENDING_APPROVAL', statusReason: input.reason, submittedBy: actor.userId, submittedAt: new Date(), approvedBy: null, approvedAt: null, expectedDate: input.expectedDate ? new Date(input.expectedDate) : undefined, notes: input.notes !== undefined ? input.notes : undefined, subtotal: totals.subTotal, discountAmount: totals.discountAmount, taxTotal: totals.taxTotal, taxBreakup: totals.taxBreakup as unknown as Prisma.InputJsonValue, total: totals.total, version: { increment: 1 } } });
      const updated = await this.load(tx, id);
      await this.audit(tx, tenantId, actor, { action: 'PO_REVISED', entityType: 'PURCHASE_ORDER', entityId: id, summary: `${po.number} revision ${updated.revision}: ${input.reason}`, oldValue: { status: po.status, revision: po.revision, total: n(po.total) }, newValue: { status: updated.status, revision: updated.revision, total: totals.total }, version: updated.version });
      await this.emitPo(tx, tenantId, updated, EVENT_TYPES.PO_REVISED, actor, po.status, input.reason);
      return this.poView(updated);
    });
  }

  poView(po: PoRow) {
    return {
      id: po.id, number: po.number, revision: po.revision, status: po.status, statusReason: po.statusReason,
      supplierId: po.supplierId, supplier: po.supplierSnapshot, shipToWarehouseId: po.shipToWarehouseId, shipTo: po.shipToSnapshot,
      orderDate: po.orderDate, expectedDate: po.expectedDate, paymentTermId: po.paymentTermId, currency: po.currency, discountType: po.discountType, discountValue: n(po.discountValue), intraState: po.intraState,
      subtotal: n(po.subtotal), discountAmount: n(po.discountAmount), taxTotal: n(po.taxTotal), taxBreakup: po.taxBreakup, total: n(po.total),
      notes: po.notes, terms: po.terms, createdBy: po.createdBy, submittedBy: po.submittedBy, submittedAt: po.submittedAt, approvedBy: po.approvedBy, approvedAt: po.approvedAt, issuedAt: po.issuedAt, cancelledAt: po.cancelledAt, closedAt: po.closedAt, createdAt: po.createdAt, updatedAt: po.updatedAt, version: po.version,
      lines: [...po.lines].sort((a, b) => a.lineNo - b.lineNo).map((l) => ({ id: l.id, lineNo: l.lineNo, itemId: l.itemId, item: l.itemSnapshot, orderedQty: n(l.orderedQty), receivedQty: n(l.receivedQty), cancelledQty: n(l.cancelledQty), remainingQty: round3(n(l.orderedQty) - n(l.receivedQty) - n(l.cancelledQty)), unitPrice: n(l.unitPrice), taxRate: n(l.taxRate), taxableAmount: n(l.taxableAmount), taxAmount: n(l.taxAmount), lineTotal: n(l.lineTotal), monthlyRentalAmount: num(l.monthlyRentalAmount), tenureMonths: l.tenureMonths })),
    };
  }

  async get(ctx: TenantContext, id: string) {
    return this.tx(ctx.tenantId!, async (tx) => {
      const po = await this.load(tx, id);
      const approvals = await tx.poApproval.findMany({ where: { poId: id }, orderBy: { decidedAt: 'asc' } });
      const revisions = await tx.poRevision.findMany({ where: { poId: id }, orderBy: { revision: 'asc' }, select: { revision: true, reason: true, createdBy: true, createdAt: true } });
      const grns = await tx.grn.findMany({ where: { poId: id }, select: { id: true, number: true, status: true, receivedDate: true, warehouseId: true }, orderBy: { createdAt: 'asc' } });
      return { ...this.poView(po), approvals, revisions, grns };
    });
  }

  async revisionSnapshot(ctx: TenantContext, id: string, revision: number) {
    return this.tx(ctx.tenantId!, async (tx) => {
      await this.load(tx, id);
      const r = await tx.poRevision.findUnique({ where: { poId_revision: { poId: id, revision } } });
      if (!r) throw notFound('Revision not found');
      return r;
    });
  }

  async list(ctx: TenantContext, q: { status?: string; supplierId?: string; q?: string; awaitingApproval?: string; limit: number }) {
    return this.tx(ctx.tenantId!, async (tx) => {
      const rows = await tx.purchaseOrder.findMany({
        where: { status: q.awaitingApproval === 'true' ? 'PENDING_APPROVAL' : q.status, supplierId: q.supplierId, number: q.q ? { contains: q.q, mode: 'insensitive' } : undefined, shipToWarehouseId: ctx.warehouseIds ? { in: ctx.warehouseIds } : undefined },
        include: { lines: true }, orderBy: { createdAt: 'desc' }, take: q.limit,
      });
      return rows.map((r) => this.poView(r));
    });
  }

  async receivableLines(ctx: TenantContext, id: string) {
    return this.tx(ctx.tenantId!, async (tx) => {
      const po = await this.load(tx, id);
      const receivable = po.status === 'ISSUED' || po.status === 'PARTIALLY_RECEIVED';
      return { poId: po.id, number: po.number, status: po.status, receivable, shipToWarehouseId: po.shipToWarehouseId, lines: receivable ? this.poView(po).lines.filter((l) => l.remainingQty > 0) : [] };
    });
  }

  /* ---- goods receipts ------------------------------------------------------------------------ */

  private validateSerials(lines: GrnInput['lines'], poLines: PoRow['lines']) {
    for (const [i, l] of lines.entries()) {
      const poLine = poLines.find((p) => p.id === l.poLineId);
      if (!poLine) throw validationError([{ path: `lines.${i}.poLineId`, message: 'Line does not belong to this purchase order' }]);
      const item = poLine.itemSnapshot as unknown as ProductSnapshot;
      if (!item.isSerialized) {
        if (l.serials.length) throw businessRuleError('INV_ITEM_NOT_SERIALIZED', `${item.sku} is not serialized`, [{ path: `lines.${i}.serials`, message: 'Item is not serialized' }]);
        continue;
      }
      if (!Number.isInteger(l.qty)) throw businessRuleError('INV_NON_INTEGER_SERIALIZED_QTY', `${item.sku} needs whole quantities`, [{ path: `lines.${i}.qty`, message: 'Whole quantities only' }]);
      if (l.serials.length !== l.qty) throw businessRuleError('SERIAL_COUNT_MISMATCH', `Line ${i + 1}: ${l.qty} unit(s) but ${l.serials.length} serial(s)`, [{ path: `lines.${i}.serials`, message: 'One serial per unit' }]);
      const seen = new Set<string>();
      for (const s of l.serials) {
        const key = s.serialNo.toUpperCase();
        if (seen.has(key)) throw businessRuleError('GRN_SERIAL_DUPLICATE_IN_REQUEST', `Serial ${s.serialNo} appears twice`, [{ path: `lines.${i}.serials`, message: `${s.serialNo} duplicated` }]);
        seen.add(key);
        if (item.serialPattern && !new RegExp(item.serialPattern).test(s.serialNo)) throw businessRuleError('SERIAL_PATTERN_MISMATCH', `Serial ${s.serialNo} does not match the pattern for ${item.sku}`, [{ path: `lines.${i}.serials`, message: `${s.serialNo} pattern mismatch` }]);
        if (item.requiresImei && !s.imei) throw businessRuleError('SERIAL_IMEI_REQUIRED', `IMEI is required for ${item.sku}`, [{ path: `lines.${i}.serials`, message: `${s.serialNo} needs an IMEI` }]);
      }
    }
    // the same serial on two lines of the same item
    const all = new Map<string, string>();
    for (const l of lines) {
      const poLine = poLines.find((p) => p.id === l.poLineId)!;
      for (const s of l.serials) {
        const key = `${poLine.itemId}|${s.serialNo.toUpperCase()}`;
        if (all.has(key)) throw businessRuleError('GRN_SERIAL_DUPLICATE_IN_REQUEST', `Serial ${s.serialNo} appears on two lines`, [{ path: 'lines', message: `${s.serialNo} duplicated` }]);
        all.set(key, l.poLineId);
      }
    }
  }

  private async precheckSerials(tenantId: string, lines: GrnInput['lines'], poLines: PoRow['lines'], correlationId: string) {
    const byItem = new Map<string, string[]>();
    for (const l of lines) {
      const poLine = poLines.find((p) => p.id === l.poLineId)!;
      if (l.serials.length) byItem.set(poLine.itemId, [...(byItem.get(poLine.itemId) ?? []), ...l.serials.map((s) => s.serialNo)]);
    }
    for (const [itemId, serials] of byItem) {
      const check = await this.sources.inventory.serialsCheck(tenantId, itemId, serials, correlationId);
      if (check.duplicates.length) throw businessRuleError('SERIAL_DUPLICATE', `${check.duplicates.length} serial(s) already exist in stock: ${check.duplicates.slice(0, 10).join(', ')}`, [{ path: 'lines', message: 'Duplicate serials', duplicates: check.duplicates } as ErrorDetail]);
      if (check.invalidPattern.length) throw businessRuleError('SERIAL_PATTERN_MISMATCH', `Serials do not match the item pattern: ${check.invalidPattern.slice(0, 10).join(', ')}`, [{ path: 'lines', message: 'Pattern mismatch' }]);
    }
  }

  async createGrn(ctx: TenantContext, actor: Actor, input: GrnInput, idempotencyKey: string | null, receive: boolean) {
    const tenantId = ctx.tenantId!;
    const po = await this.tx(tenantId, (tx) => this.load(tx, input.poId));
    if (po.status !== 'ISSUED' && po.status !== 'PARTIALLY_RECEIVED') throw businessRuleError('PO_NOT_RECEIVABLE', `Purchase order ${po.number} is ${po.status} and cannot receive goods`, [{ path: 'poId', message: `Order is ${po.status}` }]);
    const warehouseId = input.warehouseId ?? po.shipToWarehouseId;
    const warehouse = await this.warehouseSnapshot(ctx, warehouseId, po.shipToSnapshot as unknown as WarehouseSnapshot);
    this.validateSerials(input.lines, po.lines);
    await this.precheckSerials(tenantId, input.lines, po.lines, actor.correlationId);
    const config = await this.numbering.configFor(tenantId, 'GRN', actor.correlationId);
    return this.tx(tenantId, async (tx) => {
      if (idempotencyKey) {
        const existing = await tx.grn.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } }, include: { lines: { include: { serials: true } } } });
        if (existing) return this.grnView(existing);
      }
      const id = uuidv7();
      const number = await nextDocumentNumber(tx, { tenantId, docType: 'GRN', config });
      await tx.grn.create({
        data: {
          id, tenantId, number, poId: po.id, supplierId: po.supplierId, supplierSnapshot: po.supplierSnapshot as Prisma.InputJsonValue, warehouseId: warehouse.id, warehouseSnapshot: warehouse as unknown as Prisma.InputJsonValue,
          receivedDate: new Date(input.receivedDate), supplierInvoiceNo: input.supplierInvoiceNo ?? null, supplierInvoiceDate: input.supplierInvoiceDate ? new Date(input.supplierInvoiceDate) : null, deliveryNoteNo: input.deliveryNoteNo ?? null, vehicleNo: input.vehicleNo ?? null,
          status: 'DRAFT', remarks: input.remarks ?? null, idempotencyKey, createdBy: actor.userId ?? SYSTEM_USER,
          lines: {
            create: input.lines.map((l, i) => {
              const poLine = po.lines.find((p) => p.id === l.poLineId)!;
              return { id: uuidv7(), tenantId, poLineId: l.poLineId, lineNo: i + 1, itemId: poLine.itemId, itemSnapshot: poLine.itemSnapshot as Prisma.InputJsonValue, qty: l.qty, unitCost: l.unitCost ?? n(poLine.unitPrice), binId: l.binId, conditionNote: l.conditionNote ?? null, serials: { create: l.serials.map((s) => ({ tenantId, serialNo: s.serialNo, imei: s.imei })) } };
            }),
          },
        },
      });
      await this.audit(tx, tenantId, actor, { action: 'GRN_CREATED', entityType: 'GRN', entityId: id, summary: `${number} against ${po.number}`, newValue: { poId: po.id, warehouseId: warehouse.id, lines: input.lines.length }, version: 0 });
      if (receive) return this.receiveIn(tx, tenantId, ctx, actor, id);
      return this.grnView(await this.loadGrn(tx, id));
    });
  }

  private async loadGrn(tx: Tx, id: string): Promise<GrnRow> {
    const grn = await tx.grn.findUnique({ where: { id }, include: { lines: { include: { serials: true }, orderBy: { lineNo: 'asc' } }, po: { select: { number: true } } } });
    if (!grn) throw notFound('Goods receipt not found');
    return grn;
  }

  async receiveGrn(ctx: TenantContext, actor: Actor, id: string) {
    return this.tx(ctx.tenantId!, (tx) => this.receiveIn(tx, ctx.tenantId!, ctx, actor, id));
  }

  /** Same transaction as the Phase 0 fix: lock PO + lines, guard over-receipt, update received_qty, emit. */
  private async receiveIn(tx: Tx, tenantId: string, ctx: TenantContext, actor: Actor, id: string) {
    const grn = await this.loadGrn(tx, id);
    if (grn.status !== 'DRAFT') throw conflict(`Goods receipt is ${grn.status}`, 'GRN_INVALID_TRANSITION');
    if (!inWarehouseScope(ctx, grn.warehouseId)) throw forbidden('This warehouse is outside your scope', 'GRN_WAREHOUSE_SCOPE');
    const po = await this.lockPo(tx, tenantId, grn.poId);
    if (po.status !== 'ISSUED' && po.status !== 'PARTIALLY_RECEIVED') throw businessRuleError('PO_NOT_RECEIVABLE', `Purchase order ${po.number} is ${po.status} and cannot receive goods`);
    const { overReceiptTolerancePct } = await this.settingsIn(tx, tenantId);
    for (const line of grn.lines) {
      const poLine = po.lines.find((p) => p.id === line.poLineId)!;
      const remaining = round3(n(poLine.orderedQty) - n(poLine.cancelledQty) - n(poLine.receivedQty));
      const allowed = round3(remaining + (n(poLine.orderedQty) * overReceiptTolerancePct) / 100);
      if (n(line.qty) > allowed + 1e-9) {
        throw businessRuleError('OVER_RECEIPT', `Line ${poLine.lineNo}: ${n(line.qty)} exceeds the ${remaining} still open on ${po.number}`, [{ path: `lines.${line.lineNo - 1}.qty`, message: 'Exceeds ordered quantity', poLineId: poLine.id, ordered: n(poLine.orderedQty), received: n(poLine.receivedQty), remaining, requested: n(line.qty) } as ErrorDetail]);
      }
      await tx.poLine.update({ where: { id: poLine.id }, data: { receivedQty: round3(n(poLine.receivedQty) + n(line.qty)) } });
    }
    const refreshed = await this.load(tx, po.id);
    const nextStatus = this.receiptStatus(refreshed, 'ISSUED');
    if (nextStatus !== po.status) {
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: nextStatus, version: { increment: 1 } } });
      await this.emitPo(tx, tenantId, { ...refreshed, status: nextStatus }, nextStatus === 'RECEIVED' ? EVENT_TYPES.PO_RECEIVED : EVENT_TYPES.PO_PARTIALLY_RECEIVED, actor, po.status, null);
    }
    const updated = await tx.grn.update({ where: { id }, data: { status: 'RECEIVED', receivedAt: new Date(), version: { increment: 1 } }, include: { lines: { include: { serials: true }, orderBy: { lineNo: 'asc' } } } });
    await this.audit(tx, tenantId, actor, { action: 'GRN_RECEIVED', entityType: 'GRN', entityId: id, summary: `${grn.number} received into ${(grn.warehouseSnapshot as { code?: string }).code ?? grn.warehouseId}`, newValue: { lines: grn.lines.map((l) => ({ poLineId: l.poLineId, qty: n(l.qty), serials: l.serials.length })) }, version: updated.version });
    await this.emitGrnReceived(tx, tenantId, updated, po, actor);
    return this.grnView(updated);
  }

  private async emitGrnReceived(tx: Tx, tenantId: string, grn: GrnRow, po: PoRow, actor: Actor) {
    await enqueueEvent(tx, PRODUCER, {
      eventType: EVENT_TYPES.GRN_RECEIVED,
      tenantId,
      aggregate: { type: 'grn', id: grn.id, version: grn.version },
      actor: { type: actor.userId ? 'user' : 'system', id: actor.userId, name: actor.name },
      correlationId: actor.correlationId,
      payload: {
        grnId: grn.id, grnNumber: grn.number, poId: po.id, poNumber: po.number, supplierId: grn.supplierId, warehouseId: grn.warehouseId, receivedDate: grn.receivedDate.toISOString().slice(0, 10),
        lines: grn.lines.map((l) => ({ grnLineId: l.id, poLineId: l.poLineId, itemId: l.itemId, itemSnapshot: l.itemSnapshot, qty: n(l.qty), unitCost: n(l.unitCost), binId: l.binId, serials: l.serials.map((s) => ({ serialNo: s.serialNo, imei: s.imei })) })),
      },
    });
  }

  async retryPosting(ctx: TenantContext, actor: Actor, id: string, replacement: Record<string, { serialNo: string; imei: string | null }[]> | null) {
    const tenantId = ctx.tenantId!;
    const grn = await this.tx(tenantId, (tx) => this.loadGrn(tx, id));
    if (!inWarehouseScope(ctx, grn.warehouseId)) throw notFound('Goods receipt not found');
    if (grn.status !== 'POSTING_FAILED') throw conflict(`Goods receipt is ${grn.status}; only failed postings can be retried`, 'GRN_INVALID_TRANSITION');
    const po = await this.tx(tenantId, (tx) => this.load(tx, grn.poId));
    const lines: GrnInput['lines'] = grn.lines.map((l) => ({ poLineId: l.poLineId, qty: n(l.qty), unitCost: n(l.unitCost), binId: l.binId, conditionNote: l.conditionNote, serials: replacement?.[l.id] ?? l.serials.map((s) => ({ serialNo: s.serialNo, imei: s.imei })) }));
    this.validateSerials(lines, po.lines);
    await this.precheckSerials(tenantId, lines, po.lines, actor.correlationId);
    return this.tx(tenantId, async (tx) => {
      if (replacement) {
        for (const [lineId, serials] of Object.entries(replacement)) {
          await tx.grnLineSerial.deleteMany({ where: { grnLineId: lineId } });
          await tx.grnLineSerial.createMany({ data: serials.map((s) => ({ tenantId, grnLineId: lineId, serialNo: s.serialNo, imei: s.imei })) });
        }
      }
      const updated = await tx.grn.update({ where: { id }, data: { status: 'RECEIVED', statusReason: null, version: { increment: 1 } }, include: { lines: { include: { serials: true }, orderBy: { lineNo: 'asc' } } } });
      await this.audit(tx, tenantId, actor, { action: 'GRN_POSTING_RETRIED', entityType: 'GRN', entityId: id, summary: grn.number, newValue: { replacedLines: replacement ? Object.keys(replacement).length : 0 }, version: updated.version });
      await this.emitGrnReceived(tx, tenantId, updated, po, actor);
      return this.grnView(updated);
    });
  }

  async cancelGrn(ctx: TenantContext, actor: Actor, id: string, reason: string) {
    const tenantId = ctx.tenantId!;
    return this.tx(tenantId, async (tx) => {
      const grn = await this.loadGrn(tx, id);
      if (!inWarehouseScope(ctx, grn.warehouseId)) throw notFound('Goods receipt not found');
      switch (grn.status) {
        case 'DRAFT': {
          const updated = await tx.grn.update({ where: { id }, data: { status: 'CANCELLED', statusReason: reason, cancelledAt: new Date(), version: { increment: 1 } }, include: { lines: { include: { serials: true } } } });
          await this.audit(tx, tenantId, actor, { action: 'GRN_CANCELLED', entityType: 'GRN', entityId: id, summary: grn.number, newValue: { reason }, version: updated.version });
          return this.grnView(updated);
        }
        case 'POSTING_FAILED':
          return this.finalizeCancellation(tx, tenantId, grn, actor, reason);
        case 'QC_PENDING': {
          const updated = await tx.grn.update({ where: { id }, data: { status: 'CANCELLATION_PENDING', statusReason: reason, version: { increment: 1 } }, include: { lines: { include: { serials: true } } } });
          await this.audit(tx, tenantId, actor, { action: 'GRN_CANCELLATION_REQUESTED', entityType: 'GRN', entityId: id, summary: grn.number, newValue: { reason }, version: updated.version });
          await enqueueEvent(tx, PRODUCER, { eventType: EVENT_TYPES.GRN_CANCELLATION_REQUESTED, tenantId, aggregate: { type: 'grn', id, version: updated.version }, actor: { type: actor.userId ? 'user' : 'system', id: actor.userId, name: actor.name }, correlationId: actor.correlationId, payload: { grnId: id, grnNumber: grn.number, reason, lineIds: grn.lines.map((l) => l.id) } });
          return this.grnView(updated);
        }
        case 'RECEIVED':
          throw conflict('The receipt is still being posted to inventory; retry in a moment', 'GRN_NOT_CANCELLABLE');
        case 'QC_COMPLETED':
          throw conflict('QC has completed for this receipt; use a supplier return instead', 'GRN_NOT_CANCELLABLE');
        default:
          throw conflict(`Goods receipt is ${grn.status}`, 'GRN_INVALID_TRANSITION');
      }
    });
  }

  /** Stock is back with the supplier (or never left): restore PO quantities and close the GRN. */
  private async finalizeCancellation(tx: Tx, tenantId: string, grn: GrnRow, actor: Actor, reason: string | null) {
    const po = await this.lockPo(tx, tenantId, grn.poId);
    for (const line of grn.lines) {
      const poLine = po.lines.find((p) => p.id === line.poLineId);
      if (poLine) await tx.poLine.update({ where: { id: poLine.id }, data: { receivedQty: Math.max(0, round3(n(poLine.receivedQty) - n(line.qty))) } });
    }
    const refreshed = await this.load(tx, po.id);
    if (['ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(po.status)) {
      const next = this.receiptStatus(refreshed, 'ISSUED');
      if (next !== po.status) {
        await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: next, version: { increment: 1 } } });
        await this.emitPo(tx, tenantId, { ...refreshed, status: next }, EVENT_TYPES.PO_RECEIPT_REVERSED, actor, po.status, reason);
      }
    }
    const updated = await tx.grn.update({ where: { id: grn.id }, data: { status: 'CANCELLED', statusReason: reason ?? grn.statusReason, cancelledAt: new Date(), version: { increment: 1 } }, include: { lines: { include: { serials: true } } } });
    await this.audit(tx, tenantId, actor, { action: 'GRN_CANCELLED', entityType: 'GRN', entityId: grn.id, summary: grn.number, oldValue: { status: grn.status }, newValue: { status: 'CANCELLED', reason }, version: updated.version });
    await enqueueEvent(tx, PRODUCER, { eventType: EVENT_TYPES.GRN_CANCELLED, tenantId, aggregate: { type: 'grn', id: grn.id, version: updated.version }, actor: { type: actor.userId ? 'user' : 'system', id: actor.userId, name: actor.name }, correlationId: actor.correlationId, payload: { grnId: grn.id, grnNumber: grn.number, poId: grn.poId, reason, lines: grn.lines.map((l) => ({ grnLineId: l.id, poLineId: l.poLineId, itemId: l.itemId, qty: n(l.qty) })) } });
    return this.grnView(updated);
  }

  grnView(g: GrnRow) {
    const lines = [...g.lines].sort((a, b) => a.lineNo - b.lineNo);
    return {
      id: g.id, number: g.number, poId: g.poId, poNumber: g.po?.number ?? null, supplierId: g.supplierId, supplier: g.supplierSnapshot, warehouseId: g.warehouseId, warehouse: g.warehouseSnapshot, receivedDate: g.receivedDate,
      supplierInvoiceNo: g.supplierInvoiceNo, supplierInvoiceDate: g.supplierInvoiceDate, deliveryNoteNo: g.deliveryNoteNo, vehicleNo: g.vehicleNo, status: g.status, statusReason: g.statusReason, remarks: g.remarks,
      receiptPostingId: g.receiptPostingId, createdBy: g.createdBy, receivedAt: g.receivedAt, cancelledAt: g.cancelledAt, createdAt: g.createdAt, updatedAt: g.updatedAt, version: g.version,
      qcProgress: { total: lines.length, done: lines.filter((l) => l.qcStatus === 'DONE').length, passQty: lines.reduce((s, l) => s + n(l.qcPassQty), 0), failQty: lines.reduce((s, l) => s + n(l.qcFailQty), 0) },
      lines: lines.map((l) => ({ id: l.id, lineNo: l.lineNo, poLineId: l.poLineId, itemId: l.itemId, item: l.itemSnapshot, qty: n(l.qty), unitCost: n(l.unitCost), binId: l.binId, conditionNote: l.conditionNote, qcStatus: l.qcStatus, qcPassQty: n(l.qcPassQty), qcFailQty: n(l.qcFailQty), lotId: l.lotId, serials: (l.serials ?? []).map((s) => ({ serialNo: s.serialNo, imei: s.imei })) })),
    };
  }

  async getGrn(ctx: TenantContext, id: string) {
    return this.tx(ctx.tenantId!, async (tx) => {
      const grn = await this.loadGrn(tx, id);
      if (!inWarehouseScope(ctx, grn.warehouseId)) throw notFound('Goods receipt not found');
      return this.grnView(grn);
    });
  }

  async listGrns(ctx: TenantContext, q: { status?: string; poId?: string; warehouseId?: string; q?: string; limit: number }) {
    return this.tx(ctx.tenantId!, async (tx) => {
      const search: Prisma.StringFilter = { contains: q.q ?? '', mode: 'insensitive' };
      const rows = await tx.grn.findMany({
        where: {
          status: q.status, poId: q.poId, warehouseId: q.warehouseId ?? (ctx.warehouseIds ? { in: ctx.warehouseIds } : undefined),
          ...(q.q ? { OR: [{ number: search }, { supplierInvoiceNo: search }, { po: { number: search } }] } : {}),
        },
        include: { lines: { include: { serials: true } }, po: { select: { number: true } } }, orderBy: { createdAt: 'desc' }, take: q.limit,
      });
      return rows.map((r) => this.grnView(r));
    });
  }

  /* ---- event handlers (consumers) --------------------------------------------------------------- */

  private system(correlationId: string): Actor {
    return { userId: null, name: 'system', correlationId };
  }

  async onReceiptPosted(tx: Tx, tenantId: string, p: { grnId: string; postingId: string }, correlationId: string): Promise<void> {
    const grn = await tx.grn.findUnique({ where: { id: p.grnId } });
    if (!grn || grn.tenantId !== tenantId || grn.status !== 'RECEIVED') return;
    const updated = await tx.grn.update({ where: { id: grn.id }, data: { status: 'QC_PENDING', receiptPostingId: p.postingId, statusReason: null, version: { increment: 1 } } });
    await this.audit(tx, tenantId, this.system(correlationId), { action: 'GRN_POSTED_TO_INVENTORY', entityType: 'GRN', entityId: grn.id, summary: grn.number, newValue: { postingId: p.postingId }, version: updated.version });
  }

  async onReceiptRejected(tx: Tx, tenantId: string, p: { grnId: string; reason: string; code: string; duplicates: string[] }, correlationId: string): Promise<void> {
    const grn = await tx.grn.findUnique({ where: { id: p.grnId } });
    if (!grn || grn.tenantId !== tenantId || grn.status !== 'RECEIVED') return;
    const reason = `${p.code}: ${p.reason}${p.duplicates.length ? ` [${p.duplicates.join(', ')}]` : ''}`.slice(0, 500);
    const updated = await tx.grn.update({ where: { id: grn.id }, data: { status: 'POSTING_FAILED', statusReason: reason, version: { increment: 1 } } });
    await this.audit(tx, tenantId, this.system(correlationId), { action: 'GRN_POSTING_FAILED', entityType: 'GRN', entityId: grn.id, summary: grn.number, newValue: { reason }, version: updated.version });
  }

  async onQcPostingRecorded(tx: Tx, tenantId: string, p: { lotId: string; grnId: string; grnLineId: string; passQty: number; failQty: number }, correlationId: string): Promise<void> {
    const line = await tx.grnLine.findUnique({ where: { id: p.grnLineId }, include: { grn: true } });
    if (!line || line.tenantId !== tenantId || line.grn.id !== p.grnId) return;
    await tx.grnLine.update({ where: { id: line.id }, data: { qcStatus: 'DONE', qcPassQty: p.passQty, qcFailQty: p.failQty, lotId: p.lotId } });
    const lines = await tx.grnLine.findMany({ where: { grnId: p.grnId } });
    if (!lines.every((l) => l.qcStatus === 'DONE')) return;
    if (!['QC_PENDING', 'CANCELLATION_PENDING'].includes(line.grn.status)) return;
    const updated = await tx.grn.update({ where: { id: p.grnId }, data: { status: 'QC_COMPLETED', statusReason: null, version: { increment: 1 } } });
    const actor = this.system(correlationId);
    await this.audit(tx, tenantId, actor, { action: 'GRN_QC_COMPLETED', entityType: 'GRN', entityId: p.grnId, summary: line.grn.number, newValue: { passQty: lines.reduce((s, l) => s + n(l.qcPassQty), 0), failQty: lines.reduce((s, l) => s + n(l.qcFailQty), 0) }, version: updated.version });
    await enqueueEvent(tx, PRODUCER, { eventType: EVENT_TYPES.GRN_QC_COMPLETED, tenantId, aggregate: { type: 'grn', id: p.grnId, version: updated.version }, actor: { type: 'system', id: null, name: 'system' }, correlationId, payload: { grnId: p.grnId, grnNumber: line.grn.number, poId: line.grn.poId, passQty: lines.reduce((s, l) => s + n(l.qcPassQty), 0), failQty: lines.reduce((s, l) => s + n(l.qcFailQty), 0) } });
    // auto-close a fully received PO once every receipt has completed QC
    const po = await this.lockPo(tx, tenantId, line.grn.poId);
    const { closeRequiresQc } = await this.settingsIn(tx, tenantId);
    if (po.status === 'RECEIVED' && closeRequiresQc) {
      const pending = await tx.grn.count({ where: { poId: po.id, status: { notIn: ['QC_COMPLETED', 'CANCELLED'] } } });
      if (!pending) {
        await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: 'CLOSED', closedAt: new Date(), statusReason: 'All receipts passed QC', version: { increment: 1 } } });
        const closed = await this.load(tx, po.id);
        await this.audit(tx, tenantId, actor, { action: 'PO_CLOSED', entityType: 'PURCHASE_ORDER', entityId: po.id, summary: `${po.number} closed automatically`, oldValue: { status: 'RECEIVED' }, newValue: { status: 'CLOSED' }, version: closed.version });
        await this.emitPo(tx, tenantId, closed, EVENT_TYPES.PO_CLOSED, actor, 'RECEIVED', 'All receipts passed QC');
      }
    }
  }

  async onQcCancellationRefused(tx: Tx, tenantId: string, p: { grnId: string; reason: string }, correlationId: string): Promise<void> {
    const grn = await tx.grn.findUnique({ where: { id: p.grnId } });
    if (!grn || grn.tenantId !== tenantId || grn.status !== 'CANCELLATION_PENDING') return;
    const updated = await tx.grn.update({ where: { id: grn.id }, data: { status: 'QC_PENDING', statusReason: `Cancellation refused: ${p.reason}`.slice(0, 500), version: { increment: 1 } } });
    await this.audit(tx, tenantId, this.system(correlationId), { action: 'GRN_CANCELLATION_REFUSED', entityType: 'GRN', entityId: grn.id, summary: grn.number, newValue: { reason: p.reason }, version: updated.version });
  }

  async onReceiptReversed(tx: Tx, tenantId: string, p: { grnId: string; grnLineId: string | null }, correlationId: string): Promise<void> {
    const grn = await tx.grn.findUnique({ where: { id: p.grnId }, include: { lines: { include: { serials: true } } } });
    if (!grn || grn.tenantId !== tenantId || grn.status !== 'CANCELLATION_PENDING') return;
    if (p.grnLineId) await tx.grnLine.update({ where: { id: p.grnLineId }, data: { qcStatus: 'REVERSED' } });
    const lines = await tx.grnLine.findMany({ where: { grnId: grn.id } });
    if (!lines.every((l) => l.qcStatus === 'REVERSED')) return;
    await this.finalizeCancellation(tx, tenantId, grn, this.system(correlationId), grn.statusReason);
  }

  async onReversalRefused(tx: Tx, tenantId: string, p: { grnId: string; reason: string }, correlationId: string): Promise<void> {
    const grn = await tx.grn.findUnique({ where: { id: p.grnId } });
    if (!grn || grn.tenantId !== tenantId || grn.status !== 'CANCELLATION_PENDING') return;
    const updated = await tx.grn.update({ where: { id: grn.id }, data: { status: 'QC_PENDING', statusReason: `Reversal refused by inventory: ${p.reason}. Review manually.`.slice(0, 500), version: { increment: 1 } } });
    await this.audit(tx, tenantId, this.system(correlationId), { action: 'GRN_REVERSAL_REFUSED', entityType: 'GRN', entityId: grn.id, summary: grn.number, newValue: { reason: p.reason }, version: updated.version });
  }

  /* ---- attachments --------------------------------------------------------------------------------- */

  async presign(ctx: TenantContext, actor: Actor, input: { entityType: 'PO' | 'GRN'; entityId: string; fileName: string; contentType: string; sizeBytes: number }) {
    const tenantId = ctx.tenantId!;
    return this.tx(tenantId, async (tx) => {
      if (input.entityType === 'PO') await this.load(tx, input.entityId);
      else await this.loadGrn(tx, input.entityId);
      const id = uuidv7();
      const objectKey = `tenants/${tenantId}/${input.entityType.toLowerCase()}/${input.entityId}/${id}-${input.fileName.replace(/[^A-Za-z0-9._-]/g, '_')}`;
      await tx.documentAttachment.create({ data: { id, tenantId, entityType: input.entityType, entityId: input.entityId, objectKey, fileName: input.fileName, contentType: input.contentType, sizeBytes: BigInt(input.sizeBytes), uploadedBy: actor.userId ?? SYSTEM_USER } });
      await this.audit(tx, tenantId, actor, { action: 'ATTACHMENT_ADDED', entityType: input.entityType === 'PO' ? 'PURCHASE_ORDER' : 'GRN', entityId: input.entityId, summary: input.fileName, newValue: { attachmentId: id, contentType: input.contentType, sizeBytes: input.sizeBytes } });
      return { attachmentId: id, objectKey, uploadUrl: await this.storage.presign(objectKey, input.contentType) };
    });
  }

  async attachments(ctx: TenantContext, entityType: string, entityId: string) {
    return this.tx(ctx.tenantId!, async (tx) => (await tx.documentAttachment.findMany({ where: { entityType, entityId }, orderBy: { uploadedAt: 'asc' } })).map((a) => ({ ...a, sizeBytes: Number(a.sizeBytes) })));
  }
}

export { HttpError };
