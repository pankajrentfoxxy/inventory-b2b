/**
 * QC domain (phase-05 5.3 / 5.6). Lots are created from `inventory.receipt.posted.v1` (one per
 * source line, unique), inspected, decided; the decision event drives QC_PASS / QC_FAIL postings in
 * svc-inventory and the lot closes on `inventory.qc_posting.recorded.v1`. Items with
 * `qcRequired=false` are auto-decided PASS by the system so every unit passes through one ledger path.
 */
import { EVENT_TYPES, LAPTOP_SPEC_FIELDS, type LaptopSpecs, type ReceiptPostedPayload } from '@b2b/contracts';
import { businessRuleError, conflict, enqueueEvent, forbidden, inWarehouseScope, nextDocumentNumber, notFound, setTenantContext, uuidv7, type NumberingSource, type TenantContext } from '@b2b/platform-kit';
import { Prisma, type PrismaClient, type Tx } from '../db.js';
import type { ChecklistInput, DecideInput, ResultsInput } from './qc.schema.js';

export const PRODUCER = 'svc-qc';

export interface Actor {
  userId: string | null;
  name: string | null;
  correlationId: string;
}
export const actorFrom = (ctx: TenantContext): Actor => ({ userId: ctx.userId, name: ctx.userName, correlationId: ctx.correlationId });
const SYSTEM: Actor = { userId: null, name: 'system', correlationId: 'system' };

type LotRow = Prisma.QcLotGetPayload<{ include: { results: true } }>;
type ChecklistRow = Prisma.QcChecklistGetPayload<{ include: { items: true } }>;

export class QcService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly numbering: NumberingSource,
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

  /* ---- lot creation (consumer) ------------------------------------------------- */

  private async pickChecklist(tx: Tx, tenantId: string, itemId: string): Promise<ChecklistRow | null> {
    const lists = await tx.qcChecklist.findMany({ where: { tenantId, status: 'ACTIVE' }, include: { items: true } });
    const specific = lists.find((c) => ((c.appliesTo as { itemIds?: string[] }).itemIds ?? []).includes(itemId));
    return specific ?? lists.find((c) => (c.appliesTo as { isDefault?: boolean }).isDefault) ?? null;
  }

  /** Creates one lot per receipt line; redelivery is a no-op thanks to the unique source line. */
  async createLotsFromReceipt(tx: Tx, tenantId: string, receipt: ReceiptPostedPayload, correlationId: string): Promise<void> {
    const config = await this.numbering.configFor(tenantId, 'QC', correlationId);
    for (const line of receipt.lines) {
      const existing = await tx.qcLot.findUnique({ where: { tenantId_sourceType_sourceLineId: { tenantId, sourceType: 'GRN', sourceLineId: line.grnLineId } } });
      if (existing) continue;
      const checklist = await this.pickChecklist(tx, tenantId, line.itemId);
      const id = uuidv7();
      const number = await nextDocumentNumber(tx, { tenantId, docType: 'QC', config });
      await tx.qcLot.create({
        data: {
          id, tenantId, number, sourceType: 'GRN', sourceId: receipt.grnId, sourceLineId: line.grnLineId, sourceNumber: receipt.grnNumber ?? null,
          itemId: line.itemId, itemSnapshot: line.itemSnapshot as Prisma.InputJsonValue, warehouseId: receipt.warehouseId, binId: line.binId ?? null,
          mode: line.isSerialized ? 'SERIAL' : 'QUANTITY', qty: line.qty, serials: line.serials, checklistId: checklist?.id ?? null, checklistVersion: checklist?.version ?? null,
          status: 'OPEN',
        },
      });
      await enqueueEvent(tx, PRODUCER, { eventType: EVENT_TYPES.QC_LOT_CREATED, tenantId, aggregate: { type: 'qc_lot', id, version: 0 }, actor: { type: 'system', id: null, name: 'system' }, correlationId, payload: { lotId: id, number, grnId: receipt.grnId, grnLineId: line.grnLineId, itemId: line.itemId, warehouseId: receipt.warehouseId, qty: line.qty, mode: line.isSerialized ? 'SERIAL' : 'QUANTITY', qcRequired: line.qcRequired } });
      if (!line.qcRequired) {
        const lot = await tx.qcLot.findUniqueOrThrow({ where: { id }, include: { results: true } });
        await this.decideIn(tx, tenantId, lot, { ...SYSTEM, correlationId }, { passQty: line.qty, failQty: 0, gradeCode: null, defectCodes: [], remarks: 'Auto-passed: item does not require QC' }, true);
      }
    }
  }

  /* ---- inspection ------------------------------------------------------------------ */

  private async loadLot(tx: Tx, ctx: TenantContext, id: string): Promise<LotRow> {
    const lot = await tx.qcLot.findUnique({ where: { id }, include: { results: { orderBy: { inspectedAt: 'asc' } } } });
    if (!lot || !inWarehouseScope(ctx, lot.warehouseId)) throw notFound('QC lot not found');
    return lot;
  }

  private guardOpen(lot: LotRow) {
    if (lot.status === 'CANCELLED') throw conflict('This lot was cancelled with its receipt', 'QC_LOT_CANCELLED');
    if (lot.status === 'CLOSED') throw conflict('This lot has already been posted to inventory', 'QC_ALREADY_POSTED');
  }

  async start(ctx: TenantContext, actor: Actor, id: string) {
    return this.tx(ctx.tenantId!, async (tx) => {
      const lot = await this.loadLot(tx, ctx, id);
      this.guardOpen(lot);
      if (lot.status !== 'OPEN') throw conflict(`Lot is ${lot.status}`, 'QC_INVALID_TRANSITION');
      const updated = await tx.qcLot.update({ where: { id }, data: { status: 'IN_INSPECTION', inspectorId: actor.userId, startedAt: new Date(), version: { increment: 1 } }, include: { results: true } });
      await this.audit(tx, ctx.tenantId!, actor, { action: 'QC_STARTED', entityType: 'QC_LOT', entityId: id, summary: lot.number, version: updated.version });
      return this.view(updated);
    });
  }

  async recordResults(ctx: TenantContext, actor: Actor, id: string, input: ResultsInput) {
    return this.tx(ctx.tenantId!, async (tx) => {
      const lot = await this.loadLot(tx, ctx, id);
      this.guardOpen(lot);
      if (lot.status === 'DECIDED') throw conflict('Lot is already decided; reopen it first', 'QC_INVALID_TRANSITION');
      const checklist = lot.checklistId ? await tx.qcChecklist.findUnique({ where: { id: lot.checklistId }, include: { items: true } }) : null;
      const defects = new Set((await tx.qcDefectCode.findMany({ where: { tenantId: ctx.tenantId!, status: 'ACTIVE' } })).map((d) => d.code));
      const expected = laptopSpecsOf(lot);
      for (const [i, r] of input.results.entries()) {
        const label = lot.mode === 'SERIAL' ? r.serialNo : r.serialNo ?? `sample-${i + 1}`;
        if (!label) throw businessRuleError('QC_RESULTS_INCOMPLETE', 'Serial number is required for serialized lots', [{ path: `results.${i}.serialNo`, message: 'Serial is required' }]);
        if (lot.mode === 'SERIAL' && !lot.serials.some((s) => s.toUpperCase() === label.toUpperCase())) throw businessRuleError('QC_RESULTS_INCOMPLETE', `Serial ${label} is not part of this lot`, [{ path: `results.${i}.serialNo`, message: 'Not in this lot' }]);
        let result: string = r.result;
        const systemDefects: string[] = [];
        if (expected) {
          const outcome = checkLaptop(r, i, label ?? '');
          result = outcome.result;
          systemDefects.push(...outcome.defects);
        } else if (r.result === 'HOLD') {
          throw businessRuleError('VALIDATION_FAILED', 'HOLD is available for laptop lots only', [{ path: `results.${i}.result`, message: 'Use PASS or FAIL' }]);
        }
        if (checklist) {
          for (const item of checklist.items) {
            const answer = r.checklistAnswers[item.id] ?? r.checklistAnswers[item.label];
            if (item.critical && (answer === 'FAIL' || answer === false)) result = 'FAIL';
            if (item.kind === 'NUMERIC' && typeof answer === 'number' && item.critical && ((item.minValue !== null && answer < Number(item.minValue)) || (item.maxValue !== null && answer > Number(item.maxValue)))) result = 'FAIL';
          }
        }
        const defectCodes = [...new Set([...systemDefects, ...r.defectCodes])];
        if (result === 'FAIL' && defectCodes.length === 0) throw businessRuleError('QC_DEFECT_REQUIRED', `A failed unit needs at least one defect code (${label})`, [{ path: `results.${i}.defectCodes`, message: 'Defect code is required' }]);
        for (const d of r.defectCodes) if (defects.size && !defects.has(d)) throw businessRuleError('QC_DEFECT_REQUIRED', `Unknown defect code ${d}`, [{ path: `results.${i}.defectCodes`, message: `Unknown code ${d}` }]);
        const canonical = lot.mode === 'SERIAL' ? lot.serials.find((s) => s.toUpperCase() === label.toUpperCase())! : label;
        const laptopCheck = expected && r.laptop ? (r.laptop as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
        await tx.qcUnitResult.upsert({
          where: { lotId_serialNo: { lotId: id, serialNo: canonical } },
          update: { result, gradeCode: r.gradeCode ?? null, defectCodes, remarks: r.remarks ?? null, checklistAnswers: r.checklistAnswers as Prisma.InputJsonValue, laptopCheck, inspectedBy: actor.userId ?? '00000000-0000-0000-0000-000000000000', inspectedAt: new Date() },
          create: { id: uuidv7(), tenantId: ctx.tenantId!, lotId: id, serialNo: canonical, result, gradeCode: r.gradeCode ?? null, defectCodes, remarks: r.remarks ?? null, checklistAnswers: r.checklistAnswers as Prisma.InputJsonValue, laptopCheck, inspectedBy: actor.userId ?? '00000000-0000-0000-0000-000000000000' },
        });
      }
      const data: Prisma.QcLotUpdateInput = { version: { increment: 1 } };
      if (lot.status === 'OPEN') Object.assign(data, { status: 'IN_INSPECTION', inspectorId: actor.userId, startedAt: new Date() });
      const updated = await tx.qcLot.update({ where: { id }, data, include: { results: { orderBy: { inspectedAt: 'asc' } } } });
      await this.audit(tx, ctx.tenantId!, actor, { action: 'QC_RESULTS_RECORDED', entityType: 'QC_LOT', entityId: id, summary: `${input.results.length} result(s) on ${lot.number}`, version: updated.version });
      return this.view(updated);
    });
  }

  async decide(ctx: TenantContext, actor: Actor, id: string, input: DecideInput) {
    return this.tx(ctx.tenantId!, async (tx) => {
      const lot = await this.loadLot(tx, ctx, id);
      this.guardOpen(lot);
      if (lot.status === 'DECIDED') throw conflict('Lot is already decided', 'QC_INVALID_TRANSITION');
      return this.decideIn(tx, ctx.tenantId!, lot, actor, input, false);
    });
  }

  private async decideIn(tx: Tx, tenantId: string, lot: LotRow, actor: Actor, input: DecideInput, system: boolean) {
    const qty = Number(lot.qty);
    let passQty: number;
    let failQty: number;
    let serials: { serialNo: string; result: 'PASS' | 'FAIL'; gradeCode: string | null; defectCodes: string[] }[] = [];
    if (lot.mode === 'SERIAL' && !system) {
      const results = await tx.qcUnitResult.findMany({ where: { lotId: lot.id } });
      const missing = lot.serials.filter((s) => !results.some((r) => r.serialNo === s));
      if (missing.length) throw businessRuleError('QC_RESULTS_INCOMPLETE', `${missing.length} serial(s) have no result yet`, [{ path: 'results', message: missing.slice(0, 20).join(', ') }]);
      const held = results.filter((r) => r.result === 'HOLD').map((r) => r.serialNo);
      if (held.length) throw businessRuleError('QC_UNITS_ON_HOLD', `${held.length} laptop(s) are on hold; pass or fail them before deciding the lot`, [{ path: 'results', message: held.slice(0, 20).join(', ') }]);
      serials = lot.serials.map((s) => {
        const r = results.find((x) => x.serialNo === s)!;
        return { serialNo: s, result: r.result as 'PASS' | 'FAIL', gradeCode: r.gradeCode ?? input.gradeCode ?? null, defectCodes: r.defectCodes };
      });
      passQty = serials.filter((s) => s.result === 'PASS').length;
      failQty = serials.length - passQty;
    } else if (lot.mode === 'SERIAL') {
      serials = lot.serials.map((s) => ({ serialNo: s, result: 'PASS' as const, gradeCode: input.gradeCode ?? null, defectCodes: [] }));
      passQty = serials.length;
      failQty = 0;
    } else {
      passQty = input.passQty ?? 0;
      failQty = input.failQty ?? 0;
      if (Math.round((passQty + failQty) * 1000) / 1000 !== qty) throw businessRuleError('QC_RESULTS_INCOMPLETE', `Pass + fail must equal the lot quantity ${qty}`, [{ path: 'passQty', message: `passQty + failQty must be ${qty}` }]);
      if (failQty > 0 && input.defectCodes.length === 0) throw businessRuleError('QC_DEFECT_REQUIRED', 'Failed quantity needs at least one defect code', [{ path: 'defectCodes', message: 'Defect code is required' }]);
    }
    const updated = await tx.qcLot.update({ where: { id: lot.id }, data: { status: 'DECIDED', passQty, failQty, decidedAt: new Date(), decidedBy: actor.userId, statusReason: input.remarks ?? null, version: { increment: 1 } }, include: { results: true } });
    await this.audit(tx, tenantId, actor, { action: system ? 'QC_AUTO_PASSED' : 'QC_DECIDED', entityType: 'QC_LOT', entityId: lot.id, summary: `${lot.number}: pass ${passQty}, fail ${failQty}`, newValue: { passQty, failQty, defectCodes: input.defectCodes }, version: updated.version });
    const snapshot = lot.itemSnapshot as { sku?: string; name?: string };
    await enqueueEvent(tx, PRODUCER, {
      eventType: EVENT_TYPES.QC_LOT_DECIDED,
      tenantId,
      aggregate: { type: 'qc_lot', id: lot.id, version: updated.version },
      actor: { type: actor.userId ? 'user' : 'system', id: actor.userId, name: actor.name },
      correlationId: actor.correlationId,
      payload: { lotId: lot.id, lotNumber: lot.number, sourceType: lot.sourceType, sourceId: lot.sourceId, sourceLineId: lot.sourceLineId, itemId: lot.itemId, warehouseId: lot.warehouseId, mode: lot.mode, binId: lot.binId, passQty, failQty, serials, decidedBy: actor.userId, gradeCode: input.gradeCode ?? null, defectCodes: input.defectCodes, sku: snapshot.sku ?? null },
    });
    return this.view(updated);
  }

  async reopen(ctx: TenantContext, actor: Actor, id: string, reason: string | null) {
    return this.tx(ctx.tenantId!, async (tx) => {
      const lot = await this.loadLot(tx, ctx, id);
      this.guardOpen(lot);
      if (lot.status !== 'DECIDED') throw conflict(`Lot is ${lot.status}; only decided lots can be reopened`, 'QC_INVALID_TRANSITION');
      const updated = await tx.qcLot.update({ where: { id }, data: { status: 'IN_INSPECTION', passQty: 0, failQty: 0, decidedAt: null, decidedBy: null, statusReason: reason, version: { increment: 1 } }, include: { results: true } });
      await this.audit(tx, ctx.tenantId!, actor, { action: 'QC_REOPENED', entityType: 'QC_LOT', entityId: id, summary: lot.number, newValue: { reason }, version: updated.version });
      return this.view(updated);
    });
  }

  /** inventory.qc_posting.recorded.v1 -> CLOSED (a reopen after this point is refused). */
  async closeLot(tx: Tx, tenantId: string, lotId: string, postingIds: string[]): Promise<void> {
    const lot = await tx.qcLot.findUnique({ where: { id: lotId } });
    if (!lot || lot.tenantId !== tenantId || lot.status === 'CLOSED') return;
    await tx.qcLot.update({ where: { id: lotId }, data: { status: 'CLOSED', postingIds, closedAt: new Date(), version: { increment: 1 } } });
  }

  /**
   * GRN cancellation saga: all lots of the GRN must be untouched (no results, not decided); then every
   * lot is cancelled and one qc.lot.cancelled per lot lets inventory reverse the receipt line.
   */
  async handleCancellationRequest(tx: Tx, tenantId: string, grn: { grnId: string; grnNumber: string; reason: string }, correlationId: string): Promise<void> {
    const lots = await tx.qcLot.findMany({ where: { tenantId, sourceType: 'GRN', sourceId: grn.grnId }, include: { results: true } });
    const busy = lots.find((l) => l.status === 'DECIDED' || l.status === 'CLOSED' || l.results.length > 0);
    if (busy) {
      await enqueueEvent(tx, PRODUCER, { eventType: EVENT_TYPES.QC_LOT_CANCELLATION_REFUSED, tenantId, aggregate: { type: 'qc_lot', id: busy.id, version: busy.version }, actor: { type: 'system', id: null, name: 'system' }, correlationId, payload: { grnId: grn.grnId, lotId: busy.id, reason: `Lot ${busy.number} already has inspection results (${busy.status})` } });
      return;
    }
    for (const lot of lots) {
      if (lot.status === 'CANCELLED') continue;
      const updated = await tx.qcLot.update({ where: { id: lot.id }, data: { status: 'CANCELLED', statusReason: `GRN ${grn.grnNumber} cancelled: ${grn.reason}`, version: { increment: 1 } } });
      await this.audit(tx, tenantId, { ...SYSTEM, correlationId }, { action: 'QC_LOT_CANCELLED', entityType: 'QC_LOT', entityId: lot.id, summary: lot.number, newValue: { reason: grn.reason }, version: updated.version });
      await enqueueEvent(tx, PRODUCER, { eventType: EVENT_TYPES.QC_LOT_CANCELLED, tenantId, aggregate: { type: 'qc_lot', id: lot.id, version: updated.version }, actor: { type: 'system', id: null, name: 'system' }, correlationId, payload: { lotId: lot.id, grnId: grn.grnId, grnLineId: lot.sourceLineId, itemId: lot.itemId, warehouseId: lot.warehouseId, qty: Number(lot.qty), serials: lot.serials, lineCount: lots.length } });
    }
  }

  /* ---- reads ------------------------------------------------------------------------- */

  view(l: LotRow) {
    return {
      id: l.id, number: l.number, sourceType: l.sourceType, sourceId: l.sourceId, sourceLineId: l.sourceLineId, sourceNumber: l.sourceNumber, itemId: l.itemId, item: l.itemSnapshot, warehouseId: l.warehouseId, binId: l.binId,
      mode: l.mode, qty: Number(l.qty), passQty: Number(l.passQty), failQty: Number(l.failQty), serials: l.serials, checklistId: l.checklistId, checklistVersion: l.checklistVersion,
      status: l.status, statusReason: l.statusReason, inspectorId: l.inspectorId, startedAt: l.startedAt, decidedAt: l.decidedAt, decidedBy: l.decidedBy, postingIds: l.postingIds, closedAt: l.closedAt, createdAt: l.createdAt, updatedAt: l.updatedAt, version: l.version,
      isLaptop: Boolean(laptopSpecsOf(l)),
      expectedSpecs: laptopSpecsOf(l),
      results: (l.results ?? []).map((r) => ({ id: r.id, serialNo: r.serialNo, result: r.result, gradeCode: r.gradeCode, defectCodes: r.defectCodes, remarks: r.remarks, checklistAnswers: r.checklistAnswers, laptopCheck: r.laptopCheck ?? null, inspectedBy: r.inspectedBy, inspectedAt: r.inspectedAt })),
      progress: l.mode === 'SERIAL' ? { inspected: (l.results ?? []).length, total: l.serials.length, passed: (l.results ?? []).filter((r) => r.result === 'PASS').length, failed: (l.results ?? []).filter((r) => r.result === 'FAIL').length, onHold: (l.results ?? []).filter((r) => r.result === 'HOLD').length } : null,
    };
  }

  async list(ctx: TenantContext, q: { status?: string; warehouseId?: string; sourceType?: string; sourceId?: string; mine?: string; q?: string; limit: number }) {
    return this.tx(ctx.tenantId!, async (tx) => {
      const search = { contains: q.q ?? '', mode: 'insensitive' as const };
      const rows = await tx.qcLot.findMany({
        where: {
          status: q.status, sourceType: q.sourceType, sourceId: q.sourceId, warehouseId: q.warehouseId ?? (ctx.warehouseIds ? { in: ctx.warehouseIds } : undefined), inspectorId: q.mine === 'true' ? ctx.userId ?? undefined : undefined,
          ...(q.q ? { OR: [{ number: search }, { sourceNumber: search }] } : {}),
        },
        include: { results: true }, orderBy: { createdAt: 'desc' }, take: q.limit,
      });
      return rows.map((r) => this.view(r));
    });
  }

  async get(ctx: TenantContext, id: string) {
    return this.tx(ctx.tenantId!, async (tx) => {
      const lot = await this.loadLot(tx, ctx, id);
      const checklist = lot.checklistId ? await tx.qcChecklist.findUnique({ where: { id: lot.checklistId }, include: { items: { orderBy: { seq: 'asc' } } } }) : null;
      return { ...this.view(lot), checklist };
    });
  }

  /* ---- checklists & defect codes --------------------------------------------------------- */

  async listChecklists(tenantId: string) {
    return this.tx(tenantId, (tx) => tx.qcChecklist.findMany({ where: { tenantId }, include: { items: { orderBy: { seq: 'asc' } } }, orderBy: { name: 'asc' } }));
  }
  async createChecklist(tenantId: string, actor: Actor, input: ChecklistInput) {
    return this.tx(tenantId, async (tx) => {
      const id = uuidv7();
      const created = await tx.qcChecklist.create({ data: { id, tenantId, name: input.name, appliesTo: input.appliesTo as Prisma.InputJsonValue, items: { create: input.items.map((it, i) => ({ id: uuidv7(), tenantId, seq: i + 1, label: it.label, kind: it.kind, critical: it.critical, minValue: it.minValue, maxValue: it.maxValue })) } }, include: { items: { orderBy: { seq: 'asc' } } } });
      await this.audit(tx, tenantId, actor, { action: 'QC_CHECKLIST_CREATED', entityType: 'QC_CHECKLIST', entityId: id, summary: input.name, newValue: { items: input.items.length } });
      return created;
    });
  }
  async setChecklistStatus(tenantId: string, actor: Actor, id: string, status: 'ACTIVE' | 'INACTIVE') {
    return this.tx(tenantId, async (tx) => {
      const existing = await tx.qcChecklist.findUnique({ where: { id } });
      if (!existing) throw notFound('Checklist not found');
      const updated = await tx.qcChecklist.update({ where: { id }, data: { status }, include: { items: true } });
      await this.audit(tx, tenantId, actor, { action: `QC_CHECKLIST_${status}`, entityType: 'QC_CHECKLIST', entityId: id, oldValue: { status: existing.status }, newValue: { status } });
      return updated;
    });
  }
  async listDefectCodes(tenantId: string) {
    return this.tx(tenantId, (tx) => tx.qcDefectCode.findMany({ where: { tenantId }, orderBy: { code: 'asc' } }));
  }
  async upsertDefectCode(tenantId: string, actor: Actor, input: { code: string; description: string }) {
    return this.tx(tenantId, async (tx) => {
      const row = await tx.qcDefectCode.upsert({ where: { tenantId_code: { tenantId, code: input.code } }, update: { description: input.description, status: 'ACTIVE' }, create: { tenantId, code: input.code, description: input.description } });
      await this.audit(tx, tenantId, actor, { action: 'QC_DEFECT_CODE_UPSERTED', entityType: 'QC_DEFECT_CODE', entityId: tenantId, summary: input.code, newValue: input });
      return row;
    });
  }
  async setDefectCodeStatus(tenantId: string, actor: Actor, code: string, status: 'ACTIVE' | 'INACTIVE') {
    return this.tx(tenantId, async (tx) => {
      const existing = await tx.qcDefectCode.findUnique({ where: { tenantId_code: { tenantId, code } } });
      if (!existing) throw notFound('Defect code not found');
      const row = await tx.qcDefectCode.update({ where: { tenantId_code: { tenantId, code } }, data: { status } });
      await this.audit(tx, tenantId, actor, { action: `QC_DEFECT_CODE_${status}`, entityType: 'QC_DEFECT_CODE', entityId: tenantId, summary: code });
      return row;
    });
  }

  requireScope(ctx: TenantContext, warehouseId: string) {
    if (!inWarehouseScope(ctx, warehouseId)) throw forbidden('This warehouse is outside your scope', 'WAREHOUSE_SCOPE');
  }
}

/* ---- laptop QC ---------------------------------------------------------------------------- */

/** The eight specs the lot was ordered with (from the item snapshot); null for non-laptop items. */
function laptopSpecsOf(lot: { itemSnapshot: unknown }): LaptopSpecs | null {
  const specs = (lot.itemSnapshot as { specs?: LaptopSpecs | null } | null)?.specs;
  return specs && typeof specs === 'object' ? specs : null;
}

/**
 * A laptop may PASS only when all eight specs match the ordered configuration, it powers on and no
 * part is missing. FAIL records why (spec mismatch, no power, missing parts are added as defect codes
 * automatically). HOLD needs a remark and keeps the unit in QC hold until it is resolved.
 */
function checkLaptop(r: ResultsInput['results'][number], i: number, label: string): { result: 'PASS' | 'FAIL' | 'HOLD'; defects: string[] } {
  if (!r.laptop) throw businessRuleError('QC_LAPTOP_CHECK_REQUIRED', `Verify the laptop specifications for ${label}`, [{ path: `results.${i}.laptop`, message: 'Laptop check is required' }]);
  const problems: { path: string; message: string }[] = [];
  const mismatched = LAPTOP_SPEC_FIELDS.filter((f) => !r.laptop!.specChecks[f.key].match);
  for (const f of mismatched) {
    if (!r.laptop.specChecks[f.key].actual) problems.push({ path: `results.${i}.laptop.specChecks.${f.key}.actual`, message: `Enter the ${f.label.toLowerCase()} found on the laptop` });
  }
  const defects: string[] = [];
  if (mismatched.length) defects.push('SPEC_MISMATCH');
  if (!r.laptop.powersOn) defects.push('NO_POWER');
  if (r.laptop.missingParts.length) defects.push('MISSING_PARTS');
  if (r.result === 'PASS' && defects.length) {
    const why = [mismatched.length ? `${mismatched.map((f) => f.label).join(', ')} do not match` : null, !r.laptop.powersOn ? 'it does not power on' : null, r.laptop.missingParts.length ? `parts are missing (${r.laptop.missingParts.join(', ')})` : null].filter(Boolean).join('; ');
    problems.push({ path: `results.${i}.result`, message: `Cannot pass ${label}: ${why}` });
  }
  if (r.result === 'HOLD' && !r.remarks) problems.push({ path: `results.${i}.remarks`, message: 'Say why the laptop is on hold' });
  if (problems.length) throw businessRuleError('QC_LAPTOP_CHECK_FAILED', problems[0].message, problems);
  return { result: r.result, defects: r.result === 'FAIL' ? defects : [] };
}
