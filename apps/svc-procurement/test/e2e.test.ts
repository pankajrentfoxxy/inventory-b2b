/**
 * Phase 5 end-to-end (5.11): master + party + inventory + qc + procurement in one process with a shared
 * in-memory broker and real HTTP between procurement and its sources. PO for two laptop configurations
 * (10 Dell + 4 HP) -> GRN 14 serials -> QC 8/2 and 4/0 -> stock AVAILABLE 12, REJECTED 2, QC_HOLD 0;
 * serial history PO -> GRN -> QC; duplicate serial refused at GRN; cancellation before QC reverses
 * stock, after inspection is refused; reconciliation clean.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import type { Express } from 'express';
import { EVENT_TYPES, rk } from '@b2b/contracts';
import { StaticKeyProvider, createLocalServiceTokenSource, loadEnv, uuidv7, type EventEnvelope } from '@b2b/platform-kit';
import { InMemoryBroker, settleEvents, startApp, tenantToken, testKeys, truncateAll, type RunningApp } from '@b2b/test-kit';
import { inventoryEnvSchema } from '@b2b/svc-inventory/config';
import { createInventoryRuntime, type InventoryRuntime } from '@b2b/svc-inventory/service';
import { masterEnvSchema } from '@b2b/svc-master/config';
import { createMasterRuntime, type MasterRuntime } from '@b2b/svc-master/service';
import { partyEnvSchema } from '@b2b/svc-party/config';
import { createPartyRuntime, type PartyRuntime } from '@b2b/svc-party/service';
import { qcEnvSchema } from '@b2b/svc-qc/config';
import { createQcRuntime, type QcRuntime } from '@b2b/svc-qc/service';
import { procurementEnvSchema } from '../src/config.js';
import { createRemoteSources } from '../src/modules/sources.js';
import { createProcurementRuntime, type ProcurementRuntime } from '../src/service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const apps = path.resolve(here, '../..');
let master: MasterRuntime;
let party: PartyRuntime;
let inventory: InventoryRuntime;
let qc: QcRuntime;
let proc: ProcurementRuntime;
let servers: RunningApp[] = [];
let broker: InMemoryBroker;
const tenantId = randomUUID();
const ownerId = randomUUID();
const approverId = randomUUID();
const owner = tenantToken({ tenantId, userId: ownerId, name: 'Owner' });
const approver = tenantToken({ tenantId, userId: approverId, name: 'Approver', perms: ['purchase.view', 'purchase.approve', 'purchase.issue', 'qc.view', 'qc.approve', 'qc.inspect', 'grn.view'] });

const on = (app: Express, token: string) => ({
  get: (p: string) => request(app).get(p).set('Authorization', `Bearer ${token}`),
  post: (p: string, body: unknown = {}, headers: Record<string, string> = {}) => request(app).post(p).set('Authorization', `Bearer ${token}`).set(headers).send(body as object),
  put: (p: string, body: unknown = {}) => request(app).put(p).set('Authorization', `Bearer ${token}`).send(body as object),
});
const idem = () => ({ 'Idempotency-Key': randomUUID() });
const settle = () => settleEvents(broker, [master.relay, party.relay, inventory.relay, qc.relay, proc.relay], 60);

const SPEC_KEYS = ['brand', 'model', 'generation', 'processor', 'ram', 'ssd', 'gpu', 'screenSize'] as const;
const allMatch = () => Object.fromEntries(SPEC_KEYS.map((k) => [k, { match: true }]));
const passed = (serialNo: string) => ({ serialNo, result: 'PASS', gradeCode: 'A', laptop: { specChecks: allMatch(), powersOn: true } });
const failed = (serialNo: string) => ({ serialNo, result: 'FAIL', laptop: { specChecks: { ...allMatch(), ram: { match: false, actual: '8 GB' } }, powersOn: true } });
const DELL_SERIALS = Array.from({ length: 10 }, (_, i) => `DL${String(i + 1).padStart(4, '0')}`);
const HP_SERIALS = ['SN0001', 'SN0002', 'SN0003', 'SN0004'];
const terms = { monthlyRentalAmount: 2500, tenureMonths: 12 };

let warehouseId: string;
let dellId: string;
let hpId: string;
let supplierId: string;

before(async () => {
  broker = new InMemoryBroker();
  const keys = new StaticKeyProvider(testKeys().publicKeyPem);
  const envs = {
    master: loadEnv(masterEnvSchema, { dir: path.join(apps, 'svc-master') }),
    party: loadEnv(partyEnvSchema, { dir: path.join(apps, 'svc-party') }),
    inventory: loadEnv(inventoryEnvSchema, { dir: path.join(apps, 'svc-inventory') }),
    qc: loadEnv(qcEnvSchema, { dir: path.join(apps, 'svc-qc') }),
    proc: loadEnv(procurementEnvSchema, { dir: path.join(apps, 'svc-procurement') }),
  };
  for (const e of Object.values(envs)) await truncateAll(e.MIGRATE_DATABASE_URL!);
  master = await createMasterRuntime(envs.master, { broker, keys });
  party = await createPartyRuntime(envs.party, { broker, keys });
  inventory = await createInventoryRuntime(envs.inventory, { broker, keys });
  qc = await createQcRuntime(envs.qc, { broker, keys });
  await Promise.all([master.start(), party.start(), inventory.start(), qc.start()]);
  servers = await Promise.all([startApp(master.app), startApp(party.app), startApp(inventory.app)]);
  const tokens = createLocalServiceTokenSource({ serviceName: 'svc-procurement', privateKeyPem: testKeys().privateKeyPem, kid: testKeys().kid, issuer: 'svc-auth' });
  proc = await createProcurementRuntime(envs.proc, { broker, keys, sources: createRemoteSources({ master: servers[0].url, party: servers[1].url, inventory: servers[2].url }, tokens, master.logger) });
  await proc.start();

  // tenant activation seeds master defaults (units, tax slabs, MAIN warehouse in state 27)
  const activated: EventEnvelope = { eventId: uuidv7(), eventType: EVENT_TYPES.TENANT_ACTIVATED, eventVersion: 1, occurredAt: new Date().toISOString(), tenantId, producer: 'svc-tenant', correlationId: 'c', causationId: null, actor: { type: 'user', id: null }, aggregate: { type: 'tenant', id: tenantId, version: 2 }, payload: { tenantId, code: 'T', legalName: 'T', displayName: 'T', status: 'ACTIVE', previousStatus: 'APPROVED', reason: null, ownerName: 'o', ownerEmail: 'o@t.test', actorId: null, occurredAt: new Date().toISOString(), stateCode: '27', registeredAddress: { line1: '1 Road', city: 'Pune', stateCode: '27', pincode: '411001', country: 'IN' } } };
  await broker.publish(rk(EVENT_TYPES.TENANT_ACTIVATED), activated);
  await settle();
  const m = on(master.app, owner);
  warehouseId = (await m.get('/api/v1/master/warehouses')).body.data[0].id;
  // two laptop configurations (serialized, QC required, GST 18% by default)
  const seeded = (await m.get('/api/v1/master/laptop-specs')).body.data as { id: string; kind: string; name: string }[];
  const pick = (kind: string, name: string) => seeded.find((o) => o.kind === kind && o.name === name)!.id;
  const add = async (body: Record<string, unknown>) => {
    const r = await m.post('/api/v1/master/laptop-specs', body);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.data.id as string;
  };
  const laptop = async (brand: string, model: string, generation: string, processor: string, gpuId: string) => {
    const brandId = pick('BRAND', brand);
    const r = await m.post('/api/v1/master/laptops', {
      brandId, modelId: await add({ kind: 'MODEL', name: model, brandId }), generationId: pick('GENERATION', generation), processorId: await add({ kind: 'PROCESSOR', name: processor }),
      ramId: pick('RAM', '16 GB'), ssdId: pick('SSD', '512 GB'), gpuId, screenSizeId: pick('SCREEN_SIZE', '14"'), activate: true,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.data.id as string;
  };
  const irisXe = await add({ kind: 'GPU', name: 'Intel Iris Xe' });
  dellId = await laptop('Dell', 'Latitude 5440', '13th Gen', 'Intel Core i5-1345U', irisXe);
  hpId = await laptop('HP', 'EliteBook 840 G9', '12th Gen', 'Intel Core i7-1255U', irisXe);
  const sup = await on(party.app, owner).post('/api/v1/party/suppliers', { legalName: 'Acme Components Pvt Ltd', displayName: 'Acme', gstTreatment: 'REGISTERED', gstin: '27AAPFU0939F1ZV', pan: 'AAPFU0939F', addresses: [{ kind: 'BILLING', line1: '12 MIDC Road', city: 'Pune', state: 'Maharashtra', stateCode: '27', pincode: '411001', isDefault: true }], contacts: [{ name: 'Anita Desai', email: 'anita@acme.test', isPrimary: true }] });
  assert.equal(sup.status, 201, JSON.stringify(sup.body));
  supplierId = sup.body.data.id;
  await settle(); // item / warehouse refs reach inventory
});
after(async () => {
  await Promise.all(servers.map((s) => s.close()));
  await Promise.all([proc.stop(), qc.stop(), inventory.stop(), party.stop(), master.stop()]);
});

const stockOf = async (itemId: string) => {
  const rows = (await on(inventory.app, owner).get(`/api/v1/inventory/stock?itemId=${itemId}`)).body.data as Record<string, number>[];
  const r = rows[0] ?? {};
  return { qcHold: r.qcHold ?? 0, available: r.available ?? 0, rejected: r.rejected ?? 0, reserved: r.reserved ?? 0 };
};

describe('end to end', () => {
  it('PO 10 Dell + 4 HP -> GRN 14 serials -> QC 8/2 and 4/0 -> AVAILABLE 12, REJECTED 2, QC_HOLD 0; serial history PO -> GRN -> QC; PO closed', async () => {
    const p = on(proc.app, owner);
    const created = await p.post('/api/v1/procurement/purchase-orders', { supplierId, shipToWarehouseId: warehouseId, orderDate: '2026-10-01', lines: [{ itemId: dellId, orderedQty: 10, unitPrice: 55000, monthlyRentalAmount: 3500, tenureMonths: 12 }, { itemId: hpId, orderedQty: 4, unitPrice: 62000, monthlyRentalAmount: 4000, tenureMonths: 24 }] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const po = created.body.data;
    assert.equal(po.total, 941640, '(550000 + 248000) * 1.18, intra-state');
    assert.equal(po.supplier.gstin, '27AAPFU0939F1ZV');
    assert.deepEqual(po.lines[1].item.specs, { brand: 'HP', model: 'EliteBook 840 G9', generation: '12th Gen', processor: 'Intel Core i7-1255U', ram: '16 GB', ssd: '512 GB', gpu: 'Intel Iris Xe', screenSize: '14"' }, 'specs resolved from master');
    assert.deepEqual([po.lines[1].monthlyRentalAmount, po.lines[1].tenureMonths], [4000, 24]);
    // the same configuration twice on one PO is refused (merge into one line)
    const twice = await p.post('/api/v1/procurement/purchase-orders', { supplierId, shipToWarehouseId: warehouseId, orderDate: '2026-10-01', lines: [{ itemId: dellId, orderedQty: 5, unitPrice: 55000, ...terms }, { itemId: dellId, orderedQty: 5, unitPrice: 55000, ...terms }] });
    assert.equal(twice.body.error.code, 'PO_DUPLICATE_LINE', JSON.stringify(twice.body));
    assert.equal((await p.post(`/api/v1/procurement/purchase-orders/${po.id}/submit`)).status, 200);
    assert.equal((await on(proc.app, approver).post(`/api/v1/procurement/purchase-orders/${po.id}/approve`)).status, 200);
    assert.equal((await on(proc.app, approver).post(`/api/v1/procurement/purchase-orders/${po.id}/issue`)).body.data.status, 'ISSUED');
    await settle();
    // master saw the PO and now guards the products against deletion
    const del = await request(master.app).delete(`/api/v1/master/products/${dellId}`).set('Authorization', `Bearer ${owner}`);
    assert.equal(del.status, 422, JSON.stringify(del.body));
    assert.equal(del.body.error.code, 'MASTER_IN_USE');

    const dellLine = po.lines.find((l: { itemId: string }) => l.itemId === dellId);
    const hpLine = po.lines.find((l: { itemId: string }) => l.itemId === hpId);
    const grn = await p.post('/api/v1/procurement/grns?receive=true', { poId: po.id, receivedDate: '2026-10-02', supplierInvoiceNo: 'INV-77', lines: [{ poLineId: dellLine.id, qty: 10, serials: DELL_SERIALS.map((s) => ({ serialNo: s })) }, { poLineId: hpLine.id, qty: 4, serials: HP_SERIALS.map((s) => ({ serialNo: s })) }] }, idem());
    assert.equal(grn.status, 201, JSON.stringify(grn.body));
    assert.equal(grn.body.data.status, 'RECEIVED');
    assert.equal((await p.get(`/api/v1/procurement/purchase-orders/${po.id}`)).body.data.status, 'RECEIVED');
    await settle();
    assert.equal((await p.get(`/api/v1/procurement/grns/${grn.body.data.id}`)).body.data.status, 'QC_PENDING');
    assert.deepEqual(await stockOf(dellId), { qcHold: 10, available: 0, rejected: 0, reserved: 0 });
    assert.deepEqual(await stockOf(hpId), { qcHold: 4, available: 0, rejected: 0, reserved: 0 });
    const lots = (await on(qc.app, owner).get(`/api/v1/qc/lots?sourceId=${grn.body.data.id}`)).body.data as { id: string; itemId: string; mode: string; status: string; isLaptop: boolean; serials: string[] }[];
    assert.equal(lots.length, 2);
    const dellLot = lots.find((l) => l.itemId === dellId)!;
    const hpLot = lots.find((l) => l.itemId === hpId)!;
    assert.equal(dellLot.mode, 'SERIAL');
    assert.equal(dellLot.isLaptop, true);
    assert.deepEqual(hpLot.serials, HP_SERIALS);

    // a duplicate serial is refused at GRN time by the synchronous pre-check
    const po2 = await p.post('/api/v1/procurement/purchase-orders', { supplierId, shipToWarehouseId: warehouseId, orderDate: '2026-10-03', lines: [{ itemId: hpId, orderedQty: 1, unitPrice: 62000, ...terms }] });
    await p.post(`/api/v1/procurement/purchase-orders/${po2.body.data.id}/submit`);
    await on(proc.app, approver).post(`/api/v1/procurement/purchase-orders/${po2.body.data.id}/approve`);
    await on(proc.app, approver).post(`/api/v1/procurement/purchase-orders/${po2.body.data.id}/issue`);
    const dup = await p.post('/api/v1/procurement/grns?receive=true', { poId: po2.body.data.id, receivedDate: '2026-10-03', lines: [{ poLineId: po2.body.data.lines[0].id, qty: 1, serials: [{ serialNo: 'SN0001' }] }] }, idem());
    assert.equal(dup.status, 422, JSON.stringify(dup.body));
    assert.equal(dup.body.error.code, 'SERIAL_DUPLICATE');

    // QC decisions
    const q = on(qc.app, approver);
    const dellResults = await q.put(`/api/v1/qc/lots/${dellLot.id}/results`, { results: [...DELL_SERIALS.slice(0, 8).map(passed), ...DELL_SERIALS.slice(8).map(failed)] });
    assert.equal(dellResults.status, 200, JSON.stringify(dellResults.body));
    const dellDecision = await q.post(`/api/v1/qc/lots/${dellLot.id}/decide`, {});
    assert.equal(dellDecision.status, 200, JSON.stringify(dellDecision.body));
    assert.deepEqual([dellDecision.body.data.passQty, dellDecision.body.data.failQty], [8, 2]);
    assert.equal((await q.put(`/api/v1/qc/lots/${hpLot.id}/results`, { results: HP_SERIALS.map(passed) })).status, 200);
    assert.equal((await q.post(`/api/v1/qc/lots/${hpLot.id}/decide`, {})).body.data.passQty, 4);
    await settle();
    assert.deepEqual(await stockOf(dellId), { qcHold: 0, available: 8, rejected: 2, reserved: 0 });
    assert.deepEqual(await stockOf(hpId), { qcHold: 0, available: 4, rejected: 0, reserved: 0 });
    assert.equal((await on(qc.app, owner).get(`/api/v1/qc/lots/${dellLot.id}`)).body.data.status, 'CLOSED');
    const grnDone = (await p.get(`/api/v1/procurement/grns/${grn.body.data.id}`)).body.data;
    assert.equal(grnDone.status, 'QC_COMPLETED');
    assert.deepEqual(grnDone.qcProgress, { total: 2, done: 2, passQty: 12, failQty: 2 });
    assert.equal((await p.get(`/api/v1/procurement/purchase-orders/${po.id}`)).body.data.status, 'CLOSED');

    const serial = (await on(inventory.app, owner).get('/api/v1/inventory/serials?q=SN0002')).body.data[0];
    assert.equal(serial.bucket, 'AVAILABLE');
    assert.equal(serial.qcStatus, 'PASSED');
    assert.equal(serial.gradeCode, 'A');
    assert.equal(serial.grnId, grn.body.data.id);
    assert.equal(serial.poId, po.id);
    assert.equal(serial.qcLotId, hpLot.id);
    const history = (await on(inventory.app, owner).get(`/api/v1/inventory/serials/${serial.id}/history`)).body.data as { postingType: string; refType: string }[];
    assert.deepEqual(history.map((h) => [h.postingType, h.refType]), [['RECEIPT', 'GRN'], ['QC_PASS', 'QC_LOT']]);
    const avail = (await on(inventory.app, owner).get(`/api/v1/inventory/stock/${dellId}`)).body.data;
    assert.equal(avail.byWarehouse.find((w: { bucket: string }) => w.bucket === 'REJECTED').qty, 2, 'failed units sit in REJECTED and are never available');
    // audit trail across services: PO_CREATED ... GRN_RECEIVED (procurement), QC_DECIDED (qc) with actors
    const procAudits = (await proc.prisma.outboxEvent.findMany({ where: { tenantId, eventType: EVENT_TYPES.AUDIT_RECORDED } })).map((e) => JSON.stringify(e.envelope));
    for (const action of ['PO_CREATED', 'PO_SUBMITTED', 'PO_APPROVED', 'PO_ISSUED', 'GRN_CREATED', 'GRN_RECEIVED', 'GRN_QC_COMPLETED', 'PO_CLOSED']) assert.ok(procAudits.some((a) => a.includes(`"action":"${action}"`)), action);
    assert.ok(procAudits.some((a) => a.includes('PO_APPROVED') && a.includes(approverId)), 'approver recorded');
    const qcAudits = (await qc.prisma.outboxEvent.findMany({ where: { tenantId, eventType: EVENT_TYPES.AUDIT_RECORDED } })).map((e) => JSON.stringify(e.envelope));
    assert.ok(qcAudits.some((a) => a.includes('QC_DECIDED') && a.includes(approverId)));
  });

  it('GRN cancellation reverses stock before inspection and is refused after results are recorded', async () => {
    const p = on(proc.app, owner);
    let batch = 0;
    const mk = async () => {
      batch += 1;
      const serials = Array.from({ length: 10 }, (_, i) => ({ serialNo: `CX${batch}${String(i).padStart(3, '0')}` }));
      const po = (await p.post('/api/v1/procurement/purchase-orders', { supplierId, shipToWarehouseId: warehouseId, orderDate: '2026-10-04', lines: [{ itemId: dellId, orderedQty: 10, unitPrice: 55000, ...terms }] })).body.data;
      await p.post(`/api/v1/procurement/purchase-orders/${po.id}/submit`);
      await on(proc.app, approver).post(`/api/v1/procurement/purchase-orders/${po.id}/approve`);
      await on(proc.app, approver).post(`/api/v1/procurement/purchase-orders/${po.id}/issue`);
      const grn = (await p.post('/api/v1/procurement/grns?receive=true', { poId: po.id, receivedDate: '2026-10-04', lines: [{ poLineId: po.lines[0].id, qty: 10, serials }] }, idem())).body.data;
      await settle();
      return { po, grn, serials };
    };
    const before = await stockOf(dellId);
    const clean = await mk();
    assert.equal((await p.get(`/api/v1/procurement/grns/${clean.grn.id}`)).body.data.status, 'QC_PENDING');
    assert.equal((await stockOf(dellId)).qcHold, before.qcHold + 10);
    assert.equal((await p.post(`/api/v1/procurement/grns/${clean.grn.id}/cancel`, { reason: 'wrong goods' })).body.data.status, 'CANCELLATION_PENDING');
    await settle();
    const cancelled = (await p.get(`/api/v1/procurement/grns/${clean.grn.id}`)).body.data;
    assert.equal(cancelled.status, 'CANCELLED', JSON.stringify(cancelled));
    assert.equal((await stockOf(dellId)).qcHold, before.qcHold, 'stock went back to the supplier');
    assert.equal((await p.get(`/api/v1/procurement/purchase-orders/${clean.po.id}`)).body.data.status, 'ISSUED');
    const lot = (await on(qc.app, owner).get(`/api/v1/qc/lots?sourceId=${clean.grn.id}`)).body.data[0];
    assert.equal(lot.status, 'CANCELLED');

    const busy = await mk();
    const busyLot = (await on(qc.app, owner).get(`/api/v1/qc/lots?sourceId=${busy.grn.id}`)).body.data[0];
    assert.equal((await on(qc.app, approver).post(`/api/v1/qc/lots/${busyLot.id}/start`)).status, 200);
    assert.equal((await on(qc.app, approver).put(`/api/v1/qc/lots/${busyLot.id}/results`, { results: [passed(busy.serials[0].serialNo)] })).status, 200);
    await p.post(`/api/v1/procurement/grns/${busy.grn.id}/cancel`, { reason: 'changed mind' });
    await settle();
    const refused = (await p.get(`/api/v1/procurement/grns/${busy.grn.id}`)).body.data;
    assert.equal(refused.status, 'QC_PENDING');
    assert.match(refused.statusReason, /refused/i);
    assert.equal((await stockOf(dellId)).qcHold, before.qcHold + 10, 'nothing moved');

    const report = await inventory.service.reconciliation(tenantId);
    assert.equal(report.ok, true, JSON.stringify(report));
    assert.equal(broker.deadLetters.length, 0, JSON.stringify(broker.deadLetters.map((d) => [d.queue, d.error])));
  });
});
