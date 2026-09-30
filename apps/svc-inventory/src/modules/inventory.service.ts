/**
 * Inventory domain (phase-04). Everything that changes stock goes through the posting engine; this
 * class adds the user-facing documents (opening stock, adjustments with approval, bin moves), the
 * read models (stock pivot, ledger, serials), the internal APIs for other services, and the
 * reconciliation report.
 */
import { EVENT_TYPES, type ProductSnapshot, type WarehouseSnapshot } from '@b2b/contracts';
import { HttpError, businessRuleError, conflict, enqueueEvent, forbidden, inWarehouseScope, nextDocumentNumber, notFound, setTenantContext, uuidv7, type NumberingSource, type TenantContext } from '@b2b/platform-kit';
import { Prisma, type PrismaClient, type Tx } from '../db.js';
import { ON_HAND_BUCKETS, POSTING_RULES, REENTRY_BUCKETS, UNBINNED, WAREHOUSE_BUCKETS, type Bucket, type PostingType } from './buckets.js';
import type { AdjustmentInput, BinMoveInput, OpeningStockInput } from './inventory.schema.js';
import { PRODUCER, loadItems, postInTx, type PostingLineInput, type PostingRequest, type PostingResult, type PostingSerialInput } from './posting.engine.js';

export interface Actor {
  userId: string | null;
  name: string | null;
  correlationId: string;
}
export const actorFrom = (ctx: TenantContext): Actor => ({ userId: ctx.userId, name: ctx.userName, correlationId: ctx.correlationId });

const num = (v: Prisma.Decimal | number | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));
const round2 = (n: number) => Math.round(n * 100) / 100;

type AdjustmentRow = Prisma.InventoryAdjustmentGetPayload<{ include: { lines: true } }>;

export class InventoryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly numbering: NumberingSource,
  ) {}

  tx<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, tenantId);
      return fn(tx);
    }, { maxWait: 20_000, timeout: 30_000 });
  }

  platformTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, null);
      return fn(tx);
    }, { maxWait: 20_000, timeout: 60_000 });
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

  /* ---- local replicas of master data ---------------------------------------- */

  async upsertItemRef(tx: Tx, s: ProductSnapshot): Promise<void> {
    const existing = await tx.itemRef.findUnique({ where: { id: s.id } });
    if (existing && existing.version > s.version) return;
    const data = { tenantId: s.tenantId, sku: s.sku, name: s.name, trackInventory: s.trackInventory, isSerialized: s.isSerialized, requiresImei: s.requiresImei, serialPattern: s.serialPattern, qcRequired: s.qcRequired, unitCode: s.unitCode, status: s.status, version: s.version, specs: s.specs ? (s.specs as Prisma.InputJsonValue) : Prisma.DbNull };
    await tx.itemRef.upsert({ where: { id: s.id }, update: data, create: { id: s.id, ...data } });
  }

  async upsertWarehouseRef(tx: Tx, s: WarehouseSnapshot): Promise<void> {
    const existing = await tx.warehouseRef.findUnique({ where: { id: s.id } });
    if (existing && existing.version > s.version) return;
    const data = { tenantId: s.tenantId, code: s.code, name: s.name, status: s.status, version: s.version };
    await tx.warehouseRef.upsert({ where: { id: s.id }, update: data, create: { id: s.id, ...data } });
  }

  async upsertBinRef(tx: Tx, s: { id: string; tenantId: string; warehouseId: string; code: string; status: string; version: number }): Promise<void> {
    const existing = await tx.binRef.findUnique({ where: { id: s.id } });
    if (existing && existing.version > s.version) return;
    const data = { tenantId: s.tenantId, warehouseId: s.warehouseId, code: s.code, status: s.status, version: s.version };
    await tx.binRef.upsert({ where: { id: s.id }, update: data, create: { id: s.id, ...data } });
  }

  /* ---- engine entry points ---------------------------------------------------- */

  post(tenantId: string, req: PostingRequest): Promise<PostingResult> {
    return this.tx(tenantId, (tx) => postInTx(tx, tenantId, req));
  }

  /** Internal endpoint: per-type caller allow-list (phase-04 4.6). */
  postFromService(tenantId: string, caller: string, req: Omit<PostingRequest, 'requestedByService'>): Promise<PostingResult> {
    const rule = POSTING_RULES[req.postingType];
    if (!rule) throw businessRuleError('INV_POSTING_TYPE_NOT_ALLOWED', `Unknown posting type ${req.postingType}`);
    if (!rule.callers.includes(caller)) throw forbidden(`${caller} may not record ${req.postingType} postings`, 'INV_POSTING_TYPE_NOT_ALLOWED');
    return this.post(tenantId, { ...req, requestedByService: caller });
  }

  private async requireWarehouse(tx: Tx, ctx: TenantContext, warehouseId: string) {
    const w = await tx.warehouseRef.findUnique({ where: { id: warehouseId } });
    if (!w) throw notFound('Warehouse not found');
    if (!inWarehouseScope(ctx, warehouseId)) throw forbidden('This warehouse is outside your scope', 'WAREHOUSE_SCOPE');
    if (w.status !== 'ACTIVE') throw businessRuleError('INV_WAREHOUSE_UNKNOWN', `Warehouse ${w.code} is inactive`);
    return w;
  }

  /* ---- opening stock ----------------------------------------------------------- */

  async openingStock(ctx: TenantContext, actor: Actor, input: OpeningStockInput) {
    const tenantId = ctx.tenantId!;
    return this.tx(tenantId, async (tx) => {
      const wh = await this.requireWarehouse(tx, ctx, input.warehouseId);
      const items = await loadItems(tx, input.lines.map((l) => l.itemId));
      const lines: PostingLineInput[] = [];
      const serials: PostingSerialInput[] = [];
      for (const [i, l] of input.lines.entries()) {
        const item = items.get(l.itemId);
        if (!item) throw businessRuleError('INV_ITEM_NOT_STOCKED', 'Item is unknown to inventory', [{ path: `lines.${i}.itemId`, message: 'Unknown item' }]);
        // Serialises concurrent openings of the same item in the same warehouse so the "no movements yet" rule cannot be raced.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:${l.itemId}:${wh.id}`}))`;
        const moved = await tx.stockMovement.findFirst({ where: { itemId: l.itemId, warehouseId: wh.id }, select: { id: true } });
        if (moved) throw businessRuleError('INV_OPENING_NOT_ALLOWED', `Item ${item.sku} already has movements in ${wh.code}; use an adjustment instead`, [{ path: `lines.${i}.itemId`, message: 'Item already has stock movements in this warehouse' }]);
        const fromLineNo = lines.push({ itemId: l.itemId, warehouseId: null, binId: null, partyId: null, bucket: 'EXT_OPENING', qty: -l.qty, unitCost: null, gradeCode: null });
        const toLineNo = lines.push({ itemId: l.itemId, warehouseId: wh.id, binId: l.binId, partyId: null, bucket: l.bucket, qty: l.qty, unitCost: l.unitCost, gradeCode: l.gradeCode });
        for (const s of l.serials) serials.push({ itemId: l.itemId, serialNo: s.serialNo, imei: s.imei, gradeCode: s.gradeCode ?? l.gradeCode, fromLineNo, toLineNo });
      }
      const refId = uuidv7();
      const result = await postInTx(tx, tenantId, { postingType: 'OPENING', refType: 'OPENING', refId, refNumber: null, idempotencyKey: `OPENING:${refId}`, requestedByService: PRODUCER, actorId: actor.userId, actorName: actor.name, correlationId: actor.correlationId, lines, serials }, items);
      await this.audit(tx, tenantId, actor, { action: 'OPENING_STOCK_RECORDED', entityType: 'STOCK_POSTING', entityId: result.postingId, summary: `${input.lines.length} line(s) into ${wh.code}`, newValue: { warehouseId: wh.id, lines: input.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, bucket: l.bucket })), notes: input.notes ?? null } });
      return { postingId: result.postingId, refId, warehouseId: wh.id, lines: result.lines, serials: result.serials.length };
    });
  }

  /** CSV/JSON import: one posting per row so a bad row never blocks the others; per-row results. */
  async importOpeningStock(ctx: TenantContext, actor: Actor, rows: (OpeningStockInput['lines'][number] & { warehouseId: string })[]) {
    const results: { row: number; status: 'POSTED' | 'FAILED'; postingId?: string; error?: { code: string; message: string } }[] = [];
    for (const [i, row] of rows.entries()) {
      try {
        const r = await this.openingStock(ctx, actor, { warehouseId: row.warehouseId, notes: null, lines: [row] });
        results.push({ row: i + 1, status: 'POSTED', postingId: r.postingId });
      } catch (err) {
        const e = err as HttpError;
        results.push({ row: i + 1, status: 'FAILED', error: { code: e.code ?? 'INTERNAL', message: e.message } });
      }
    }
    return { total: rows.length, posted: results.filter((r) => r.status === 'POSTED').length, failed: results.filter((r) => r.status === 'FAILED').length, results };
  }

  /* ---- adjustments -------------------------------------------------------------- */

  async createAdjustment(ctx: TenantContext, actor: Actor, input: AdjustmentInput) {
    const tenantId = ctx.tenantId!;
    const config = await this.numbering.configFor(tenantId, 'ADJ', actor.correlationId);
    return this.tx(tenantId, async (tx) => {
      const wh = await this.requireWarehouse(tx, ctx, input.warehouseId);
      const items = await loadItems(tx, input.lines.map((l) => l.itemId));
      for (const [i, l] of input.lines.entries()) {
        const item = items.get(l.itemId);
        if (!item || !item.trackInventory) throw businessRuleError('INV_ITEM_NOT_STOCKED', 'Item is unknown or does not track inventory', [{ path: `lines.${i}.itemId`, message: 'Item does not track inventory' }]);
        if (item.isSerialized) {
          if (!Number.isInteger(l.qtyDelta)) throw businessRuleError('INV_NON_INTEGER_SERIALIZED_QTY', `Serialized item ${item.sku} needs whole quantities`, [{ path: `lines.${i}.qtyDelta`, message: 'Whole quantities only' }]);
          if (l.serialNumbers.length !== Math.abs(l.qtyDelta)) throw businessRuleError('SERIAL_COUNT_MISMATCH', `Line ${i + 1}: ${Math.abs(l.qtyDelta)} unit(s) but ${l.serialNumbers.length} serial(s)`, [{ path: `lines.${i}.serialNumbers`, message: 'One serial per unit' }]);
        } else if (l.serialNumbers.length) {
          throw businessRuleError('INV_ITEM_NOT_SERIALIZED', `Item ${item.sku} is not serialized`, [{ path: `lines.${i}.serialNumbers`, message: 'Item is not serialized' }]);
        }
        if (l.binId) {
          const bin = await tx.binRef.findUnique({ where: { id: l.binId } });
          if (!bin || bin.warehouseId !== wh.id) throw businessRuleError('INV_BIN_UNKNOWN', 'Bin is unknown or belongs to another warehouse', [{ path: `lines.${i}.binId`, message: 'Unknown bin' }]);
        }
      }
      const id = uuidv7();
      const number = await nextDocumentNumber(tx, { tenantId, docType: 'ADJ', config });
      await tx.inventoryAdjustment.create({
        data: {
          id, tenantId, number, warehouseId: wh.id, reasonCode: input.reasonCode, notes: input.notes ?? null, status: 'DRAFT', createdBy: actor.userId ?? UNBINNED,
          lines: { create: input.lines.map((l, i) => ({ id: uuidv7(), tenantId, lineNo: i + 1, itemId: l.itemId, binId: l.binId, bucket: l.bucket, qtyDelta: l.qtyDelta, unitCost: l.unitCost, serialNumbers: l.serialNumbers })) },
        },
      });
      await this.audit(tx, tenantId, actor, { action: 'ADJUSTMENT_CREATED', entityType: 'ADJUSTMENT', entityId: id, summary: number, newValue: { warehouseId: wh.id, reasonCode: input.reasonCode, lines: input.lines.length }, version: 0 });
      return this.adjustmentView(await tx.inventoryAdjustment.findUniqueOrThrow({ where: { id }, include: { lines: true } }));
    });
  }

  private async loadAdjustment(tx: Tx, id: string): Promise<AdjustmentRow> {
    const adj = await tx.inventoryAdjustment.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!adj) throw notFound('Adjustment not found');
    return adj;
  }

  private async adjustmentValue(tx: Tx, tenantId: string, adj: AdjustmentRow): Promise<number> {
    let value = 0;
    for (const l of adj.lines) {
      let cost = num(l.unitCost);
      if (cost === null) {
        const c = await tx.itemCost.findUnique({ where: { tenantId_itemId_warehouseId: { tenantId, itemId: l.itemId, warehouseId: adj.warehouseId } } });
        cost = c ? Number(c.avgCost) : 0;
      }
      value += Math.abs(Number(l.qtyDelta) * cost);
    }
    return round2(value);
  }

  async getSettings(tenantId: string) {
    return this.tx(tenantId, async (tx) => this.settingsIn(tx, tenantId));
  }
  private async settingsIn(tx: Tx, tenantId: string) {
    const s = await tx.inventorySettings.findUnique({ where: { tenantId } });
    return { adjustmentApprovalThreshold: s ? Number(s.adjustmentApprovalThreshold) : 25000 };
  }
  async updateSettings(tenantId: string, actor: Actor, input: { adjustmentApprovalThreshold: number }) {
    return this.tx(tenantId, async (tx) => {
      const before = await this.settingsIn(tx, tenantId);
      await tx.inventorySettings.upsert({ where: { tenantId }, update: { adjustmentApprovalThreshold: input.adjustmentApprovalThreshold }, create: { tenantId, adjustmentApprovalThreshold: input.adjustmentApprovalThreshold } });
      await this.audit(tx, tenantId, actor, { action: 'INVENTORY_SETTINGS_UPDATED', entityType: 'INVENTORY_SETTINGS', entityId: tenantId, oldValue: before, newValue: input });
      return this.settingsIn(tx, tenantId);
    });
  }

  async submitAdjustment(ctx: TenantContext, actor: Actor, id: string) {
    const tenantId = ctx.tenantId!;
    return this.tx(tenantId, async (tx) => {
      const adj = await this.loadAdjustment(tx, id);
      if (!inWarehouseScope(ctx, adj.warehouseId)) throw forbidden('This warehouse is outside your scope', 'WAREHOUSE_SCOPE');
      if (adj.status !== 'DRAFT') throw conflict(`Adjustment is ${adj.status}; only DRAFT adjustments can be submitted`, 'INV_ADJUSTMENT_INVALID_TRANSITION');
      const value = await this.adjustmentValue(tx, tenantId, adj);
      const { adjustmentApprovalThreshold } = await this.settingsIn(tx, tenantId);
      if (value >= adjustmentApprovalThreshold) {
        const updated = await tx.inventoryAdjustment.update({ where: { id }, data: { status: 'PENDING_APPROVAL', totalValue: value, submittedBy: actor.userId, version: { increment: 1 } }, include: { lines: true } });
        await this.audit(tx, tenantId, actor, { action: 'ADJUSTMENT_SUBMITTED', entityType: 'ADJUSTMENT', entityId: id, summary: `${adj.number} needs approval (value ${value})`, oldValue: { status: 'DRAFT' }, newValue: { status: 'PENDING_APPROVAL', totalValue: value }, version: updated.version });
        return this.adjustmentView(updated);
      }
      await tx.inventoryAdjustment.update({ where: { id }, data: { totalValue: value, submittedBy: actor.userId } });
      return this.postAdjustment(tx, tenantId, { ...adj, totalValue: new Prisma.Decimal(value) }, actor, null);
    });
  }

  async approveAdjustment(ctx: TenantContext, actor: Actor, id: string) {
    const tenantId = ctx.tenantId!;
    return this.tx(tenantId, async (tx) => {
      const adj = await this.loadAdjustment(tx, id);
      if (!inWarehouseScope(ctx, adj.warehouseId)) throw forbidden('This warehouse is outside your scope', 'WAREHOUSE_SCOPE');
      if (adj.status !== 'PENDING_APPROVAL') throw conflict(`Adjustment is ${adj.status}; only PENDING_APPROVAL adjustments can be approved`, 'INV_ADJUSTMENT_INVALID_TRANSITION');
      if (actor.userId && (adj.submittedBy === actor.userId || adj.createdBy === actor.userId)) throw conflict('The person who raised an adjustment cannot approve it', 'INV_ADJUSTMENT_SELF_APPROVAL');
      return this.postAdjustment(tx, tenantId, adj, actor, actor.userId);
    });
  }

  async cancelAdjustment(ctx: TenantContext, actor: Actor, id: string, reason: string | null) {
    const tenantId = ctx.tenantId!;
    return this.tx(tenantId, async (tx) => {
      const adj = await this.loadAdjustment(tx, id);
      if (!inWarehouseScope(ctx, adj.warehouseId)) throw forbidden('This warehouse is outside your scope', 'WAREHOUSE_SCOPE');
      if (adj.status !== 'DRAFT' && adj.status !== 'PENDING_APPROVAL') throw conflict(`Adjustment is ${adj.status} and cannot be cancelled`, 'INV_ADJUSTMENT_INVALID_TRANSITION');
      const updated = await tx.inventoryAdjustment.update({ where: { id }, data: { status: 'CANCELLED', statusReason: reason, version: { increment: 1 } }, include: { lines: true } });
      await this.audit(tx, tenantId, actor, { action: 'ADJUSTMENT_CANCELLED', entityType: 'ADJUSTMENT', entityId: id, summary: adj.number, oldValue: { status: adj.status }, newValue: { status: 'CANCELLED', reason }, version: updated.version });
      return this.adjustmentView(updated);
    });
  }

  private async postAdjustment(tx: Tx, tenantId: string, adj: AdjustmentRow, actor: Actor, approvedBy: string | null) {
    const items = await loadItems(tx, adj.lines.map((l) => l.itemId));
    const build = (direction: 'IN' | 'OUT') => {
      const lines: PostingLineInput[] = [];
      const serials: PostingSerialInput[] = [];
      for (const l of adj.lines) {
        const qty = Number(l.qtyDelta);
        if ((direction === 'IN') !== qty > 0) continue;
        const abs = Math.abs(qty);
        let from: number;
        let to: number;
        if (direction === 'IN') {
          from = lines.push({ itemId: l.itemId, warehouseId: null, binId: null, partyId: null, bucket: 'EXT_ADJUSTMENT', qty: -abs, unitCost: null, gradeCode: null });
          to = lines.push({ itemId: l.itemId, warehouseId: adj.warehouseId, binId: l.binId, partyId: null, bucket: l.bucket as Bucket, qty: abs, unitCost: num(l.unitCost), gradeCode: null });
        } else {
          from = lines.push({ itemId: l.itemId, warehouseId: adj.warehouseId, binId: l.binId, partyId: null, bucket: l.bucket as Bucket, qty: -abs, unitCost: null, gradeCode: null });
          to = lines.push({ itemId: l.itemId, warehouseId: null, binId: null, partyId: null, bucket: 'EXT_ADJUSTMENT', qty: abs, unitCost: null, gradeCode: null });
        }
        for (const s of l.serialNumbers) serials.push({ itemId: l.itemId, serialNo: s, fromLineNo: from, toLineNo: to });
      }
      return { lines, serials };
    };
    const postingIds: string[] = [];
    for (const direction of ['IN', 'OUT'] as const) {
      const { lines, serials } = build(direction);
      if (!lines.length) continue;
      const r = await postInTx(tx, tenantId, { postingType: direction === 'IN' ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT', refType: 'ADJUSTMENT', refId: adj.id, refNumber: adj.number, idempotencyKey: `ADJ:${adj.id}:${direction}`, requestedByService: PRODUCER, actorId: actor.userId, actorName: actor.name, correlationId: actor.correlationId, lines, serials }, items);
      postingIds.push(r.postingId);
    }
    const updated = await tx.inventoryAdjustment.update({ where: { id: adj.id }, data: { status: 'POSTED', postingIds, approvedBy, postedAt: new Date(), version: { increment: 1 } }, include: { lines: true } });
    await this.audit(tx, tenantId, actor, { action: approvedBy ? 'ADJUSTMENT_APPROVED' : 'ADJUSTMENT_POSTED', entityType: 'ADJUSTMENT', entityId: adj.id, summary: `${adj.number} posted (value ${Number(updated.totalValue)})`, oldValue: { status: adj.status }, newValue: { status: 'POSTED', postingIds, approvedBy }, version: updated.version });
    await enqueueEvent(tx, PRODUCER, {
      eventType: EVENT_TYPES.INVENTORY_ADJUSTMENT_POSTED,
      tenantId,
      aggregate: { type: 'adjustment', id: adj.id, version: updated.version },
      actor: { type: actor.userId ? 'user' : 'system', id: actor.userId, name: actor.name },
      correlationId: actor.correlationId,
      payload: { adjustmentId: adj.id, number: adj.number, warehouseId: adj.warehouseId, reasonCode: adj.reasonCode, totalValue: Number(updated.totalValue), postingIds, approvedBy, lines: adj.lines.map((l) => ({ itemId: l.itemId, bucket: l.bucket, qtyDelta: Number(l.qtyDelta) })) },
    });
    return this.adjustmentView(updated);
  }

  private adjustmentView(a: AdjustmentRow) {
    return {
      id: a.id, number: a.number, warehouseId: a.warehouseId, reasonCode: a.reasonCode, notes: a.notes, status: a.status, statusReason: a.statusReason, totalValue: Number(a.totalValue), postingIds: a.postingIds,
      createdBy: a.createdBy, submittedBy: a.submittedBy, approvedBy: a.approvedBy, postedAt: a.postedAt, createdAt: a.createdAt, updatedAt: a.updatedAt, version: a.version,
      lines: [...a.lines].sort((x, y) => x.lineNo - y.lineNo).map((l) => ({ id: l.id, lineNo: l.lineNo, itemId: l.itemId, binId: l.binId, bucket: l.bucket, qtyDelta: Number(l.qtyDelta), unitCost: num(l.unitCost), serialNumbers: l.serialNumbers })),
    };
  }

  async getAdjustment(ctx: TenantContext, id: string) {
    return this.tx(ctx.tenantId!, async (tx) => {
      const adj = await this.loadAdjustment(tx, id);
      if (!inWarehouseScope(ctx, adj.warehouseId)) throw notFound('Adjustment not found');
      return this.adjustmentView(adj);
    });
  }

  async listAdjustments(ctx: TenantContext, q: { status?: string; warehouseId?: string; limit: number }) {
    return this.tx(ctx.tenantId!, async (tx) => {
      const rows = await tx.inventoryAdjustment.findMany({ where: { status: q.status, warehouseId: q.warehouseId ?? (ctx.warehouseIds ? { in: ctx.warehouseIds } : undefined) }, include: { lines: true }, orderBy: { createdAt: 'desc' }, take: q.limit });
      return rows.map((r) => this.adjustmentView(r));
    });
  }

  /* ---- bin moves ------------------------------------------------------------------ */

  async binMove(ctx: TenantContext, actor: Actor, input: BinMoveInput) {
    const tenantId = ctx.tenantId!;
    if ((input.fromBinId ?? null) === (input.toBinId ?? null)) throw businessRuleError('INV_BIN_MOVE_INVALID', 'Source and destination bin are the same', [{ path: 'toBinId', message: 'Choose a different bin' }]);
    return this.tx(tenantId, async (tx) => {
      const wh = await this.requireWarehouse(tx, ctx, input.warehouseId);
      const items = await loadItems(tx, [input.itemId]);
      const item = items.get(input.itemId);
      if (!item) throw businessRuleError('INV_ITEM_NOT_STOCKED', 'Item is unknown to inventory', [{ path: 'itemId', message: 'Unknown item' }]);
      if (item.isSerialized && input.serialNumbers.length !== input.qty) throw businessRuleError('SERIAL_COUNT_MISMATCH', `${input.qty} unit(s) but ${input.serialNumbers.length} serial(s)`, [{ path: 'serialNumbers', message: 'One serial per unit' }]);
      const refId = uuidv7();
      const lines: PostingLineInput[] = [
        { itemId: input.itemId, warehouseId: wh.id, binId: input.fromBinId, partyId: null, bucket: input.bucket, qty: -input.qty, unitCost: null, gradeCode: null },
        { itemId: input.itemId, warehouseId: wh.id, binId: input.toBinId, partyId: null, bucket: input.bucket, qty: input.qty, unitCost: null, gradeCode: null },
      ];
      const result = await postInTx(tx, tenantId, { postingType: 'BIN_MOVE', refType: 'BIN_MOVE', refId, idempotencyKey: `BINMOVE:${refId}`, requestedByService: PRODUCER, actorId: actor.userId, actorName: actor.name, correlationId: actor.correlationId, lines, serials: input.serialNumbers.map((s) => ({ itemId: input.itemId, serialNo: s, fromLineNo: 1, toLineNo: 2 })) }, items);
      await this.audit(tx, tenantId, actor, { action: 'BIN_MOVE', entityType: 'STOCK_POSTING', entityId: result.postingId, summary: `${item.sku} x ${input.qty} ${input.fromBinId ?? 'unbinned'} -> ${input.toBinId ?? 'unbinned'}`, newValue: { warehouseId: wh.id, itemId: input.itemId, qty: input.qty, fromBinId: input.fromBinId, toBinId: input.toBinId, bucket: input.bucket } });
      return { postingId: result.postingId, refId, lines: result.lines, serials: result.serials.length };
    });
  }

  /* ---- reads ------------------------------------------------------------------------ */

  private scopeSql(ctx: TenantContext, column: Prisma.Sql): Prisma.Sql {
    return ctx.warehouseIds ? Prisma.sql`AND ${column} IN (${ctx.warehouseIds.length ? Prisma.join(ctx.warehouseIds.map((id) => Prisma.sql`${id}::uuid`)) : Prisma.sql`NULL`})` : Prisma.empty;
  }

  async stock(ctx: TenantContext, q: { warehouseId?: string; itemId?: string; bucket?: string; q?: string; limit: number }) {
    const tenantId = ctx.tenantId!;
    return this.tx(tenantId, async (tx) => {
      const search = q.q ? `%${q.q}%` : null;
      const rows = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
        SELECT b.item_id AS "itemId", b.warehouse_id AS "warehouseId", i.sku, i.name, i.specs, i.is_serialized AS "isSerialized", i.unit_code AS "unitCode", w.code AS "warehouseCode", w.name AS "warehouseName",
          coalesce(sum(b.qty) FILTER (WHERE b.bucket = 'QC_HOLD'), 0)::float8 AS "qcHold",
          coalesce(sum(b.qty) FILTER (WHERE b.bucket = 'AVAILABLE'), 0)::float8 AS "available",
          coalesce(sum(b.qty) FILTER (WHERE b.bucket = 'RESERVED'), 0)::float8 AS "reserved",
          coalesce(sum(b.qty) FILTER (WHERE b.bucket = 'REJECTED'), 0)::float8 AS "rejected",
          coalesce(sum(b.qty) FILTER (WHERE b.bucket = 'IN_TRANSIT'), 0)::float8 AS "inTransit",
          coalesce(sum(b.qty) FILTER (WHERE b.bucket IN ('QC_HOLD','AVAILABLE','RESERVED','REJECTED')), 0)::float8 AS "onHand",
          c.avg_cost::float8 AS "avgCost"
        FROM stock_balances b
        JOIN item_refs i ON i.id = b.item_id
        JOIN warehouse_refs w ON w.id = b.warehouse_id
        LEFT JOIN item_cost c ON c.tenant_id = b.tenant_id AND c.item_id = b.item_id AND c.warehouse_id = b.warehouse_id
        WHERE b.tenant_id = ${tenantId}::uuid
          ${q.warehouseId ? Prisma.sql`AND b.warehouse_id = ${q.warehouseId}::uuid` : Prisma.empty}
          ${q.itemId ? Prisma.sql`AND b.item_id = ${q.itemId}::uuid` : Prisma.empty}
          ${search ? Prisma.sql`AND (i.sku ILIKE ${search} OR i.name ILIKE ${search} OR i.specs::text ILIKE ${search})` : Prisma.empty}
          ${this.scopeSql(ctx, Prisma.sql`b.warehouse_id`)}
        GROUP BY b.item_id, b.warehouse_id, i.sku, i.name, i.specs, i.is_serialized, i.unit_code, w.code, w.name, c.avg_cost
        HAVING sum(b.qty) <> 0 ${q.bucket ? Prisma.sql`AND coalesce(sum(b.qty) FILTER (WHERE b.bucket = ${q.bucket}), 0) > 0` : Prisma.empty}
        ORDER BY i.sku, w.code
        LIMIT ${q.limit}`);
      return rows;
    });
  }

  async stockByItem(ctx: TenantContext, itemId: string) {
    const tenantId = ctx.tenantId!;
    return this.tx(tenantId, async (tx) => {
      const item = await tx.itemRef.findUnique({ where: { id: itemId } });
      if (!item) throw notFound('Item not found');
      const scope = this.scopeSql(ctx, Prisma.sql`b.warehouse_id`);
      const byWarehouse = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
        SELECT b.warehouse_id AS "warehouseId", w.code AS "warehouseCode", b.bucket, sum(b.qty)::float8 AS qty
        FROM stock_balances b JOIN warehouse_refs w ON w.id = b.warehouse_id
        WHERE b.tenant_id = ${tenantId}::uuid AND b.item_id = ${itemId}::uuid AND b.qty <> 0 ${scope}
        GROUP BY b.warehouse_id, w.code, b.bucket ORDER BY w.code, b.bucket`);
      const byBin = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
        SELECT b.warehouse_id AS "warehouseId", CASE WHEN b.bin_id = ${UNBINNED}::uuid THEN NULL ELSE b.bin_id END AS "binId", r.code AS "binCode", b.bucket, b.qty::float8 AS qty
        FROM stock_balances b LEFT JOIN bin_refs r ON r.id = b.bin_id
        WHERE b.tenant_id = ${tenantId}::uuid AND b.item_id = ${itemId}::uuid AND b.qty <> 0 ${scope}
        ORDER BY b.warehouse_id, r.code NULLS FIRST, b.bucket`);
      const byGrade = item.isSerialized
        ? await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
          SELECT b.warehouse_id AS "warehouseId", b.bucket, b.grade_code AS "gradeCode", count(*)::int AS qty
          FROM serial_units b WHERE b.tenant_id = ${tenantId}::uuid AND b.item_id = ${itemId}::uuid AND b.warehouse_id IS NOT NULL ${scope}
          GROUP BY b.warehouse_id, b.bucket, b.grade_code ORDER BY b.warehouse_id, b.bucket, b.grade_code`)
        : [];
      const customers = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`SELECT party_id AS "partyId", qty::float8 AS qty FROM customer_stock_balances WHERE tenant_id = ${tenantId}::uuid AND item_id = ${itemId}::uuid AND qty <> 0`);
      const cost = await tx.itemCost.findMany({ where: { tenantId, itemId } });
      return { item: { id: item.id, sku: item.sku, name: item.name, isSerialized: item.isSerialized, unitCode: item.unitCode, specs: item.specs ?? null }, byWarehouse, byBin, byGrade, delivered: customers, cost: cost.map((c) => ({ warehouseId: c.warehouseId, avgCost: Number(c.avgCost), qtyBasis: Number(c.qtyBasis) })) };
    });
  }

  async ledger(ctx: TenantContext, q: { itemId?: string; warehouseId?: string; from?: string; to?: string; refType?: string; limit: number }) {
    const tenantId = ctx.tenantId!;
    return this.tx(tenantId, async (tx) => {
      const rows = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
        SELECT m.id, m.posting_id AS "postingId", p.posting_type AS "postingType", p.ref_type AS "refType", p.ref_id AS "refId", p.ref_number AS "refNumber", p.requested_by_service AS "requestedBy", p.actor_id AS "actorId",
          m.line_no AS "lineNo", m.item_id AS "itemId", i.sku, i.name, m.warehouse_id AS "warehouseId", m.bin_id AS "binId", m.party_id AS "partyId", m.bucket, m.qty::float8 AS qty, m.unit_cost::float8 AS "unitCost", m.grade_code AS "gradeCode", m.created_at AS "createdAt"
        FROM stock_movements m JOIN stock_postings p ON p.id = m.posting_id JOIN item_refs i ON i.id = m.item_id
        WHERE m.tenant_id = ${tenantId}::uuid
          ${q.itemId ? Prisma.sql`AND m.item_id = ${q.itemId}::uuid` : Prisma.empty}
          ${q.warehouseId ? Prisma.sql`AND m.warehouse_id = ${q.warehouseId}::uuid` : Prisma.empty}
          ${q.from ? Prisma.sql`AND m.created_at >= ${new Date(q.from)}` : Prisma.empty}
          ${q.to ? Prisma.sql`AND m.created_at <= ${new Date(q.to)}` : Prisma.empty}
          ${q.refType ? Prisma.sql`AND p.ref_type = ${q.refType}` : Prisma.empty}
          ${ctx.warehouseIds ? Prisma.sql`AND (m.warehouse_id IS NULL OR m.warehouse_id IN (${ctx.warehouseIds.length ? Prisma.join(ctx.warehouseIds.map((id) => Prisma.sql`${id}::uuid`)) : Prisma.sql`NULL`}))` : Prisma.empty}
        ORDER BY m.created_at ASC, m.posting_id ASC, m.line_no ASC
        LIMIT ${q.limit}`);
      let running = 0;
      const withBalance = rows.map((r) => {
        const onHand = ON_HAND_BUCKETS.includes(r.bucket as Bucket) && r.warehouseId;
        if (q.itemId && onHand) running = Math.round((running + (r.qty as number)) * 1000) / 1000;
        return { ...r, runningOnHand: q.itemId ? running : null };
      });
      return withBalance.reverse();
    });
  }

  private serialView(u: Prisma.SerialUnitGetPayload<Record<string, never>>) {
    return { id: u.id, itemId: u.itemId, serialNo: u.serialNo, imei: u.imei, bucket: u.bucket, warehouseId: u.warehouseId, binId: u.binId, partyId: u.partyId, gradeCode: u.gradeCode, qcStatus: u.qcStatus, unitCost: num(u.unitCost), poId: u.poId, grnId: u.grnId, qcLotId: u.qcLotId, soId: u.soId, reservationId: u.reservationId, dcId: u.dcId, shipmentId: u.shipmentId, warrantyEnd: u.warrantyEnd, version: Number(u.version), createdAt: u.createdAt, updatedAt: u.updatedAt };
  }

  async serials(ctx: TenantContext, q: { q?: string; itemId?: string; bucket?: string; warehouseId?: string; limit: number }) {
    const tenantId = ctx.tenantId!;
    return this.tx(tenantId, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT s.id FROM serial_units s WHERE s.tenant_id = ${tenantId}::uuid
          ${q.q ? Prisma.sql`AND (upper(s.serial_no) LIKE ${`%${q.q.toUpperCase()}%`} OR s.imei LIKE ${`%${q.q}%`})` : Prisma.empty}
          ${q.itemId ? Prisma.sql`AND s.item_id = ${q.itemId}::uuid` : Prisma.empty}
          ${q.bucket ? Prisma.sql`AND s.bucket = ${q.bucket}` : Prisma.empty}
          ${q.warehouseId ? Prisma.sql`AND s.warehouse_id = ${q.warehouseId}::uuid` : Prisma.empty}
          ${ctx.warehouseIds ? Prisma.sql`AND (s.warehouse_id IS NULL OR s.warehouse_id IN (${ctx.warehouseIds.length ? Prisma.join(ctx.warehouseIds.map((id) => Prisma.sql`${id}::uuid`)) : Prisma.sql`NULL`}))` : Prisma.empty}
        ORDER BY s.updated_at DESC LIMIT ${q.limit}`);
      const units = await tx.serialUnit.findMany({ where: { id: { in: rows.map((r) => r.id) } } });
      const byId = new Map(units.map((u) => [u.id, u]));
      return rows.map((r) => this.serialView(byId.get(r.id)!));
    });
  }

  async serial(ctx: TenantContext, id: string) {
    return this.tx(ctx.tenantId!, async (tx) => {
      const u = await tx.serialUnit.findUnique({ where: { id } });
      if (!u || (u.warehouseId && !inWarehouseScope(ctx, u.warehouseId))) throw notFound('Serial number not found');
      const item = await tx.itemRef.findUnique({ where: { id: u.itemId } });
      return { ...this.serialView(u), item: item ? { sku: item.sku, name: item.name, specs: item.specs ?? null } : null };
    });
  }

  async serialHistory(ctx: TenantContext, id: string) {
    return this.tx(ctx.tenantId!, async (tx) => {
      const u = await tx.serialUnit.findUnique({ where: { id } });
      if (!u || (u.warehouseId && !inWarehouseScope(ctx, u.warehouseId))) throw notFound('Serial number not found');
      const events = await tx.serialEvent.findMany({ where: { serialUnitId: id }, include: { posting: true }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] });
      return events.map((e) => ({ id: e.id, postingId: e.postingId, postingType: e.posting.postingType, fromBucket: e.fromBucket, toBucket: e.toBucket, warehouseId: e.warehouseId, binId: e.binId, partyId: e.partyId, refType: e.refType, refId: e.refId, refNumber: e.refNumber, actorId: e.posting.actorId, occurredAt: e.occurredAt }));
    });
  }

  /* ---- internal ---------------------------------------------------------------------- */

  hasMovements(tenantId: string, itemId: string): Promise<boolean> {
    return this.tx(tenantId, async (tx) => Boolean(await tx.stockMovement.findFirst({ where: { itemId }, select: { id: true } })));
  }

  async serialsCheck(tenantId: string, itemId: string, serials: string[]) {
    return this.tx(tenantId, async (tx) => {
      const item = await tx.itemRef.findUnique({ where: { id: itemId } });
      if (!item) throw notFound('Item not found');
      const invalidPattern: string[] = [];
      const duplicatesInRequest: string[] = [];
      const seen = new Set<string>();
      for (const s of serials) {
        const key = s.trim().toUpperCase();
        if (seen.has(key)) duplicatesInRequest.push(s);
        seen.add(key);
        if (item.serialPattern && !new RegExp(item.serialPattern).test(s.trim())) invalidPattern.push(s);
      }
      const existing = await tx.$queryRaw<{ serial_no: string; bucket: string }[]>(Prisma.sql`SELECT serial_no, bucket FROM serial_units WHERE tenant_id = ${tenantId}::uuid AND item_id = ${itemId}::uuid AND upper(serial_no) IN (${Prisma.join([...seen])})`);
      const duplicates = existing.filter((e) => !REENTRY_BUCKETS.includes(e.bucket as Bucket)).map((e) => e.serial_no);
      return { itemId, isSerialized: item.isSerialized, duplicates, duplicatesInRequest, invalidPattern, ok: duplicates.length === 0 && duplicatesInRequest.length === 0 && invalidPattern.length === 0 };
    });
  }

  async availability(tenantId: string, itemIds: string[], warehouseId: string | null) {
    return this.tx(tenantId, async (tx) => {
      const rows = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
        SELECT item_id AS "itemId", warehouse_id AS "warehouseId",
          coalesce(sum(qty) FILTER (WHERE bucket = 'AVAILABLE'), 0)::float8 AS available,
          coalesce(sum(qty) FILTER (WHERE bucket = 'RESERVED'), 0)::float8 AS reserved,
          coalesce(sum(qty) FILTER (WHERE bucket = 'QC_HOLD'), 0)::float8 AS "qcHold",
          coalesce(sum(qty) FILTER (WHERE bucket = 'REJECTED'), 0)::float8 AS rejected,
          coalesce(sum(qty) FILTER (WHERE bucket = 'IN_TRANSIT'), 0)::float8 AS "inTransit"
        FROM stock_balances WHERE tenant_id = ${tenantId}::uuid AND item_id IN (${Prisma.join(itemIds.map((id) => Prisma.sql`${id}::uuid`))})
          ${warehouseId ? Prisma.sql`AND warehouse_id = ${warehouseId}::uuid` : Prisma.empty}
        GROUP BY item_id, warehouse_id ORDER BY item_id, warehouse_id`);
      return itemIds.map((id) => ({ itemId: id, warehouses: rows.filter((r) => r.itemId === id), available: rows.filter((r) => r.itemId === id).reduce((s, r) => s + (r.available as number), 0) }));
    });
  }

  /** Ledger vs balances, per-posting balance, serial counts vs balances. Empty lists = healthy. */
  async reconciliation(tenantId: string) {
    const unbinned = Prisma.raw(`'${UNBINNED}'::uuid`);
    return this.tx(tenantId, async (tx) => {
      const ledgerMismatches = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
        WITH ledger AS (
          SELECT item_id, warehouse_id, coalesce(bin_id, ${unbinned}) AS bin_id, bucket, sum(qty) AS qty
          FROM stock_movements WHERE tenant_id = ${tenantId}::uuid AND bucket IN ('QC_HOLD','AVAILABLE','RESERVED','REJECTED','IN_TRANSIT')
          GROUP BY item_id, warehouse_id, coalesce(bin_id, ${unbinned}), bucket)
        SELECT coalesce(l.item_id, b.item_id) AS "itemId", coalesce(l.warehouse_id, b.warehouse_id) AS "warehouseId", coalesce(l.bin_id, b.bin_id) AS "binId", coalesce(l.bucket, b.bucket) AS bucket,
          coalesce(l.qty, 0)::float8 AS "ledgerQty", coalesce(b.qty, 0)::float8 AS "balanceQty"
        FROM ledger l FULL OUTER JOIN stock_balances b ON b.tenant_id = ${tenantId}::uuid AND b.item_id = l.item_id AND b.warehouse_id = l.warehouse_id AND b.bin_id = l.bin_id AND b.bucket = l.bucket
        WHERE (b.tenant_id IS NULL OR b.tenant_id = ${tenantId}::uuid) AND coalesce(l.qty, 0) <> coalesce(b.qty, 0)`);
      const unbalancedPostings = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
        SELECT posting_id AS "postingId", item_id AS "itemId", sum(qty)::float8 AS sum FROM stock_movements WHERE tenant_id = ${tenantId}::uuid GROUP BY posting_id, item_id HAVING sum(qty) <> 0`);
      const serialMismatches = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
        WITH counts AS (
          SELECT s.item_id, s.warehouse_id, coalesce(s.bin_id, ${unbinned}) AS bin_id, s.bucket, count(*)::numeric AS qty
          FROM serial_units s WHERE s.tenant_id = ${tenantId}::uuid AND s.warehouse_id IS NOT NULL AND s.bucket IN ('QC_HOLD','AVAILABLE','RESERVED','REJECTED','IN_TRANSIT')
          GROUP BY s.item_id, s.warehouse_id, coalesce(s.bin_id, ${unbinned}), s.bucket),
        bal AS (
          SELECT b.item_id, b.warehouse_id, b.bin_id, b.bucket, b.qty FROM stock_balances b JOIN item_refs i ON i.id = b.item_id
          WHERE b.tenant_id = ${tenantId}::uuid AND i.is_serialized AND b.qty <> 0)
        SELECT coalesce(c.item_id, b.item_id) AS "itemId", coalesce(c.warehouse_id, b.warehouse_id) AS "warehouseId", coalesce(c.bin_id, b.bin_id) AS "binId", coalesce(c.bucket, b.bucket) AS bucket,
          coalesce(c.qty, 0)::float8 AS "serialCount", coalesce(b.qty, 0)::float8 AS "balanceQty"
        FROM counts c FULL OUTER JOIN bal b ON b.item_id = c.item_id AND b.warehouse_id = c.warehouse_id AND b.bin_id = c.bin_id AND b.bucket = c.bucket
        WHERE coalesce(c.qty, 0) <> coalesce(b.qty, 0)`);
      const negative = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`SELECT item_id AS "itemId", warehouse_id AS "warehouseId", bucket, qty::float8 AS qty FROM stock_balances WHERE tenant_id = ${tenantId}::uuid AND qty < 0`);
      // Callers see the unbinned sentinel as null, like every other read model.
      const nullBin = (rows: Record<string, unknown>[]) => rows.map((r) => (r.binId === UNBINNED ? { ...r, binId: null } : r));
      return { checkedAt: new Date().toISOString(), ok: !ledgerMismatches.length && !unbalancedPostings.length && !serialMismatches.length && !negative.length, ledgerMismatches: nullBin(ledgerMismatches), unbalancedPostings, serialMismatches: nullBin(serialMismatches), negativeBalances: negative };
    });
  }

  async tenantsWithStock(): Promise<string[]> {
    const rows = await this.platformTx((tx) => tx.$queryRaw<{ tenant_id: string }[]>`SELECT DISTINCT tenant_id FROM stock_postings`);
    return rows.map((r) => r.tenant_id);
  }
}

export type { PostingType, Bucket };
export { WAREHOUSE_BUCKETS };
