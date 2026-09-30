/**
 * svc-qc (phase-05 5.10): lots from posted receipts (one per line, redelivery safe, auto-pass when the
 * item does not require QC), inspection guards (results for serials in the lot, defect codes on FAIL,
 * critical checklist FAIL forces FAIL), decide (incomplete -> 422, twice -> 409), reopen before /
 * after posting, cancellation saga answers, permissions and tenant isolation.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { EVENT_TYPES, rk } from '@b2b/contracts';
import { StaticKeyProvider, loadEnv, uuidv7, type EventEnvelope } from '@b2b/platform-kit';
import { InMemoryBroker, tenantToken, testKeys, truncateAll } from '@b2b/test-kit';
import { qcEnvSchema } from '../src/config.js';
import { createQcRuntime, type QcRuntime } from '../src/service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let rt: QcRuntime;
let broker: InMemoryBroker;
const tenantA = randomUUID();
const tenantB = randomUUID();
const inspectorId = randomUUID();
const owner = tenantToken({ tenantId: tenantA, name: 'Owner' });
const inspector = tenantToken({ tenantId: tenantA, userId: inspectorId, perms: ['qc.view', 'qc.inspect'] });
const approver = tenantToken({ tenantId: tenantA, perms: ['qc.view', 'qc.approve'] });
const ownerB = tenantToken({ tenantId: tenantB });
const warehouseId = randomUUID();
const widget = randomUUID();
const phone = randomUUID();
const noQc = randomUUID();

const api = (token: string) => ({
  get: (p: string) => request(rt.app).get(p).set('Authorization', `Bearer ${token}`),
  post: (p: string, body: unknown = {}) => request(rt.app).post(p).set('Authorization', `Bearer ${token}`).send(body as object),
  put: (p: string, body: unknown = {}) => request(rt.app).put(p).set('Authorization', `Bearer ${token}`).send(body as object),
});

const envelope = (tenantId: string, eventType: string, payload: Record<string, unknown>, producer = 'svc-inventory'): EventEnvelope => ({ eventId: uuidv7(), eventType, eventVersion: 1, occurredAt: new Date().toISOString(), tenantId, producer, correlationId: 'c', causationId: null, actor: { type: 'system', id: null }, aggregate: { type: 'grn', id: randomUUID(), version: null }, payload });
const item = (id: string, over: Record<string, unknown> = {}) => ({ id, sku: `SKU-${id.slice(0, 4)}`, name: 'Item', isSerialized: false, qcRequired: true, ...over });
const receipt = (grnId: string, lines: { grnLineId: string; itemId: string; qty: number; isSerialized?: boolean; qcRequired?: boolean; serials?: string[]; binId?: string | null }[]) =>
  envelope(tenantA, EVENT_TYPES.INVENTORY_RECEIPT_POSTED, { grnId, grnNumber: `GRN/${grnId.slice(0, 4)}`, postingId: randomUUID(), warehouseId, lines: lines.map((l) => ({ grnLineId: l.grnLineId, itemId: l.itemId, qty: l.qty, unitCost: 10, binId: l.binId ?? null, qcRequired: l.qcRequired ?? true, isSerialized: l.isSerialized ?? false, serialUnitIds: (l.serials ?? []).map(() => randomUUID()), serials: l.serials ?? [], itemSnapshot: item(l.itemId, { isSerialized: l.isSerialized ?? false, qcRequired: l.qcRequired ?? true }) })) });

before(async () => {
  const env = loadEnv(qcEnvSchema, { dir: path.resolve(here, '..') });
  await truncateAll(env.MIGRATE_DATABASE_URL!);
  broker = new InMemoryBroker();
  rt = await createQcRuntime(env, { broker, keys: new StaticKeyProvider(testKeys().publicKeyPem) });
  await rt.start();
});
after(async () => {
  await rt.stop();
});

const decided = async (tenantId = tenantA) => rt.prisma.outboxEvent.findMany({ where: { tenantId, eventType: EVENT_TYPES.QC_LOT_DECIDED }, orderBy: { createdAt: 'asc' } });

describe('lot creation', () => {
  it('creates one lot per receipt line, ignores redelivery, auto-passes items that skip QC', async () => {
    const grnId = randomUUID();
    const lineA = randomUUID();
    const lineB = randomUUID();
    const lineC = randomUUID();
    const ev = receipt(grnId, [
      { grnLineId: lineA, itemId: widget, qty: 100 },
      { grnLineId: lineB, itemId: phone, qty: 3, isSerialized: true, serials: ['SN1', 'SN2', 'SN3'], binId: randomUUID() },
      { grnLineId: lineC, itemId: noQc, qty: 5, qcRequired: false },
    ]);
    await broker.publish(rk(EVENT_TYPES.INVENTORY_RECEIPT_POSTED), ev);
    await broker.publish(rk(EVENT_TYPES.INVENTORY_RECEIPT_POSTED), ev); // redelivery (same eventId -> inbox)
    await broker.publish(rk(EVENT_TYPES.INVENTORY_RECEIPT_POSTED), { ...ev, eventId: uuidv7() }); // re-emitted (new id, same lines -> unique source line)
    await broker.drain();
    const lots = await api(owner).get(`/api/v1/qc/lots?sourceId=${grnId}`);
    assert.equal(lots.status, 200, JSON.stringify(lots.body));
    assert.equal(lots.body.data.length, 3);
    const auto = lots.body.data.find((l: { itemId: string }) => l.itemId === noQc);
    assert.equal(auto.status, 'DECIDED');
    assert.equal(auto.passQty, 5);
    assert.equal(auto.decidedBy, null, 'inspector = system');
    const events = await decided();
    assert.equal(events.length, 1);
    assert.equal((events[0].envelope as unknown as EventEnvelope<{ passQty: number }>).payload.passQty, 5);
    assert.match(lots.body.data[0].number, /^QC\/\d{2}-\d{2}\/\d{4}$/);
    assert.equal((await api(ownerB).get(`/api/v1/qc/lots?sourceId=${grnId}`)).body.data.length, 0);
    assert.equal((await api(ownerB).get(`/api/v1/qc/lots/${auto.id}`)).status, 404);
  });
});

describe('inspection and decisions', () => {
  let widgetLot: string;
  let phoneLot: string;
  before(async () => {
    const lots = (await api(owner).get('/api/v1/qc/lots?status=OPEN')).body.data as { id: string; itemId: string }[];
    widgetLot = lots.find((l) => l.itemId === widget)!.id;
    phoneLot = lots.find((l) => l.itemId === phone)!.id;
    assert.equal((await api(owner).post('/api/v1/qc/defect-codes', { code: 'scratch', description: 'Surface scratch' })).status, 201);
    assert.equal((await api(owner).post('/api/v1/qc/defect-codes', { code: 'DEAD', description: 'Does not power on' })).status, 201);
  });

  it('quantity mode: pass + fail must equal qty, fail needs a defect code, decide once', async () => {
    assert.equal((await api(inspector).post(`/api/v1/qc/lots/${widgetLot}/start`)).body.data.status, 'IN_INSPECTION');
    assert.equal((await api(inspector).post(`/api/v1/qc/lots/${widgetLot}/decide`, { passQty: 96, failQty: 4, defectCodes: ['SCRATCH'] })).status, 403, 'inspectors do not decide');
    const wrongSum = await api(approver).post(`/api/v1/qc/lots/${widgetLot}/decide`, { passQty: 90, failQty: 4, defectCodes: ['SCRATCH'] });
    assert.equal(wrongSum.status, 422);
    assert.equal(wrongSum.body.error.code, 'QC_RESULTS_INCOMPLETE');
    const noDefect = await api(approver).post(`/api/v1/qc/lots/${widgetLot}/decide`, { passQty: 96, failQty: 4 });
    assert.equal(noDefect.body.error.code, 'QC_DEFECT_REQUIRED');
    const ok = await api(approver).post(`/api/v1/qc/lots/${widgetLot}/decide`, { passQty: 96, failQty: 4, defectCodes: ['SCRATCH'] });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.data.status, 'DECIDED');
    const twice = await api(approver).post(`/api/v1/qc/lots/${widgetLot}/decide`, { passQty: 96, failQty: 4, defectCodes: ['SCRATCH'] });
    assert.equal(twice.status, 409);
    assert.equal(twice.body.error.code, 'QC_INVALID_TRANSITION');
    const events = await decided();
    assert.equal(events.length, 2);
    const payload = (events[1].envelope as unknown as EventEnvelope<{ passQty: number; failQty: number; mode: string }>).payload;
    assert.deepEqual([payload.passQty, payload.failQty, payload.mode], [96, 4, 'QUANTITY']);
    // reopen before posting is allowed; once inventory posted, refused
    assert.equal((await api(approver).post(`/api/v1/qc/lots/${widgetLot}/reopen`, { reason: 'recount' })).body.data.status, 'IN_INSPECTION');
    assert.equal((await api(approver).post(`/api/v1/qc/lots/${widgetLot}/decide`, { passQty: 96, failQty: 4, defectCodes: ['SCRATCH'] })).status, 200);
    await broker.publish(rk(EVENT_TYPES.INVENTORY_QC_POSTING_RECORDED), envelope(tenantA, EVENT_TYPES.INVENTORY_QC_POSTING_RECORDED, { lotId: widgetLot, grnId: randomUUID(), grnLineId: randomUUID(), postingIds: [randomUUID()], passQty: 96, failQty: 4 }));
    await broker.drain();
    const closed = await api(owner).get(`/api/v1/qc/lots/${widgetLot}`);
    assert.equal(closed.body.data.status, 'CLOSED');
    const late = await api(approver).post(`/api/v1/qc/lots/${widgetLot}/reopen`, { reason: 'too late' });
    assert.equal(late.status, 409);
    assert.equal(late.body.error.code, 'QC_ALREADY_POSTED');
  });

  it('serial mode: every serial needs a result, unknown serials rejected, critical checklist failure forces FAIL', async () => {
    const checklist = await api(owner).post('/api/v1/qc/checklists', { name: 'Phones', appliesTo: { itemIds: [phone] }, items: [{ label: 'Powers on', kind: 'PASS_FAIL', critical: true }, { label: 'Cosmetic', kind: 'PASS_FAIL' }] });
    assert.equal(checklist.status, 201, JSON.stringify(checklist.body));
    const powersOn = checklist.body.data.items[0].id as string;
    const unknown = await api(inspector).put(`/api/v1/qc/lots/${phoneLot}/results`, { results: [{ serialNo: 'NOPE', result: 'PASS' }] });
    assert.equal(unknown.status, 422);
    assert.equal(unknown.body.error.code, 'QC_RESULTS_INCOMPLETE');
    const failNoDefect = await api(inspector).put(`/api/v1/qc/lots/${phoneLot}/results`, { results: [{ serialNo: 'SN1', result: 'FAIL' }] });
    assert.equal(failNoDefect.body.error.code, 'QC_DEFECT_REQUIRED');
    const partial = await api(inspector).put(`/api/v1/qc/lots/${phoneLot}/results`, { results: [{ serialNo: 'sn1', result: 'PASS', gradeCode: 'A' }, { serialNo: 'SN2', result: 'FAIL', defectCodes: ['DEAD'] }] });
    assert.equal(partial.status, 200, JSON.stringify(partial.body));
    assert.equal(partial.body.data.status, 'IN_INSPECTION');
    assert.deepEqual(partial.body.data.progress, { inspected: 2, total: 3 });
    const incomplete = await api(approver).post(`/api/v1/qc/lots/${phoneLot}/decide`, {});
    assert.equal(incomplete.status, 422);
    assert.equal(incomplete.body.error.code, 'QC_RESULTS_INCOMPLETE');
    // the lot was created before the checklist existed, so attach the checklist behaviour by decision-time results: a critical FAIL answer forces FAIL
    await rt.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
      await tx.qcLot.update({ where: { id: phoneLot }, data: { checklistId: checklist.body.data.id, checklistVersion: 1 } });
    });
    const forced = await api(inspector).put(`/api/v1/qc/lots/${phoneLot}/results`, { results: [{ serialNo: 'SN3', result: 'PASS', defectCodes: ['DEAD'], checklistAnswers: { [powersOn]: 'FAIL' } }] });
    assert.equal(forced.status, 200, JSON.stringify(forced.body));
    assert.equal(forced.body.data.results.find((r: { serialNo: string }) => r.serialNo === 'SN3').result, 'FAIL');
    const decidedRes = await api(approver).post(`/api/v1/qc/lots/${phoneLot}/decide`, {});
    assert.equal(decidedRes.status, 200, JSON.stringify(decidedRes.body));
    assert.equal(decidedRes.body.data.passQty, 1);
    assert.equal(decidedRes.body.data.failQty, 2);
    const payload = (await decided()).at(-1)!.envelope as unknown as EventEnvelope<{ serials: { serialNo: string; result: string; gradeCode: string | null }[] }>;
    assert.deepEqual(payload.payload.serials.map((s) => [s.serialNo, s.result, s.gradeCode]), [['SN1', 'PASS', 'A'], ['SN2', 'FAIL', null], ['SN3', 'FAIL', null]]);
  });
});

describe('cancellation saga', () => {
  it('cancels untouched lots and refuses once any lot has results', async () => {
    const grnClean = randomUUID();
    const lineClean = randomUUID();
    await broker.publish(rk(EVENT_TYPES.INVENTORY_RECEIPT_POSTED), receipt(grnClean, [{ grnLineId: lineClean, itemId: widget, qty: 10 }]));
    await broker.drain();
    await broker.publish(rk(EVENT_TYPES.GRN_CANCELLATION_REQUESTED), envelope(tenantA, EVENT_TYPES.GRN_CANCELLATION_REQUESTED, { grnId: grnClean, grnNumber: 'GRN/X', reason: 'wrong supplier', lineIds: [lineClean] }, 'svc-procurement'));
    await broker.drain();
    const lot = (await api(owner).get(`/api/v1/qc/lots?sourceId=${grnClean}`)).body.data[0];
    assert.equal(lot.status, 'CANCELLED');
    const cancelled = await rt.prisma.outboxEvent.findMany({ where: { tenantId: tenantA, eventType: EVENT_TYPES.QC_LOT_CANCELLED } });
    assert.equal(cancelled.length, 1);
    assert.equal((cancelled[0].envelope as unknown as EventEnvelope<{ grnLineId: string; qty: number }>).payload.grnLineId, lineClean);
    assert.equal((await api(inspector).post(`/api/v1/qc/lots/${lot.id}/start`)).body.error.code, 'QC_LOT_CANCELLED');

    const grnBusy = randomUUID();
    const lineBusy = randomUUID();
    await broker.publish(rk(EVENT_TYPES.INVENTORY_RECEIPT_POSTED), receipt(grnBusy, [{ grnLineId: lineBusy, itemId: phone, qty: 1, isSerialized: true, serials: ['BUSY1'] }]));
    await broker.drain();
    const busyLot = (await api(owner).get(`/api/v1/qc/lots?sourceId=${grnBusy}`)).body.data[0];
    assert.equal((await api(inspector).put(`/api/v1/qc/lots/${busyLot.id}/results`, { results: [{ serialNo: 'BUSY1', result: 'PASS' }] })).status, 200);
    await broker.publish(rk(EVENT_TYPES.GRN_CANCELLATION_REQUESTED), envelope(tenantA, EVENT_TYPES.GRN_CANCELLATION_REQUESTED, { grnId: grnBusy, grnNumber: 'GRN/Y', reason: 'oops', lineIds: [lineBusy] }, 'svc-procurement'));
    await broker.drain();
    assert.equal((await api(owner).get(`/api/v1/qc/lots/${busyLot.id}`)).body.data.status, 'IN_INSPECTION', 'lot untouched by the refused cancellation');
    const refused = await rt.prisma.outboxEvent.findMany({ where: { tenantId: tenantA, eventType: EVENT_TYPES.QC_LOT_CANCELLATION_REFUSED } });
    assert.equal(refused.length, 1);
    // an event for another tenant's GRN id is ignored under RLS
    await broker.publish(rk(EVENT_TYPES.GRN_CANCELLATION_REQUESTED), envelope(tenantB, EVENT_TYPES.GRN_CANCELLATION_REQUESTED, { grnId: grnBusy, grnNumber: 'GRN/Y', reason: 'hijack', lineIds: [lineBusy] }, 'svc-procurement'));
    await broker.drain();
    assert.equal((await api(owner).get(`/api/v1/qc/lots/${busyLot.id}`)).body.data.status, 'IN_INSPECTION');
    assert.equal((await rt.prisma.outboxEvent.count({ where: { tenantId: tenantB } })), 0);
  });
});
