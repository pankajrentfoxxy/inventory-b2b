/**
 * svc-procurement (phase-05 5.10) with fake master / party / inventory sources: PO totals via the
 * shared math, the full transition matrix, approval rules (four eyes, limit), revisions, GRN guards
 * (over-receipt sequential + concurrent, tolerance, duplicate key, serial checks, warehouse scope),
 * event-driven GRN statuses, the cancellation saga, tenant isolation.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EVENT_TYPES, rk } from '@b2b/contracts';
import { uuidv7, type EventEnvelope } from '@b2b/platform-kit';
import { tenantToken, type InMemoryBroker } from '@b2b/test-kit';
import { PO_COMMANDS, PO_TRANSITIONS, type PoCommand } from '../src/modules/procurement.service.js';
import type { ProcurementRuntime } from '../src/service.js';
import { FakeSources, api, bootRuntime, idem, product, supplier, warehouse } from './support.js';

let rt: ProcurementRuntime;
let broker: InMemoryBroker;
const sources = new FakeSources();
const tenantA = randomUUID();
const tenantB = randomUUID();
const execId = randomUUID();
const approverId = randomUUID();
const owner = tenantToken({ tenantId: tenantA, name: 'Owner' });
const executive = tenantToken({ tenantId: tenantA, userId: execId, name: 'Exec', perms: ['purchase.view', 'purchase.create', 'purchase.edit', 'grn.view', 'grn.create'] });
const approver = tenantToken({ tenantId: tenantA, userId: approverId, name: 'Approver', perms: ['purchase.view', 'purchase.approve', 'purchase.issue', 'purchase.cancel', 'grn.view', 'grn.cancel', 'grn.create'] });
const ownerB = tenantToken({ tenantId: tenantB });
const wh = warehouse(tenantA, { code: 'MAIN' });
const wh2 = warehouse(tenantA, { code: 'SECOND', stateCode: '29' });
const widget = product(tenantA, { sku: 'WIDGET' });
const phone = product(tenantA, { sku: 'PHONE', isSerialized: true, serialPattern: '^SN[0-9]{4}$' });
const archived = product(tenantA, { sku: 'OLD', status: 'ARCHIVED' });
const sup = supplier(tenantA);
const blocked = supplier(tenantA, { displayName: 'Blocked Co', status: 'BLOCKED', blockedReason: 'quality' });
const scoped = tenantToken({ tenantId: tenantA, perms: ['purchase.view', 'grn.view', 'grn.create'], warehouseIds: [wh2.id] });

const poBody = (over: Record<string, unknown> = {}) => ({ supplierId: sup.id, shipToWarehouseId: wh.id, orderDate: '2026-10-01', lines: [{ itemId: widget.id, orderedQty: 10, unitPrice: 100 }], ...over });
const envelope = (tenantId: string, eventType: string, payload: Record<string, unknown>): EventEnvelope => ({ eventId: uuidv7(), eventType, eventVersion: 1, occurredAt: new Date().toISOString(), tenantId, producer: 'svc-inventory', correlationId: 'c', causationId: null, actor: { type: 'system', id: null }, aggregate: { type: 'grn', id: randomUUID(), version: null }, payload });

async function issuedPo(lines = [{ itemId: widget.id, orderedQty: 10, unitPrice: 100 }]) {
  const created = await api(rt, executive).post('/api/v1/procurement/purchase-orders', poBody({ lines }));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.data.id as string;
  assert.equal((await api(rt, executive).post(`/api/v1/procurement/purchase-orders/${id}/submit`)).status, 200);
  assert.equal((await api(rt, approver).post(`/api/v1/procurement/purchase-orders/${id}/approve`)).status, 200);
  const issued = await api(rt, approver).post(`/api/v1/procurement/purchase-orders/${id}/issue`);
  assert.equal(issued.status, 200, JSON.stringify(issued.body));
  return issued.body.data as { id: string; number: string; lines: { id: string; itemId: string }[] };
}

before(async () => {
  for (const p of [widget, phone, archived]) sources.products.set(p.id, p);
  sources.warehouses.set(wh.id, wh);
  sources.warehouses.set(wh2.id, wh2);
  sources.suppliers.set(sup.id, sup);
  sources.suppliers.set(blocked.id, blocked);
  ({ rt, broker } = await bootRuntime(sources));
});
after(async () => {
  await rt.stop();
});

describe('purchase orders', () => {
  it('creates with snapshots and shared totals, edits drafts with If-Match, and walks approve -> issue', async () => {
    const created = await api(rt, executive).post('/api/v1/procurement/purchase-orders', poBody({ lines: [{ itemId: widget.id, orderedQty: 10, unitPrice: 100 }, { itemId: phone.id, orderedQty: 2, unitPrice: 8000 }] }));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const po = created.body.data;
    assert.match(po.number, /^PO\/\d{2}-\d{2}\/0001$/);
    assert.equal(po.status, 'DRAFT');
    assert.equal(po.subtotal, 17000);
    assert.equal(po.taxTotal, 3060);
    assert.equal(po.total, 20060);
    assert.equal(po.intraState, true);
    assert.deepEqual(po.taxBreakup.map((t: { label: string; amount: number }) => [t.label, t.amount]), [['CGST', 1530], ['SGST', 1530]]);
    assert.equal(po.supplier.displayName, 'Acme');
    assert.equal(po.lines[1].item.sku, 'PHONE');
    const events = await rt.prisma.outboxEvent.findMany({ where: { tenantId: tenantA, eventType: EVENT_TYPES.PO_CREATED } });
    assert.equal(events.length, 1);
    assert.equal((events[0].envelope as unknown as EventEnvelope<{ lines: unknown[]; shipToWarehouseId: string }>).payload.shipToWarehouseId, wh.id);

    assert.equal((await api(rt, executive).patch(`/api/v1/procurement/purchase-orders/${po.id}`, { notes: 'x' }, 5)).status, 409);
    const inter = await api(rt, executive).patch(`/api/v1/procurement/purchase-orders/${po.id}`, { shipToWarehouseId: wh2.id, discountType: 'AMOUNT', discountValue: 1000 }, 0);
    assert.equal(inter.status, 200, JSON.stringify(inter.body));
    assert.equal(inter.body.data.intraState, false, 'supplier in 27, warehouse in 29 -> IGST');
    assert.equal(inter.body.data.discountAmount, 1000);
    assert.equal(inter.body.data.taxBreakup[0].label, 'IGST');
    assert.equal(inter.body.data.total, 18880);

    const badSupplier = await api(rt, executive).post('/api/v1/procurement/purchase-orders', poBody({ supplierId: blocked.id }));
    assert.equal(badSupplier.status, 422);
    assert.equal(badSupplier.body.error.code, 'PO_SUPPLIER_BLOCKED');
    const badItem = await api(rt, executive).post('/api/v1/procurement/purchase-orders', poBody({ lines: [{ itemId: archived.id, orderedQty: 1, unitPrice: 1 }] }));
    assert.equal(badItem.body.error.code, 'PO_ITEM_INACTIVE');
    const unknownSupplier = await api(rt, executive).post('/api/v1/procurement/purchase-orders', poBody({ supplierId: randomUUID() }));
    assert.equal(unknownSupplier.status, 422);
    assert.equal(unknownSupplier.body.errors.supplierId, 'Select a valid supplier');
    assert.equal((await api(rt, approver).post('/api/v1/procurement/purchase-orders', poBody())).status, 403, 'approver lacks purchase.create');

    assert.equal((await api(rt, executive).post(`/api/v1/procurement/purchase-orders/${po.id}/submit`)).body.data.status, 'PENDING_APPROVAL');
    assert.equal((await api(rt, executive).patch(`/api/v1/procurement/purchase-orders/${po.id}`, { notes: 'late' })).status, 409, 'only drafts are editable');
    const self = await api(rt, tenantToken({ tenantId: tenantA, userId: execId, perms: ['purchase.approve'] })).post(`/api/v1/procurement/purchase-orders/${po.id}/approve`);
    assert.equal(self.status, 409);
    assert.equal(self.body.error.code, 'PO_SELF_APPROVAL');
    assert.equal((await api(rt, executive).post(`/api/v1/procurement/purchase-orders/${po.id}/approve`)).status, 403);
    const rejected = await api(rt, approver).post(`/api/v1/procurement/purchase-orders/${po.id}/reject`, { reason: 'price too high' });
    assert.equal(rejected.body.data.status, 'DRAFT');
    assert.equal(rejected.body.data.statusReason, 'price too high');
    assert.equal((await api(rt, approver).post(`/api/v1/procurement/purchase-orders/${po.id}/reject`, { reason: 'again' })).status, 409, 'reject needs PENDING_APPROVAL');
    await api(rt, executive).post(`/api/v1/procurement/purchase-orders/${po.id}/submit`);
    await api(rt, owner).put('/api/v1/procurement/settings', { approvalLimit: 10000 });
    const limited = await api(rt, approver).post(`/api/v1/procurement/purchase-orders/${po.id}/approve`);
    assert.equal(limited.status, 403);
    assert.equal(limited.body.error.code, 'PO_APPROVAL_LIMIT');
    assert.equal((await api(rt, owner).post(`/api/v1/procurement/purchase-orders/${po.id}/approve`, { comment: 'ok' })).body.data.status, 'APPROVED', 'admins are not limited');
    await api(rt, owner).put('/api/v1/procurement/settings', { approvalLimit: null });
    assert.equal((await api(rt, executive).post(`/api/v1/procurement/purchase-orders/${po.id}/issue`)).status, 403);
    const issued = await api(rt, approver).post(`/api/v1/procurement/purchase-orders/${po.id}/issue`);
    assert.equal(issued.body.data.status, 'ISSUED');
    const detail = await api(rt, executive).get(`/api/v1/procurement/purchase-orders/${po.id}`);
    assert.deepEqual(detail.body.data.approvals.map((a: { decision: string }) => a.decision), ['REJECTED', 'APPROVED']);
    assert.equal((await api(rt, ownerB).get(`/api/v1/procurement/purchase-orders/${po.id}`)).status, 404);
    assert.equal((await api(rt, ownerB).get('/api/v1/procurement/purchase-orders')).body.data.length, 0);
    const kinds = (await rt.prisma.outboxEvent.findMany({ where: { tenantId: tenantA, aggregateId: po.id, eventType: { startsWith: 'procurement.po.' } }, orderBy: { createdAt: 'asc' } })).map((e) => e.eventType);
    assert.deepEqual(kinds, [EVENT_TYPES.PO_CREATED, EVENT_TYPES.PO_SUBMITTED, EVENT_TYPES.PO_REJECTED, EVENT_TYPES.PO_SUBMITTED, EVENT_TYPES.PO_APPROVED, EVENT_TYPES.PO_ISSUED]);
  });

  it('rejects every command from a status outside the transition table', async () => {
    const draft = (await api(rt, executive).post('/api/v1/procurement/purchase-orders', poBody())).body.data;
    const bodies: Record<PoCommand, Record<string, unknown>> = { submit: {}, approve: {}, reject: { reason: 'not needed' }, issue: {}, revise: { reason: 'because', lines: [{ itemId: widget.id, orderedQty: 1, unitPrice: 1 }] }, cancel: {}, 'short-close': { reason: 'done' }, close: {} };
    for (const command of PO_COMMANDS) {
      if (PO_TRANSITIONS[command].includes('DRAFT')) continue;
      const res = await api(rt, owner).post(`/api/v1/procurement/purchase-orders/${draft.id}/${command}`, bodies[command]);
      assert.equal(res.status, 409, `${command} from DRAFT`);
      assert.equal(res.body.error.code, 'PO_INVALID_TRANSITION', command);
    }
    const cancelled = await api(rt, approver).post(`/api/v1/procurement/purchase-orders/${draft.id}/cancel`, { reason: 'not needed' });
    assert.equal(cancelled.body.data.status, 'CANCELLED');
    for (const command of PO_COMMANDS) {
      const res = await api(rt, owner).post(`/api/v1/procurement/purchase-orders/${draft.id}/${command}`, bodies[command]);
      assert.equal(res.status, 409, `${command} from CANCELLED`);
    }
  });

  it('revises issued orders under the received-line rules and re-approves', async () => {
    const po = await issuedPo([{ itemId: widget.id, orderedQty: 10, unitPrice: 100 }, { itemId: phone.id, orderedQty: 2, unitPrice: 8000 }]);
    const widgetLine = po.lines.find((l) => l.itemId === widget.id)!;
    const phoneLine = po.lines.find((l) => l.itemId === phone.id)!;
    const grn = await api(rt, approver).post('/api/v1/procurement/grns?receive=true', { poId: po.id, receivedDate: '2026-10-02', lines: [{ poLineId: widgetLine.id, qty: 4 }] }, idem());
    assert.equal(grn.status, 201, JSON.stringify(grn.body));
    const inFlight = await api(rt, executive).post(`/api/v1/procurement/purchase-orders/${po.id}/revise`, { reason: 'more', lines: [{ poLineId: widgetLine.id, itemId: widget.id, orderedQty: 12, unitPrice: 100 }] });
    assert.equal(inFlight.status, 409, 'receipt not yet posted to inventory');
    await broker.publish(rk(EVENT_TYPES.INVENTORY_RECEIPT_POSTED), envelope(tenantA, EVENT_TYPES.INVENTORY_RECEIPT_POSTED, { grnId: grn.body.data.id, postingId: randomUUID(), warehouseId: wh.id, lines: [] }));
    await broker.drain();
    const below = await api(rt, executive).post(`/api/v1/procurement/purchase-orders/${po.id}/revise`, { reason: 'less', lines: [{ poLineId: widgetLine.id, itemId: widget.id, orderedQty: 3, unitPrice: 100 }, { poLineId: phoneLine.id, itemId: phone.id, orderedQty: 2, unitPrice: 8000 }] });
    assert.equal(below.status, 422);
    assert.equal(below.body.error.code, 'PO_LINE_IMMUTABLE');
    const swap = await api(rt, executive).post(`/api/v1/procurement/purchase-orders/${po.id}/revise`, { reason: 'swap', lines: [{ poLineId: widgetLine.id, itemId: phone.id, orderedQty: 10, unitPrice: 100 }] });
    assert.equal(swap.body.error.code, 'PO_LINE_IMMUTABLE');
    const removeReceived = await api(rt, executive).post(`/api/v1/procurement/purchase-orders/${po.id}/revise`, { reason: 'drop', lines: [{ poLineId: phoneLine.id, itemId: phone.id, orderedQty: 2, unitPrice: 8000 }] });
    assert.equal(removeReceived.body.error.code, 'PO_LINE_IMMUTABLE');
    const ok = await api(rt, executive).post(`/api/v1/procurement/purchase-orders/${po.id}/revise`, { reason: 'more widgets, phones dropped', lines: [{ poLineId: widgetLine.id, itemId: widget.id, orderedQty: 12, unitPrice: 100 }] });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.data.status, 'PENDING_APPROVAL');
    assert.equal(ok.body.data.revision, 1);
    assert.equal(ok.body.data.lines.length, 1);
    assert.equal(ok.body.data.lines[0].receivedQty, 4);
    assert.equal(ok.body.data.total, 1416);
    const rev0 = await api(rt, executive).get(`/api/v1/procurement/purchase-orders/${po.id}/revisions/0`);
    assert.equal(rev0.body.data.snapshot.lines.length, 2);
    assert.equal((await api(rt, executive).post(`/api/v1/procurement/purchase-orders/${po.id}/revise`, { reason: 'x', lines: [] })).status, 422, 'zod: at least one line');
    await api(rt, approver).post(`/api/v1/procurement/purchase-orders/${po.id}/approve`);
    const reissued = await api(rt, approver).post(`/api/v1/procurement/purchase-orders/${po.id}/issue`);
    assert.equal(reissued.body.data.status, 'PARTIALLY_RECEIVED', 'received quantity survives the revision');
    const short = await api(rt, approver).post(`/api/v1/procurement/purchase-orders/${po.id}/short-close`, { reason: 'supplier cannot deliver' });
    assert.equal(short.body.data.status, 'CLOSED');
    assert.equal(short.body.data.lines[0].cancelledQty, 8);
  });
});

describe('goods receipts', () => {
  it('guards over-receipt (sequential, concurrent, tolerance), duplicate keys, serial rules and warehouse scope', async () => {
    const po = await issuedPo([{ itemId: widget.id, orderedQty: 10, unitPrice: 100 }, { itemId: phone.id, orderedQty: 3, unitPrice: 8000 }]);
    const widgetLine = po.lines.find((l) => l.itemId === widget.id)!;
    const phoneLine = po.lines.find((l) => l.itemId === phone.id)!;
    const receivable = await api(rt, approver).get(`/api/v1/procurement/purchase-orders/${po.id}/receivable-lines`);
    assert.equal(receivable.body.data.lines.length, 2);
    assert.equal((await api(rt, approver).post('/api/v1/procurement/grns', { poId: po.id, receivedDate: '2026-10-02', lines: [{ poLineId: widgetLine.id, qty: 1 }] })).body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
    const over = await api(rt, approver).post('/api/v1/procurement/grns?receive=true', { poId: po.id, receivedDate: '2026-10-02', lines: [{ poLineId: widgetLine.id, qty: 11 }] }, idem());
    assert.equal(over.status, 422);
    assert.equal(over.body.error.code, 'OVER_RECEIPT');
    assert.equal(over.body.error.details[0].remaining, 10);
    const wrongLine = await api(rt, approver).post('/api/v1/procurement/grns?receive=true', { poId: po.id, receivedDate: '2026-10-02', lines: [{ poLineId: randomUUID(), qty: 1 }] }, idem());
    assert.equal(wrongLine.status, 422);
    assert.equal((await api(rt, scoped).post('/api/v1/procurement/grns?receive=true', { poId: po.id, receivedDate: '2026-10-02', lines: [{ poLineId: widgetLine.id, qty: 1 }] }, idem())).body.error.code, 'GRN_WAREHOUSE_SCOPE');
    // 10 parallel receipts of 3 against 10 open -> at most 3 succeed, received never exceeds ordered
    const parallel = await Promise.all(Array.from({ length: 10 }, () => api(rt, approver).post('/api/v1/procurement/grns?receive=true', { poId: po.id, receivedDate: '2026-10-02', lines: [{ poLineId: widgetLine.id, qty: 3 }] }, idem())));
    const okCount = parallel.filter((r) => r.status === 201).length;
    assert.equal(okCount, 3, JSON.stringify(parallel.map((r) => [r.status, r.body?.error?.code])));
    assert.ok(parallel.filter((r) => r.status === 422).every((r) => r.body.error.code === 'OVER_RECEIPT'));
    let current = (await api(rt, approver).get(`/api/v1/procurement/purchase-orders/${po.id}`)).body.data;
    assert.equal(current.lines.find((l: { id: string }) => l.id === widgetLine.id).receivedQty, 9);
    assert.equal(current.status, 'PARTIALLY_RECEIVED');
    // duplicate Idempotency-Key -> same GRN, replayed
    const key = idem();
    const first = await api(rt, approver).post('/api/v1/procurement/grns?receive=true', { poId: po.id, receivedDate: '2026-10-02', lines: [{ poLineId: widgetLine.id, qty: 1 }] }, key);
    const second = await api(rt, approver).post('/api/v1/procurement/grns?receive=true', { poId: po.id, receivedDate: '2026-10-02', lines: [{ poLineId: widgetLine.id, qty: 1 }] }, key);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(second.status, 201);
    assert.equal(second.body.data.id, first.body.data.id);
    assert.equal(second.headers['idempotent-replayed'], 'true');
    current = (await api(rt, approver).get(`/api/v1/procurement/purchase-orders/${po.id}`)).body.data;
    assert.equal(current.lines.find((l: { id: string }) => l.id === widgetLine.id).receivedQty, 10);
    // tolerance: 10% of 3 = 0.3 more allowed on the phone line -> receiving 3.3 is not allowed for serialized (integer), test with widget on a new PO below
    const countMismatch = await api(rt, approver).post('/api/v1/procurement/grns?receive=true', { poId: po.id, receivedDate: '2026-10-02', lines: [{ poLineId: phoneLine.id, qty: 2, serials: [{ serialNo: 'SN0001' }] }] }, idem());
    assert.equal(countMismatch.body.error.code, 'SERIAL_COUNT_MISMATCH');
    const dupInRequest = await api(rt, approver).post('/api/v1/procurement/grns?receive=true', { poId: po.id, receivedDate: '2026-10-02', lines: [{ poLineId: phoneLine.id, qty: 2, serials: [{ serialNo: 'SN0001' }, { serialNo: 'sn0001' }] }] }, idem());
    assert.equal(dupInRequest.body.error.code, 'GRN_SERIAL_DUPLICATE_IN_REQUEST');
    const pattern = await api(rt, approver).post('/api/v1/procurement/grns?receive=true', { poId: po.id, receivedDate: '2026-10-02', lines: [{ poLineId: phoneLine.id, qty: 1, serials: [{ serialNo: 'BAD' }] }] }, idem());
    assert.equal(pattern.body.error.code, 'SERIAL_PATTERN_MISMATCH');
    sources.duplicates.add('SN0009');
    const dupInStock = await api(rt, approver).post('/api/v1/procurement/grns?receive=true', { poId: po.id, receivedDate: '2026-10-02', lines: [{ poLineId: phoneLine.id, qty: 2, serials: [{ serialNo: 'SN0009' }, { serialNo: 'SN0010' }] }] }, idem());
    assert.equal(dupInStock.status, 422);
    assert.equal(dupInStock.body.error.code, 'SERIAL_DUPLICATE');
    assert.deepEqual(dupInStock.body.error.details[0].duplicates, ['SN0009']);
    const serialOk = await api(rt, approver).post('/api/v1/procurement/grns?receive=true', { poId: po.id, receivedDate: '2026-10-02', lines: [{ poLineId: phoneLine.id, qty: 3, serials: [{ serialNo: 'SN0001' }, { serialNo: 'SN0002' }, { serialNo: 'SN0003' }] }] }, idem());
    assert.equal(serialOk.status, 201, JSON.stringify(serialOk.body));
    current = (await api(rt, approver).get(`/api/v1/procurement/purchase-orders/${po.id}`)).body.data;
    assert.equal(current.status, 'RECEIVED');
    assert.equal((await api(rt, approver).post('/api/v1/procurement/grns?receive=true', { poId: po.id, receivedDate: '2026-10-02', lines: [{ poLineId: widgetLine.id, qty: 1 }] }, idem())).body.error.code, 'PO_NOT_RECEIVABLE');
    const grnEvents = await rt.prisma.outboxEvent.findMany({ where: { tenantId: tenantA, eventType: EVENT_TYPES.GRN_RECEIVED } });
    const serialEvent = grnEvents.find((e) => e.aggregateId === serialOk.body.data.id)!.envelope as unknown as EventEnvelope<{ lines: { serials: { serialNo: string }[]; unitCost: number }[] }>;
    assert.deepEqual(serialEvent.payload.lines[0].serials.map((s) => s.serialNo), ['SN0001', 'SN0002', 'SN0003']);
    assert.equal(serialEvent.payload.lines[0].unitCost, 8000, 'unit cost defaults to the PO price');

    // tolerance setting on a fresh PO
    await api(rt, owner).put('/api/v1/procurement/settings', { overReceiptTolerancePct: 10 });
    const po2 = await issuedPo([{ itemId: widget.id, orderedQty: 10, unitPrice: 100 }]);
    const tol = await api(rt, approver).post('/api/v1/procurement/grns?receive=true', { poId: po2.id, receivedDate: '2026-10-02', lines: [{ poLineId: po2.lines[0].id, qty: 11 }] }, idem());
    assert.equal(tol.status, 201, JSON.stringify(tol.body));
    assert.equal((await api(rt, approver).post('/api/v1/procurement/grns?receive=true', { poId: po2.id, receivedDate: '2026-10-02', lines: [{ poLineId: po2.lines[0].id, qty: 0.5 }] }, idem())).body.error.code, 'PO_NOT_RECEIVABLE');
    await api(rt, owner).put('/api/v1/procurement/settings', { overReceiptTolerancePct: 0 });
    assert.equal((await api(rt, ownerB).get(`/api/v1/procurement/grns/${tol.body.data.id}`)).status, 404);
    assert.equal((await api(rt, scoped).get(`/api/v1/procurement/grns/${tol.body.data.id}`)).status, 404, 'outside the warehouse scope reads as not found');
  });

  it('follows inventory and QC events: QC_PENDING, POSTING_FAILED + retry, QC_COMPLETED, auto-close, cancellation saga', async () => {
    const po = await issuedPo([{ itemId: widget.id, orderedQty: 10, unitPrice: 100 }]);
    const line = po.lines[0];
    const grn = (await api(rt, approver).post('/api/v1/procurement/grns?receive=true', { poId: po.id, receivedDate: '2026-10-02', lines: [{ poLineId: line.id, qty: 10 }] }, idem())).body.data;
    assert.equal(grn.status, 'RECEIVED');
    assert.equal((await api(rt, approver).post(`/api/v1/procurement/grns/${grn.id}/cancel`, { reason: 'too early' })).body.error.code, 'GRN_NOT_CANCELLABLE');
    // wrong tenant on the envelope -> ignored
    await broker.publish(rk(EVENT_TYPES.INVENTORY_RECEIPT_REJECTED), envelope(tenantB, EVENT_TYPES.INVENTORY_RECEIPT_REJECTED, { grnId: grn.id, reason: 'x', code: 'SERIAL_DUPLICATE', duplicates: [] }));
    await broker.drain();
    assert.equal((await api(rt, approver).get(`/api/v1/procurement/grns/${grn.id}`)).body.data.status, 'RECEIVED');
    await broker.publish(rk(EVENT_TYPES.INVENTORY_RECEIPT_REJECTED), envelope(tenantA, EVENT_TYPES.INVENTORY_RECEIPT_REJECTED, { grnId: grn.id, reason: 'Serial X exists', code: 'SERIAL_DUPLICATE', duplicates: ['X'] }));
    await broker.drain();
    const failed = (await api(rt, approver).get(`/api/v1/procurement/grns/${grn.id}`)).body.data;
    assert.equal(failed.status, 'POSTING_FAILED');
    assert.match(failed.statusReason, /SERIAL_DUPLICATE/);
    const retried = await api(rt, approver).post(`/api/v1/procurement/grns/${grn.id}/retry-posting`, {});
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.data.status, 'RECEIVED');
    assert.equal((await rt.prisma.outboxEvent.count({ where: { tenantId: tenantA, eventType: EVENT_TYPES.GRN_RECEIVED, aggregateId: grn.id } })), 2, 're-emitted');
    await broker.publish(rk(EVENT_TYPES.INVENTORY_RECEIPT_POSTED), envelope(tenantA, EVENT_TYPES.INVENTORY_RECEIPT_POSTED, { grnId: grn.id, postingId: randomUUID(), warehouseId: wh.id, lines: [] }));
    await broker.drain();
    assert.equal((await api(rt, approver).get(`/api/v1/procurement/grns/${grn.id}`)).body.data.status, 'QC_PENDING');
    assert.equal((await api(rt, approver).post(`/api/v1/procurement/purchase-orders/${po.id}/cancel`, { reason: 'x' })).body.error.code, 'PO_INVALID_TRANSITION', 'a fully received order cannot be cancelled');
    assert.equal((await api(rt, executive).post(`/api/v1/procurement/purchase-orders/${po.id}/close`)).status, 409, 'QC not complete');
    const poWithDraft = await issuedPo();
    const draftGrn = (await api(rt, approver).post('/api/v1/procurement/grns', { poId: poWithDraft.id, receivedDate: '2026-10-02', lines: [{ poLineId: poWithDraft.lines[0].id, qty: 1 }] }, idem())).body.data;
    assert.equal(draftGrn.status, 'DRAFT');
    assert.equal((await api(rt, approver).post(`/api/v1/procurement/purchase-orders/${poWithDraft.id}/cancel`, { reason: 'x' })).body.error.code, 'PO_HAS_RECEIVES');
    assert.equal((await api(rt, approver).post(`/api/v1/procurement/grns/${draftGrn.id}/cancel`, { reason: 'never happened' })).body.data.status, 'CANCELLED');
    assert.equal((await api(rt, approver).post(`/api/v1/procurement/purchase-orders/${poWithDraft.id}/cancel`, { reason: 'x' })).body.data.status, 'CANCELLED');
    const lotId = randomUUID();
    await broker.publish(rk(EVENT_TYPES.INVENTORY_QC_POSTING_RECORDED), envelope(tenantA, EVENT_TYPES.INVENTORY_QC_POSTING_RECORDED, { lotId, grnId: grn.id, grnLineId: grn.lines[0].id, postingIds: [randomUUID()], passQty: 9, failQty: 1 }));
    await broker.drain();
    const done = (await api(rt, approver).get(`/api/v1/procurement/grns/${grn.id}`)).body.data;
    assert.equal(done.status, 'QC_COMPLETED');
    assert.deepEqual(done.qcProgress, { total: 1, done: 1, passQty: 9, failQty: 1 });
    assert.equal(done.lines[0].lotId, lotId);
    assert.equal((await api(rt, approver).get(`/api/v1/procurement/purchase-orders/${po.id}`)).body.data.status, 'CLOSED', 'auto-closed after QC');
    assert.equal((await api(rt, approver).post(`/api/v1/procurement/grns/${grn.id}/cancel`, { reason: 'late' })).body.error.code, 'GRN_NOT_CANCELLABLE');

    // saga: cancel a QC_PENDING receipt, refusal, then success
    const po2 = await issuedPo([{ itemId: widget.id, orderedQty: 10, unitPrice: 100 }]);
    const grn2 = (await api(rt, approver).post('/api/v1/procurement/grns?receive=true', { poId: po2.id, receivedDate: '2026-10-03', lines: [{ poLineId: po2.lines[0].id, qty: 4 }] }, idem())).body.data;
    await broker.publish(rk(EVENT_TYPES.INVENTORY_RECEIPT_POSTED), envelope(tenantA, EVENT_TYPES.INVENTORY_RECEIPT_POSTED, { grnId: grn2.id, postingId: randomUUID(), warehouseId: wh.id, lines: [] }));
    await broker.drain();
    assert.equal((await api(rt, executive).post(`/api/v1/procurement/grns/${grn2.id}/cancel`, { reason: 'x' })).status, 403, 'executive lacks grn.cancel');
    const pending = await api(rt, approver).post(`/api/v1/procurement/grns/${grn2.id}/cancel`, { reason: 'wrong goods' });
    assert.equal(pending.body.data.status, 'CANCELLATION_PENDING');
    assert.equal((await rt.prisma.outboxEvent.count({ where: { tenantId: tenantA, eventType: EVENT_TYPES.GRN_CANCELLATION_REQUESTED } })), 1);
    await broker.publish(rk(EVENT_TYPES.QC_LOT_CANCELLATION_REFUSED), { ...envelope(tenantA, EVENT_TYPES.QC_LOT_CANCELLATION_REFUSED, { grnId: grn2.id, lotId: randomUUID(), reason: 'inspection started' }), producer: 'svc-qc' });
    await broker.drain();
    const refused = (await api(rt, approver).get(`/api/v1/procurement/grns/${grn2.id}`)).body.data;
    assert.equal(refused.status, 'QC_PENDING');
    assert.match(refused.statusReason, /refused/);
    await api(rt, approver).post(`/api/v1/procurement/grns/${grn2.id}/cancel`, { reason: 'second try' });
    await broker.publish(rk(EVENT_TYPES.INVENTORY_RECEIPT_REVERSED), envelope(tenantA, EVENT_TYPES.INVENTORY_RECEIPT_REVERSED, { grnId: grn2.id, grnLineId: grn2.lines[0].id, postingId: randomUUID(), lotId: randomUUID() }));
    await broker.drain();
    const cancelled = (await api(rt, approver).get(`/api/v1/procurement/grns/${grn2.id}`)).body.data;
    assert.equal(cancelled.status, 'CANCELLED');
    const po2After = (await api(rt, approver).get(`/api/v1/procurement/purchase-orders/${po2.id}`)).body.data;
    assert.equal(po2After.status, 'ISSUED', 'quantities restored');
    assert.equal(po2After.lines[0].receivedQty, 0);
    assert.equal((await rt.prisma.outboxEvent.count({ where: { tenantId: tenantA, eventType: EVENT_TYPES.GRN_CANCELLED } })), 1);
    assert.equal((await api(rt, approver).post(`/api/v1/procurement/purchase-orders/${po2.id}/cancel`, { reason: 'now free' })).body.data.status, 'CANCELLED');

    const presign = await api(rt, executive).post('/api/v1/procurement/attachments:presign', { entityType: 'PO', entityId: po.id, fileName: 'quote.pdf', contentType: 'application/pdf', sizeBytes: 1024 });
    assert.equal(presign.status, 201, JSON.stringify(presign.body));
    assert.match(presign.body.data.uploadUrl, /^local:\/\/tenants\//);
    assert.equal((await api(rt, executive).get(`/api/v1/procurement/attachments?entityType=PO&entityId=${po.id}`)).body.data.length, 1);
  });
});
