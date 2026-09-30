/**
 * svc-inventory (phase-04 4.10): opening stock, engine rules (balance, transitions, allow-list,
 * idempotency, insufficient stock), the exhaustive transition table, adjustments with approval,
 * bin moves, serial search/history, tenant isolation (API + raw RLS), append-only ledger,
 * warehouse scope, internal APIs and a clean reconciliation at the end.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EVENT_TYPES } from '@b2b/contracts';
import type { EventEnvelope } from '@b2b/platform-kit';
import { serviceToken, tenantToken, type InMemoryBroker } from '@b2b/test-kit';
import { ALLOWED_TRANSITIONS, BUCKETS, isAllowedTransition, type Bucket } from '../src/modules/buckets.js';
import type { InventoryRuntime } from '../src/service.js';
import { UNBINNED, api, bootRuntime, idem, internal, product, seedRefs, warehouse } from './support.js';

let rt: InventoryRuntime;
let broker: InMemoryBroker;
const tenantA = randomUUID();
const tenantB = randomUUID();
const userOwner = randomUUID();
const userApprover = randomUUID();
const ownerA = tenantToken({ tenantId: tenantA, userId: userOwner, name: 'Owner A' });
const approverA = tenantToken({ tenantId: tenantA, userId: userApprover, name: 'Approver A', perms: ['inventory.view', 'inventory.adjust', 'inventory.adjust.approve'] });
const executiveA = tenantToken({ tenantId: tenantA, perms: ['inventory.view', 'inventory.adjust'] });
const viewerA = tenantToken({ tenantId: tenantA, perms: ['inventory.view'] });
const ownerB = tenantToken({ tenantId: tenantB, name: 'Owner B' });
const sales = serviceToken('svc-sales', 'svc-inventory');
const master = serviceToken('svc-master', 'svc-inventory');
const procurement = serviceToken('svc-procurement', 'svc-inventory');

const whA = warehouse(tenantA, { code: 'MAIN' });
const whA2 = warehouse(tenantA, { code: 'SECOND' });
const whB = warehouse(tenantB, { code: 'MAINB' });
const widget = product(tenantA, { sku: 'WIDGET' });
const phone = product(tenantA, { sku: 'PHONE', isSerialized: true, serialPattern: '^SN[0-9]{4}$' });
const service = product(tenantA, { sku: 'SVC', type: 'SERVICE', trackInventory: false });
const widgetB = product(tenantB, { sku: 'WIDGET-B' });
const bin1 = { id: randomUUID(), warehouseId: whA.id, code: 'A-01' };
const bin2 = { id: randomUUID(), warehouseId: whA.id, code: 'A-02' };
const binOther = { id: randomUUID(), warehouseId: whA2.id, code: 'B-01' };

const scopedToSecond = tenantToken({ tenantId: tenantA, perms: ['inventory.view', 'inventory.adjust', 'inventory.transfer'], warehouseIds: [whA2.id] });

before(async () => {
  ({ rt, broker } = await bootRuntime());
  await seedRefs(broker, tenantA, [widget, phone, service], [whA, whA2], [bin1, bin2, binOther]);
  await seedRefs(broker, tenantB, [widgetB], [whB]);
});
after(async () => {
  await rt.stop();
});

const balance = async (itemId: string, warehouseId: string, bucket: string, binId = UNBINNED) => {
  const rows = await rt.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
    return tx.$queryRaw<{ qty: number }[]>`SELECT qty::float8 AS qty FROM stock_balances WHERE item_id = ${itemId}::uuid AND warehouse_id = ${warehouseId}::uuid AND bucket = ${bucket} AND bin_id = ${binId}::uuid`;
  });
  return rows[0]?.qty ?? 0;
};

describe('opening stock', () => {
  it('posts opening stock once per item and warehouse, replays on the same key, and rejects bad input', async () => {
    const key = idem();
    const body = { warehouseId: whA.id, lines: [{ itemId: widget.id, qty: 100, unitCost: 12.5 }, { itemId: phone.id, qty: 3, unitCost: 8000, serials: [{ serialNo: 'SN0001' }, { serialNo: 'SN0002' }, { serialNo: 'SN0003' }] }] };
    const first = await api(rt, ownerA).post('/api/v1/inventory/opening-stock', body, key);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.data.serials, 3);
    const replay = await api(rt, ownerA).post('/api/v1/inventory/opening-stock', body, key);
    assert.equal(replay.status, 201);
    assert.equal(replay.headers['idempotent-replayed'], 'true');
    assert.equal(replay.body.data.postingId, first.body.data.postingId);
    assert.equal(await balance(widget.id, whA.id, 'AVAILABLE'), 100);
    assert.equal(await balance(phone.id, whA.id, 'AVAILABLE'), 3);

    const again = await api(rt, ownerA).post('/api/v1/inventory/opening-stock', { warehouseId: whA.id, lines: [{ itemId: widget.id, qty: 1, unitCost: 1 }] }, idem());
    assert.equal(again.status, 422);
    assert.equal(again.body.error.code, 'INV_OPENING_NOT_ALLOWED');
    const untracked = await api(rt, ownerA).post('/api/v1/inventory/opening-stock', { warehouseId: whA.id, lines: [{ itemId: service.id, qty: 1, unitCost: 1 }] }, idem());
    assert.equal(untracked.body.error.code, 'INV_ITEM_NOT_STOCKED');
    const noKey = await api(rt, ownerA).post('/api/v1/inventory/opening-stock', body);
    assert.equal(noKey.status, 400);
    assert.equal(noKey.body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
    const countMismatch = await api(rt, ownerA).post('/api/v1/inventory/opening-stock', { warehouseId: whA2.id, lines: [{ itemId: phone.id, qty: 2, unitCost: 1, serials: [{ serialNo: 'SN0010' }] }] }, idem());
    assert.equal(countMismatch.body.error.code, 'SERIAL_COUNT_MISMATCH');
    const pattern = await api(rt, ownerA).post('/api/v1/inventory/opening-stock', { warehouseId: whA2.id, lines: [{ itemId: phone.id, qty: 1, unitCost: 1, serials: [{ serialNo: 'BAD-1' }] }] }, idem());
    assert.equal(pattern.body.error.code, 'SERIAL_PATTERN_MISMATCH');
    const dupSerial = await api(rt, ownerA).post('/api/v1/inventory/opening-stock', { warehouseId: whA2.id, lines: [{ itemId: phone.id, qty: 1, unitCost: 1, serials: [{ serialNo: 'SN0001' }] }] }, idem());
    assert.equal(dupSerial.body.error.code, 'SERIAL_DUPLICATE');
    assert.deepEqual(dupSerial.body.error.details[0].duplicates, ['SN0001']);
    const fractional = await api(rt, ownerA).post('/api/v1/inventory/opening-stock', { warehouseId: whA2.id, lines: [{ itemId: phone.id, qty: 1.5, unitCost: 1, serials: [{ serialNo: 'SN0011' }] }] }, idem());
    assert.equal(fractional.body.error.code, 'INV_NON_INTEGER_SERIALIZED_QTY');
    assert.equal((await api(rt, viewerA).post('/api/v1/inventory/opening-stock', body, idem())).status, 403);

    const events = await rt.prisma.outboxEvent.findMany({ where: { tenantId: tenantA, eventType: EVENT_TYPES.INVENTORY_POSTING_RECORDED } });
    assert.equal(events.length, 1);
    const payload = (events[0].envelope as unknown as EventEnvelope<{ lines: { itemId: string; qty: number }[]; serials: unknown[] }>).payload;
    for (const item of [widget.id, phone.id]) assert.equal(payload.lines.filter((l) => l.itemId === item).reduce((s, l) => s + l.qty, 0), 0, 'every posting sums to zero');
    assert.equal(payload.serials.length, 3);
    const audits = await rt.prisma.outboxEvent.findMany({ where: { tenantId: tenantA, eventType: EVENT_TYPES.AUDIT_RECORDED } });
    assert.ok(audits.some((a) => JSON.stringify(a.envelope).includes('OPENING_STOCK_RECORDED')));

    const stock = await api(rt, ownerA).get('/api/v1/inventory/stock');
    assert.equal(stock.status, 200);
    const row = stock.body.data.find((r: { itemId: string }) => r.itemId === widget.id);
    assert.equal(row.available, 100);
    assert.equal(row.onHand, 100);
    assert.equal(row.avgCost, 12.5);
    const ledger = await api(rt, ownerA).get(`/api/v1/inventory/ledger?itemId=${widget.id}&warehouseId=${whA.id}`);
    assert.equal(ledger.body.data[0].runningOnHand, 100);
  });

  it('imports rows independently and reports per-row results', async () => {
    const res = await api(rt, ownerA).post('/api/v1/inventory/opening-stock/import', { rows: [{ warehouseId: whA2.id, itemId: widget.id, qty: 40, unitCost: 10 }, { warehouseId: whA2.id, itemId: service.id, qty: 1, unitCost: 1 }] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.posted, 1);
    assert.equal(res.body.data.failed, 1);
    assert.equal(res.body.data.results[1].error.code, 'INV_ITEM_NOT_STOCKED');
    assert.equal(await balance(widget.id, whA2.id, 'AVAILABLE'), 40);
  });
});

describe('posting engine', () => {
  const posting = (over: Record<string, unknown>) => ({ postingType: 'RESERVE', refType: 'SO', refId: randomUUID(), idempotencyKey: `SO:${randomUUID()}`, lines: [{ itemId: widget.id, warehouseId: whA.id, bucket: 'AVAILABLE', qty: -5 }, { itemId: widget.id, warehouseId: whA.id, bucket: 'RESERVED', qty: 5 }], ...over });

  it('applies the allow-list, transition guard, balance rule, no-negative-stock and key semantics', async () => {
    const ok = await internal(rt, sales, tenantA).post('/internal/v1/postings', posting({}));
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(await balance(widget.id, whA.id, 'RESERVED'), 5);
    assert.equal(await balance(widget.id, whA.id, 'AVAILABLE'), 95);

    const notAllowed = await internal(rt, sales, tenantA).post('/internal/v1/postings', posting({ postingType: 'QC_PASS', lines: [{ itemId: widget.id, warehouseId: whA.id, bucket: 'QC_HOLD', qty: -1 }, { itemId: widget.id, warehouseId: whA.id, bucket: 'AVAILABLE', qty: 1 }] }));
    assert.equal(notAllowed.status, 403);
    assert.equal(notAllowed.body.error.code, 'INV_POSTING_TYPE_NOT_ALLOWED');
    const illegal = await internal(rt, sales, tenantA).post('/internal/v1/postings', posting({ lines: [{ itemId: widget.id, warehouseId: whA.id, bucket: 'QC_HOLD', qty: -1 }, { itemId: widget.id, warehouseId: whA.id, bucket: 'RESERVED', qty: 1 }] }));
    assert.equal(illegal.status, 422);
    assert.equal(illegal.body.error.code, 'INV_ILLEGAL_BUCKET_TRANSITION');
    const unbalanced = await internal(rt, sales, tenantA).post('/internal/v1/postings', posting({ lines: [{ itemId: widget.id, warehouseId: whA.id, bucket: 'AVAILABLE', qty: -5 }, { itemId: widget.id, warehouseId: whA.id, bucket: 'RESERVED', qty: 4 }] }));
    assert.equal(unbalanced.body.error.code, 'INV_UNBALANCED_POSTING');
    const short = await internal(rt, sales, tenantA).post('/internal/v1/postings', posting({ lines: [{ itemId: widget.id, warehouseId: whA.id, bucket: 'AVAILABLE', qty: -500 }, { itemId: widget.id, warehouseId: whA.id, bucket: 'RESERVED', qty: 500 }] }));
    assert.equal(short.status, 422);
    assert.equal(short.body.error.code, 'INSUFFICIENT_STOCK');
    assert.equal(short.body.error.details[0].available, 95);
    assert.equal(short.body.error.details[0].requested, 500);
    assert.equal(await balance(widget.id, whA.id, 'AVAILABLE'), 95, 'failed postings leave no trace');
    const unknownWh = await internal(rt, sales, tenantA).post('/internal/v1/postings', posting({ lines: [{ itemId: widget.id, warehouseId: randomUUID(), bucket: 'AVAILABLE', qty: -1 }, { itemId: widget.id, warehouseId: whA.id, bucket: 'RESERVED', qty: 1 }] }));
    assert.equal(unknownWh.body.error.code, 'INV_WAREHOUSE_UNKNOWN');
    const crossTenantItem = await internal(rt, sales, tenantA).post('/internal/v1/postings', posting({ lines: [{ itemId: widgetB.id, warehouseId: whA.id, bucket: 'AVAILABLE', qty: -1 }, { itemId: widgetB.id, warehouseId: whA.id, bucket: 'RESERVED', qty: 1 }] }));
    assert.equal(crossTenantItem.body.error.code, 'INV_ITEM_NOT_STOCKED', 'another tenant item is invisible');

    const key = `SO:${randomUUID()}`;
    const refId = randomUUID();
    const a = await internal(rt, sales, tenantA).post('/internal/v1/postings', posting({ idempotencyKey: key, refId, lines: [{ itemId: widget.id, warehouseId: whA.id, bucket: 'AVAILABLE', qty: -2 }, { itemId: widget.id, warehouseId: whA.id, bucket: 'RESERVED', qty: 2 }] }));
    const b = await internal(rt, sales, tenantA).post('/internal/v1/postings', posting({ idempotencyKey: key, refId, lines: [{ itemId: widget.id, warehouseId: whA.id, bucket: 'AVAILABLE', qty: -2 }, { itemId: widget.id, warehouseId: whA.id, bucket: 'RESERVED', qty: 2 }] }));
    assert.equal(a.status, 201);
    assert.equal(b.status, 200);
    assert.equal(b.body.data.replayed, true);
    assert.equal(b.body.data.postingId, a.body.data.postingId);
    assert.equal(b.body.data.lines.length, 2);
    assert.equal(await balance(widget.id, whA.id, 'RESERVED'), 7, 'replay did not post twice');
    const conflictRes = await internal(rt, sales, tenantA).post('/internal/v1/postings', posting({ idempotencyKey: key, refId, lines: [{ itemId: widget.id, warehouseId: whA.id, bucket: 'AVAILABLE', qty: -3 }, { itemId: widget.id, warehouseId: whA.id, bucket: 'RESERVED', qty: 3 }] }));
    assert.equal(conflictRes.status, 422);
    assert.equal(conflictRes.body.error.code, 'INV_POSTING_KEY_CONFLICT');

    const serialReserve = await internal(rt, sales, tenantA).post('/internal/v1/postings', posting({ lines: [{ itemId: phone.id, warehouseId: whA.id, bucket: 'AVAILABLE', qty: -1 }, { itemId: phone.id, warehouseId: whA.id, bucket: 'RESERVED', qty: 1 }], serials: [{ itemId: phone.id, serialNo: 'SN0001', refs: { soId: randomUUID() } }] }));
    assert.equal(serialReserve.status, 201, JSON.stringify(serialReserve.body));
    const wrongState = await internal(rt, sales, tenantA).post('/internal/v1/postings', posting({ lines: [{ itemId: phone.id, warehouseId: whA.id, bucket: 'AVAILABLE', qty: -1 }, { itemId: phone.id, warehouseId: whA.id, bucket: 'RESERVED', qty: 1 }], serials: [{ itemId: phone.id, serialNo: 'SN0001' }] }));
    assert.equal(wrongState.status, 422);
    assert.equal(wrongState.body.error.code, 'SERIAL_NOT_IN_EXPECTED_STATE');
    const missingSerials = await internal(rt, sales, tenantA).post('/internal/v1/postings', posting({ lines: [{ itemId: phone.id, warehouseId: whA.id, bucket: 'AVAILABLE', qty: -1 }, { itemId: phone.id, warehouseId: whA.id, bucket: 'RESERVED', qty: 1 }] }));
    assert.equal(missingSerials.body.error.code, 'SERIAL_COUNT_MISMATCH');
    assert.equal((await internal(rt, sales, tenantB).post('/internal/v1/postings', posting({}))).body.error.code, 'INV_ITEM_NOT_STOCKED', 'tenant B cannot move tenant A stock');
    assert.equal((await api(rt, ownerA).post('/internal/v1/postings', posting({}))).status, 401, 'tenant tokens are not service tokens');
  });

  it('rejects every bucket pair outside the transition table', () => {
    const allowed = new Set<string>();
    for (const [from, tos] of Object.entries(ALLOWED_TRANSITIONS)) for (const to of tos) allowed.add(`${from}>${to}`);
    let checked = 0;
    for (const from of BUCKETS) {
      for (const to of BUCKETS) {
        checked += 1;
        assert.equal(isAllowedTransition(from as Bucket, to as Bucket), allowed.has(`${from}>${to}`), `${from} -> ${to}`);
      }
    }
    assert.equal(checked, BUCKETS.length * BUCKETS.length);
    assert.equal(isAllowedTransition('QC_HOLD', 'RESERVED'), false);
    assert.equal(isAllowedTransition('REJECTED', 'RESERVED'), false);
    assert.equal(isAllowedTransition('AVAILABLE', 'AVAILABLE', 'BIN_MOVE'), true);
    assert.equal(isAllowedTransition('IN_TRANSIT', 'IN_TRANSIT', 'BIN_MOVE'), false);
  });
});

describe('adjustments', () => {
  it('posts small adjustments immediately, routes large ones through approval, and enforces four eyes', async () => {
    const small = await api(rt, executiveA).post('/api/v1/inventory/adjustments', { warehouseId: whA.id, reasonCode: 'FOUND', lines: [{ itemId: widget.id, qtyDelta: 4, unitCost: 12.5 }] });
    assert.equal(small.status, 201, JSON.stringify(small.body));
    assert.match(small.body.data.number, /^ADJ\/\d{2}-\d{2}\/0001$/);
    assert.equal(small.body.data.status, 'DRAFT');
    const posted = await api(rt, executiveA).post(`/api/v1/inventory/adjustments/${small.body.data.id}/submit`);
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    assert.equal(posted.body.data.status, 'POSTED');
    assert.equal(posted.body.data.totalValue, 50);
    assert.equal(posted.body.data.postingIds.length, 1);
    assert.equal(await balance(widget.id, whA.id, 'AVAILABLE'), 97);
    assert.equal((await api(rt, executiveA).post(`/api/v1/inventory/adjustments/${small.body.data.id}/submit`)).status, 409);

    const big = await api(rt, executiveA).post('/api/v1/inventory/adjustments', { warehouseId: whA.id, reasonCode: 'DAMAGE', lines: [{ itemId: widget.id, qtyDelta: -10 }, { itemId: widget.id, qtyDelta: 2, bucket: 'REJECTED', unitCost: 30000 }] });
    assert.equal(big.status, 201, JSON.stringify(big.body));
    const pending = await api(rt, executiveA).post(`/api/v1/inventory/adjustments/${big.body.data.id}/submit`);
    assert.equal(pending.body.data.status, 'PENDING_APPROVAL', JSON.stringify(pending.body));
    assert.equal(pending.body.data.totalValue, 60125, '10 x avg cost 12.5 + 2 x 30000');
    assert.equal(await balance(widget.id, whA.id, 'AVAILABLE'), 97, 'nothing moves before approval');
    assert.equal((await api(rt, executiveA).post(`/api/v1/inventory/adjustments/${big.body.data.id}/approve`)).status, 403, 'executive lacks inventory.adjust.approve');
    const self = await api(rt, tenantToken({ tenantId: tenantA, userId: userOwner })).post(`/api/v1/inventory/adjustments/${big.body.data.id}/approve`);
    assert.equal(self.status, 200, 'owner did not raise it');
    assert.equal(self.body.data.status, 'POSTED');
    assert.equal(self.body.data.postingIds.length, 2, 'one IN and one OUT posting');
    assert.equal(await balance(widget.id, whA.id, 'AVAILABLE'), 87);
    assert.equal(await balance(widget.id, whA.id, 'REJECTED'), 2);
    const mine = await api(rt, approverA).post('/api/v1/inventory/adjustments', { warehouseId: whA.id, reasonCode: 'LOSS', lines: [{ itemId: widget.id, qtyDelta: -1, unitCost: 100000 }] });
    await api(rt, approverA).post(`/api/v1/inventory/adjustments/${mine.body.data.id}/submit`);
    const selfApprove = await api(rt, approverA).post(`/api/v1/inventory/adjustments/${mine.body.data.id}/approve`);
    assert.equal(selfApprove.status, 409);
    assert.equal(selfApprove.body.error.code, 'INV_ADJUSTMENT_SELF_APPROVAL');
    const cancelled = await api(rt, approverA).post(`/api/v1/inventory/adjustments/${mine.body.data.id}/cancel`, { reason: 'raised by mistake' });
    assert.equal(cancelled.body.data.status, 'CANCELLED');

    const tooMuch = await api(rt, executiveA).post('/api/v1/inventory/adjustments', { warehouseId: whA.id, reasonCode: 'LOSS', lines: [{ itemId: widget.id, qtyDelta: -1000, unitCost: 1 }] });
    const failed = await api(rt, executiveA).post(`/api/v1/inventory/adjustments/${tooMuch.body.data.id}/submit`);
    assert.equal(failed.status, 422);
    assert.equal(failed.body.error.code, 'INSUFFICIENT_STOCK');
    assert.equal((await api(rt, executiveA).get(`/api/v1/inventory/adjustments/${tooMuch.body.data.id}`)).body.data.status, 'DRAFT', 'a failed submit leaves the draft intact');

    const serialOut = await api(rt, executiveA).post('/api/v1/inventory/adjustments', { warehouseId: whA.id, reasonCode: 'LOSS', lines: [{ itemId: phone.id, qtyDelta: -1, serialNumbers: ['SN0001'] }] });
    const notThere = await api(rt, executiveA).post(`/api/v1/inventory/adjustments/${serialOut.body.data.id}/submit`);
    assert.equal(notThere.status, 422);
    assert.equal(notThere.body.error.code, 'SERIAL_NOT_IN_EXPECTED_STATE', 'SN0001 is RESERVED, not AVAILABLE');
    const serialOk = await api(rt, executiveA).post('/api/v1/inventory/adjustments', { warehouseId: whA.id, reasonCode: 'LOSS', lines: [{ itemId: phone.id, qtyDelta: -1, serialNumbers: ['SN0002'] }] });
    assert.equal((await api(rt, executiveA).post(`/api/v1/inventory/adjustments/${serialOk.body.data.id}/submit`)).body.data.status, 'POSTED');
    assert.equal(await balance(phone.id, whA.id, 'AVAILABLE'), 1);
    assert.equal((await api(rt, executiveA).post('/api/v1/inventory/adjustments', { warehouseId: whA.id, reasonCode: 'LOSS', lines: [{ itemId: phone.id, qtyDelta: -2, serialNumbers: ['SN0003'] }] })).body.error.code, 'SERIAL_COUNT_MISMATCH');
    assert.equal((await api(rt, executiveA).post('/api/v1/inventory/adjustments', { warehouseId: whA.id, reasonCode: 'LOSS', lines: [{ itemId: widget.id, qtyDelta: 0 }] })).status, 422);

    const list = await api(rt, viewerA).get('/api/v1/inventory/adjustments?status=POSTED');
    assert.ok(list.body.data.length >= 3);
    const audits = (await rt.prisma.outboxEvent.findMany({ where: { tenantId: tenantA, eventType: EVENT_TYPES.AUDIT_RECORDED } })).map((e) => JSON.stringify(e.envelope));
    assert.ok(audits.some((a) => a.includes('ADJUSTMENT_APPROVED') && a.includes(userOwner)), 'approval audited with the approver');
    const adjEvents = await rt.prisma.outboxEvent.findMany({ where: { tenantId: tenantA, eventType: EVENT_TYPES.INVENTORY_ADJUSTMENT_POSTED } });
    assert.equal(adjEvents.length, 3);
    const settings = await api(rt, approverA).put('/api/v1/inventory/settings', { adjustmentApprovalThreshold: 500 });
    assert.equal(settings.body.data.adjustmentApprovalThreshold, 500);
  });
});

describe('bin moves', () => {
  it('moves stock between bins inside one warehouse and refuses anything else', async () => {
    const move = await api(rt, ownerA).post('/api/v1/inventory/bin-moves', { warehouseId: whA.id, itemId: widget.id, qty: 30, toBinId: bin1.id }, idem());
    assert.equal(move.status, 201, JSON.stringify(move.body));
    assert.equal(await balance(widget.id, whA.id, 'AVAILABLE'), 57);
    assert.equal(await balance(widget.id, whA.id, 'AVAILABLE', bin1.id), 30);
    const onward = await api(rt, ownerA).post('/api/v1/inventory/bin-moves', { warehouseId: whA.id, itemId: widget.id, qty: 10, fromBinId: bin1.id, toBinId: bin2.id }, idem());
    assert.equal(onward.status, 201);
    const detail = await api(rt, ownerA).get(`/api/v1/inventory/stock/${widget.id}`);
    const bins = detail.body.data.byBin.filter((b: { warehouseId: string }) => b.warehouseId === whA.id && true);
    assert.deepEqual(bins.filter((b: { bucket: string }) => b.bucket === 'AVAILABLE').map((b: { binCode: string | null; qty: number }) => [b.binCode, b.qty]), [[null, 57], ['A-01', 20], ['A-02', 10]]);
    assert.equal(detail.body.data.byWarehouse.find((w: { warehouseId: string; bucket: string }) => w.warehouseId === whA.id && w.bucket === 'AVAILABLE').qty, 87);
    const same = await api(rt, ownerA).post('/api/v1/inventory/bin-moves', { warehouseId: whA.id, itemId: widget.id, qty: 1, fromBinId: bin1.id, toBinId: bin1.id }, idem());
    assert.equal(same.body.error.code, 'INV_BIN_MOVE_INVALID');
    const foreignBin = await api(rt, ownerA).post('/api/v1/inventory/bin-moves', { warehouseId: whA.id, itemId: widget.id, qty: 1, toBinId: binOther.id }, idem());
    assert.equal(foreignBin.body.error.code, 'INV_BIN_UNKNOWN');
    const short = await api(rt, ownerA).post('/api/v1/inventory/bin-moves', { warehouseId: whA.id, itemId: widget.id, qty: 100, fromBinId: bin2.id, toBinId: bin1.id }, idem());
    assert.equal(short.body.error.code, 'INSUFFICIENT_STOCK');
    assert.equal((await api(rt, executiveA).post('/api/v1/inventory/bin-moves', { warehouseId: whA.id, itemId: widget.id, qty: 1, toBinId: bin1.id }, idem())).status, 403);
    const serialMove = await api(rt, ownerA).post('/api/v1/inventory/bin-moves', { warehouseId: whA.id, itemId: phone.id, qty: 1, toBinId: bin1.id, serialNumbers: ['SN0003'] }, idem());
    assert.equal(serialMove.status, 201, JSON.stringify(serialMove.body));
    const unit = (await api(rt, ownerA).get('/api/v1/inventory/serials?q=SN0003')).body.data[0];
    assert.equal(unit.binId, bin1.id);
  });
});

describe('serials and isolation', () => {
  it('searches serials, shows their history, and hides everything from other tenants (API and raw RLS)', async () => {
    const found = await api(rt, ownerA).get('/api/v1/inventory/serials?q=sn0001');
    assert.equal(found.body.data.length, 1);
    assert.equal(found.body.data[0].bucket, 'RESERVED');
    const history = await api(rt, ownerA).get(`/api/v1/inventory/serials/${found.body.data[0].id}/history`);
    assert.deepEqual(history.body.data.map((h: { fromBucket: string | null; toBucket: string }) => [h.fromBucket, h.toBucket]), [[null, 'AVAILABLE'], ['AVAILABLE', 'RESERVED']]);
    assert.deepEqual(history.body.data.map((h: { postingType: string }) => h.postingType), ['OPENING', 'RESERVE']);
    assert.equal((await api(rt, ownerB).get(`/api/v1/inventory/serials/${found.body.data[0].id}`)).status, 404);
    assert.equal((await api(rt, ownerB).get('/api/v1/inventory/serials?q=SN0001')).body.data.length, 0);
    assert.equal((await api(rt, ownerB).get(`/api/v1/inventory/stock/${widget.id}`)).status, 404);
    assert.equal((await api(rt, ownerB).get('/api/v1/inventory/stock')).body.data.length, 0);
    const raw = await rt.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantB}, true), set_config('app.platform', 'false', true)`;
      const m = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM stock_movements`;
      const s = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM serial_units`;
      return [m[0].n, s[0].n];
    });
    assert.deepEqual(raw, [0, 0], 'RLS hides tenant A rows from a tenant B session');
  });

  it('keeps the ledger append-only for the runtime role', async () => {
    await assert.rejects(
      rt.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
        await tx.$executeRaw`UPDATE stock_movements SET qty = 1`;
      }),
      (err: Error) => /permission denied|42501/.test(err.message),
    );
    await assert.rejects(
      rt.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
        await tx.$executeRaw`DELETE FROM stock_postings`;
      }),
      (err: Error) => /permission denied|42501/.test(err.message),
    );
  });

  it('limits scoped users to their warehouses', async () => {
    const outside = await api(rt, scopedToSecond).post('/api/v1/inventory/opening-stock', { warehouseId: whA.id, lines: [{ itemId: widget.id, qty: 1, unitCost: 1 }] }, idem());
    assert.equal(outside.status, 403);
    assert.equal(outside.body.error.code, 'WAREHOUSE_SCOPE');
    const stock = await api(rt, scopedToSecond).get('/api/v1/inventory/stock');
    assert.ok(stock.body.data.every((r: { warehouseId: string }) => r.warehouseId === whA2.id));
    assert.equal((await api(rt, scopedToSecond).post('/api/v1/inventory/adjustments', { warehouseId: whA.id, reasonCode: 'OTHER', lines: [{ itemId: widget.id, qtyDelta: 1 }] })).status, 403);
  });
});

describe('internal APIs', () => {
  it('answers has-movements, serial checks and availability for services', async () => {
    const yes = await internal(rt, master, tenantA).get(`/internal/v1/items/${widget.id}/has-movements`);
    assert.equal(yes.body.data.hasMovements, true);
    const no = await internal(rt, master, tenantA).get(`/internal/v1/items/${service.id}/has-movements`);
    assert.equal(no.body.data.hasMovements, false);
    assert.equal((await internal(rt, master, tenantB).get(`/internal/v1/items/${widget.id}/has-movements`)).body.data.hasMovements, false);
    const check = await internal(rt, procurement, tenantA).post('/internal/v1/serials:check', { itemId: phone.id, serials: ['SN0001', 'SN0002', 'SN0999', 'bad', 'SN0999'] });
    assert.equal(check.status, 200, JSON.stringify(check.body));
    assert.deepEqual(check.body.data.duplicates, ['SN0001'], 'SN0002 was adjusted out (EXT_ADJUSTMENT) and may re-enter');
    assert.deepEqual(check.body.data.invalidPattern, ['bad']);
    assert.deepEqual(check.body.data.duplicatesInRequest, ['SN0999']);
    assert.equal(check.body.data.ok, false);
    const avail = await internal(rt, sales, tenantA).get(`/internal/v1/availability?itemIds=${widget.id},${phone.id}&warehouseId=${whA.id}`);
    assert.equal(avail.body.data[0].available, 87);
    assert.equal(avail.body.data[0].warehouses[0].reserved, 7);
    assert.equal(avail.body.data[1].available, 1);
    const report = await internal(rt, master, tenantA).get('/internal/v1/reconciliation/report');
    assert.equal(report.body.data.ok, true, JSON.stringify(report.body.data));
    const tenantReport = await api(rt, approverA).get('/api/v1/inventory/reconciliation');
    assert.equal(tenantReport.body.data.ledgerMismatches.length, 0);
    assert.equal(tenantReport.body.data.unbalancedPostings.length, 0);
    assert.equal(tenantReport.body.data.serialMismatches.length, 0);
  });
});
