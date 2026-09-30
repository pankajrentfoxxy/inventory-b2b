/**
 * Consumers (phase-04 4.7, phase-05 5.4):
 * - master.product.* / master.warehouse.* / master.bin.* keep local references current
 * - procurement.grn.received -> RECEIPT posting (EXT_SUPPLIER -> QC_HOLD) -> receipt.posted | receipt.rejected
 * - qc.lot.decided -> QC_PASS / QC_FAIL postings -> qc_posting.recorded
 * - qc.lot.cancelled -> RECEIPT_REVERSAL (QC_HOLD -> EXT_SUPPLIER) -> receipt.reversed | reversal_refused
 * Business failures inside a posting roll back to a savepoint and become an event, so the inbox claim
 * still commits and the event is not retried forever; infrastructure failures still throw (retry/DLQ).
 */
import { EVENT_TYPES, binSnapshot, grnReceivedPayload, productSnapshot, qcLotCancelledPayload, qcLotDecidedPayload, rk, warehouseSnapshot, type GrnReceivedPayload, type QcLotDecidedPayload } from '@b2b/contracts';
import { HttpError, enqueueEvent, registerConsumer, type ConsumerRuntime, type ErrorDetail } from '@b2b/platform-kit';
import type { Tx } from '../db.js';
import type { InventoryService } from './inventory.service.js';
import { PRODUCER, loadItems, postInTx, type PostingLineInput, type PostingSerialInput, type PostingResult } from './posting.engine.js';

const system = (correlationId: string) => ({ type: 'system' as const, id: null, name: 'system', correlationId });

async function withSavepoint<T>(tx: Tx, name: string, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: HttpError }> {
  await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
  try {
    const value = await fn();
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
    return { ok: true, value };
  } catch (err) {
    if (err instanceof HttpError && err.status < 500) {
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
      return { ok: false, error: err };
    }
    throw err;
  }
}

export async function postReceipt(tx: Tx, tenantId: string, grn: GrnReceivedPayload, correlationId: string): Promise<void> {
  const items = await loadItems(tx, grn.lines.map((l) => l.itemId));
  const lines: PostingLineInput[] = [];
  const serials: PostingSerialInput[] = [];
  const lineIndex: { grnLineId: string; toLineNo: number }[] = [];
  for (const l of grn.lines) {
    const from = lines.push({ itemId: l.itemId, warehouseId: null, binId: null, partyId: grn.supplierId, bucket: 'EXT_SUPPLIER', qty: -l.qty, unitCost: null, gradeCode: null });
    const to = lines.push({ itemId: l.itemId, warehouseId: grn.warehouseId, binId: null, partyId: null, bucket: 'QC_HOLD', qty: l.qty, unitCost: l.unitCost, gradeCode: null });
    lineIndex.push({ grnLineId: l.grnLineId, toLineNo: to });
    for (const s of l.serials) serials.push({ itemId: l.itemId, serialNo: s.serialNo, imei: s.imei, fromLineNo: from, toLineNo: to, refs: { grnId: grn.grnId, poId: grn.poId } });
  }
  const attempt = await withSavepoint(tx, 'receipt', () =>
    postInTx(tx, tenantId, { postingType: 'RECEIPT', refType: 'GRN', refId: grn.grnId, refNumber: grn.grnNumber, idempotencyKey: `GRN:${grn.grnId}:RECEIPT`, requestedByService: 'svc-procurement', actorId: null, actorName: 'svc-procurement', correlationId, lines, serials }, items),
  );
  if (!attempt.ok) {
    const duplicates = ((attempt.error.details ?? []) as (ErrorDetail & { duplicates?: string[] })[]).flatMap((d) => d.duplicates ?? []);
    await enqueueEvent(tx, PRODUCER, { eventType: EVENT_TYPES.INVENTORY_RECEIPT_REJECTED, tenantId, aggregate: { type: 'grn', id: grn.grnId, version: null }, actor: system(correlationId), correlationId, payload: { grnId: grn.grnId, reason: attempt.error.message, code: attempt.error.code, duplicates } });
    return;
  }
  const result: PostingResult = attempt.value;
  await enqueueEvent(tx, PRODUCER, {
    eventType: EVENT_TYPES.INVENTORY_RECEIPT_POSTED,
    tenantId,
    aggregate: { type: 'grn', id: grn.grnId, version: null },
    actor: system(correlationId),
    correlationId,
    payload: {
      grnId: grn.grnId, grnNumber: grn.grnNumber, poId: grn.poId, postingId: result.postingId, warehouseId: grn.warehouseId,
      lines: grn.lines.map((l) => {
        const item = items.get(l.itemId);
        const wanted = new Set(l.serials.map((s) => s.serialNo.toUpperCase()));
        const units = result.serials.filter((s) => s.itemId === l.itemId && wanted.has(s.serialNo.toUpperCase()));
        return { grnLineId: l.grnLineId, itemId: l.itemId, qty: l.qty, unitCost: l.unitCost, binId: l.binId, qcRequired: item?.qcRequired ?? l.itemSnapshot.qcRequired, isSerialized: item?.isSerialized ?? l.itemSnapshot.isSerialized, serialUnitIds: units.map((u) => u.serialUnitId), serials: l.serials.map((s) => s.serialNo), itemSnapshot: { ...l.itemSnapshot, ...(item ? { sku: item.sku, name: item.name, isSerialized: item.isSerialized, qcRequired: item.qcRequired, unitCode: item.unitCode } : {}) } };
      }),
    },
  });
}

export async function postQcDecision(tx: Tx, tenantId: string, lot: QcLotDecidedPayload, correlationId: string): Promise<void> {
  const items = await loadItems(tx, [lot.itemId]);
  const postingIds: string[] = [];
  const decisions: { type: 'QC_PASS' | 'QC_FAIL'; qty: number; to: 'AVAILABLE' | 'REJECTED'; binId: string | null; result: 'PASS' | 'FAIL' }[] = [
    { type: 'QC_PASS', qty: lot.passQty, to: 'AVAILABLE', binId: lot.binId ?? null, result: 'PASS' },
    { type: 'QC_FAIL', qty: lot.failQty, to: 'REJECTED', binId: null, result: 'FAIL' },
  ];
  for (const d of decisions) {
    if (!(d.qty > 0)) continue;
    const lines: PostingLineInput[] = [
      { itemId: lot.itemId, warehouseId: lot.warehouseId, binId: null, partyId: null, bucket: 'QC_HOLD', qty: -d.qty, unitCost: null, gradeCode: null },
      { itemId: lot.itemId, warehouseId: lot.warehouseId, binId: d.binId, partyId: null, bucket: d.to, qty: d.qty, unitCost: null, gradeCode: null },
    ];
    const serials: PostingSerialInput[] = lot.serials.filter((s) => s.result === d.result).map((s) => ({ itemId: lot.itemId, serialNo: s.serialNo, gradeCode: s.gradeCode, fromLineNo: 1, toLineNo: 2, refs: { qcLotId: lot.lotId } }));
    const r = await postInTx(tx, tenantId, { postingType: d.type, refType: 'QC_LOT', refId: lot.lotId, refNumber: lot.lotNumber, idempotencyKey: `QC_LOT:${lot.lotId}:${d.result}`, requestedByService: 'svc-qc', actorId: lot.decidedBy, actorName: null, correlationId, lines, serials }, items);
    postingIds.push(r.postingId);
  }
  await enqueueEvent(tx, PRODUCER, { eventType: EVENT_TYPES.INVENTORY_QC_POSTING_RECORDED, tenantId, aggregate: { type: 'qc_lot', id: lot.lotId, version: null }, actor: system(correlationId), correlationId, payload: { lotId: lot.lotId, grnId: lot.sourceId, grnLineId: lot.sourceLineId, postingIds, passQty: lot.passQty, failQty: lot.failQty } });
}

export async function reverseReceiptLine(tx: Tx, tenantId: string, p: { lotId: string; grnId: string; grnLineId: string; itemId: string; warehouseId: string; qty: number; serials: string[] }, correlationId: string): Promise<void> {
  const items = await loadItems(tx, [p.itemId]);
  const receipt = await tx.stockPosting.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: `GRN:${p.grnId}:RECEIPT` } } });
  const lines: PostingLineInput[] = [
    { itemId: p.itemId, warehouseId: p.warehouseId, binId: null, partyId: null, bucket: 'QC_HOLD', qty: -p.qty, unitCost: null, gradeCode: null },
    { itemId: p.itemId, warehouseId: null, binId: null, partyId: null, bucket: 'EXT_SUPPLIER', qty: p.qty, unitCost: null, gradeCode: null },
  ];
  const attempt = await withSavepoint(tx, 'reversal', () =>
    postInTx(tx, tenantId, { postingType: 'RECEIPT_REVERSAL', refType: 'GRN', refId: p.grnId, idempotencyKey: `GRN:${p.grnId}:REVERSAL:${p.grnLineId}`, requestedByService: 'svc-procurement', actorId: null, correlationId, reversalOf: receipt?.id ?? null, lines, serials: p.serials.map((s) => ({ itemId: p.itemId, serialNo: s, fromLineNo: 1, toLineNo: 2 })) }, items),
  );
  if (!attempt.ok) {
    await enqueueEvent(tx, PRODUCER, { eventType: EVENT_TYPES.INVENTORY_RECEIPT_REVERSAL_REFUSED, tenantId, aggregate: { type: 'grn', id: p.grnId, version: null }, actor: system(correlationId), correlationId, payload: { grnId: p.grnId, lotId: p.lotId, reason: `${attempt.error.code}: ${attempt.error.message}` } });
    return;
  }
  await enqueueEvent(tx, PRODUCER, { eventType: EVENT_TYPES.INVENTORY_RECEIPT_REVERSED, tenantId, aggregate: { type: 'grn', id: p.grnId, version: null }, actor: system(correlationId), correlationId, payload: { grnId: p.grnId, grnLineId: p.grnLineId, postingId: attempt.value.postingId, lotId: p.lotId } });
}

export async function registerInventoryConsumers(runtime: ConsumerRuntime, service: InventoryService): Promise<void> {
  await registerConsumer(runtime, {
    name: 'inventory.master-refs',
    bindings: [
      rk(EVENT_TYPES.MASTER_PRODUCT_CREATED), rk(EVENT_TYPES.MASTER_PRODUCT_UPDATED), rk(EVENT_TYPES.MASTER_PRODUCT_STATUS_CHANGED),
      rk(EVENT_TYPES.MASTER_WAREHOUSE_CREATED), rk(EVENT_TYPES.MASTER_WAREHOUSE_UPDATED),
      rk(EVENT_TYPES.MASTER_BIN_CREATED), rk(EVENT_TYPES.MASTER_BIN_UPDATED),
    ],
    handle: async (envelope, tx) => {
      if (!envelope.tenantId) return;
      const t = tx as unknown as Tx;
      if (envelope.eventType.startsWith('master.product.')) {
        const p = productSnapshot.parse(envelope.payload);
        if (p.tenantId !== envelope.tenantId) return;
        await service.upsertItemRef(t, p);
      } else if (envelope.eventType.startsWith('master.warehouse.')) {
        const w = warehouseSnapshot.parse(envelope.payload);
        if (w.tenantId !== envelope.tenantId) return;
        await service.upsertWarehouseRef(t, w);
      } else if (envelope.eventType.startsWith('master.bin.')) {
        const b = binSnapshot.parse(envelope.payload);
        if (b.tenantId !== envelope.tenantId) return;
        await service.upsertBinRef(t, b);
      }
    },
  });
  await registerConsumer(runtime, {
    name: 'inventory.receipts',
    bindings: [rk(EVENT_TYPES.GRN_RECEIVED)],
    handle: async (envelope, tx) => {
      if (!envelope.tenantId) return;
      await postReceipt(tx as unknown as Tx, envelope.tenantId, grnReceivedPayload.parse(envelope.payload), envelope.correlationId);
    },
  });
  await registerConsumer(runtime, {
    name: 'inventory.qc-decisions',
    bindings: [rk(EVENT_TYPES.QC_LOT_DECIDED)],
    handle: async (envelope, tx) => {
      if (!envelope.tenantId) return;
      await postQcDecision(tx as unknown as Tx, envelope.tenantId, qcLotDecidedPayload.parse(envelope.payload), envelope.correlationId);
    },
  });
  await registerConsumer(runtime, {
    name: 'inventory.receipt-reversals',
    bindings: [rk(EVENT_TYPES.QC_LOT_CANCELLED)],
    handle: async (envelope, tx) => {
      if (!envelope.tenantId) return;
      await reverseReceiptLine(tx as unknown as Tx, envelope.tenantId, qcLotCancelledPayload.parse(envelope.payload), envelope.correlationId);
    },
  });
}
