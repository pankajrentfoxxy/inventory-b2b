/**
 * Laptop flow end to end (master + party + inventory + qc + procurement, shared in-memory broker):
 * spec masters -> laptop configuration (generated SKU) -> PO selects the SKU and shows the specs ->
 * PO creates no stock -> GRN 10 serials (received, QC hold, not available) -> QC lot created
 * automatically with the expected specs -> laptop checks (spec by spec, power, missing parts) with
 * PASS / FAIL / HOLD -> HOLD blocks the decision -> 9 pass, 1 fail -> AVAILABLE 9, REJECTED 1 ->
 * every serial traceable to QC lot, GRN, PO and the configuration's specs.
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
const owner = tenantToken({ tenantId, userId: randomUUID(), name: 'Owner' });
const approver = tenantToken({ tenantId, userId: randomUUID(), name: 'Approver', perms: ['purchase.view', 'purchase.approve', 'purchase.issue', 'qc.view', 'qc.approve', 'qc.inspect', 'grn.view'] });

const on = (app: Express, token: string) => ({
  get: (p: string) => request(app).get(p).set('Authorization', `Bearer ${token}`),
  post: (p: string, body: unknown = {}, headers: Record<string, string> = {}) => request(app).post(p).set('Authorization', `Bearer ${token}`).set(headers).send(body as object),
  put: (p: string, body: unknown = {}) => request(app).put(p).set('Authorization', `Bearer ${token}`).send(body as object),
});
const idem = () => ({ 'Idempotency-Key': randomUUID() });
const settle = () => settleEvents(broker, [master.relay, party.relay, inventory.relay, qc.relay, proc.relay], 60);

const EXPECTED = { brand: 'Dell', model: 'Latitude 5440', generation: '13th Gen', processor: 'Intel Core i5-1345U', ram: '16 GB', ssd: '512 GB', gpu: 'Intel Iris Xe', screenSize: '14"' };
const SPEC_KEYS = Object.keys(EXPECTED) as (keyof typeof EXPECTED)[];
const allMatch = () => Object.fromEntries(SPEC_KEYS.map((k) => [k, { match: true }]));
const SERIALS = Array.from({ length: 10 }, (_, i) => `DL5440-${String(i + 1).padStart(3, '0')}`);

let warehouseId: string;
let supplierId: string;
let laptopId: string;

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

  const activated: EventEnvelope = { eventId: uuidv7(), eventType: EVENT_TYPES.TENANT_ACTIVATED, eventVersion: 1, occurredAt: new Date().toISOString(), tenantId, producer: 'svc-tenant', correlationId: 'c', causationId: null, actor: { type: 'user', id: null }, aggregate: { type: 'tenant', id: tenantId, version: 2 }, payload: { tenantId, code: 'T', legalName: 'T', displayName: 'T', status: 'ACTIVE', previousStatus: 'APPROVED', reason: null, ownerName: 'o', ownerEmail: 'o@t.test', actorId: null, occurredAt: new Date().toISOString(), stateCode: '27', registeredAddress: { line1: '1 Road', city: 'Pune', stateCode: '27', pincode: '411001', country: 'IN' } } };
  await broker.publish(rk(EVENT_TYPES.TENANT_ACTIVATED), activated);
  await settle();

  const m = on(master.app, owner);
  warehouseId = (await m.get('/api/v1/master/warehouses')).body.data[0].id;
  const seeded = (await m.get('/api/v1/master/laptop-specs')).body.data as { id: string; kind: string; name: string }[];
  const pick = (kind: string, name: string) => seeded.find((o) => o.kind === kind && o.name === name)!.id;
  const add = async (body: Record<string, unknown>) => {
    const r = await m.post('/api/v1/master/laptop-specs', body);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.data.id as string;
  };
  const brandId = pick('BRAND', 'Dell');
  const config = await m.post('/api/v1/master/laptops', {
    brandId,
    modelId: await add({ kind: 'MODEL', name: 'Latitude 5440', code: 'LAT5440', brandId }),
    generationId: pick('GENERATION', '13th Gen'),
    processorId: await add({ kind: 'PROCESSOR', name: 'Intel Core i5-1345U', code: 'I5' }),
    ramId: pick('RAM', '16 GB'),
    ssdId: pick('SSD', '512 GB'),
    gpuId: await add({ kind: 'GPU', name: 'Intel Iris Xe' }),
    screenSizeId: pick('SCREEN_SIZE', '14"'),
    activate: true,
  });
  assert.equal(config.status, 201, JSON.stringify(config.body));
  assert.equal(config.body.data.sku, 'DELL-LAT5440-I5-16-512');
  laptopId = config.body.data.id;

  const sup = await on(party.app, owner).post('/api/v1/party/suppliers', { legalName: 'ABC Computers Pvt Ltd', displayName: 'ABC Computers', gstTreatment: 'REGISTERED', gstin: '27AAPFU0939F1ZV', pan: 'AAPFU0939F', addresses: [{ kind: 'BILLING', line1: '12 MIDC Road', city: 'Pune', state: 'Maharashtra', stateCode: '27', pincode: '411001', isDefault: true }], contacts: [{ name: 'Anita Desai', email: 'anita@abc.test', isPrimary: true }] });
  assert.equal(sup.status, 201, JSON.stringify(sup.body));
  supplierId = sup.body.data.id;
  await settle();
});
after(async () => {
  await Promise.all(servers.map((s) => s.close()));
  await Promise.all([proc.stop(), qc.stop(), inventory.stop(), party.stop(), master.stop()]);
});

const stock = async () => {
  const rows = (await on(inventory.app, owner).get(`/api/v1/inventory/stock?itemId=${laptopId}`)).body.data as Record<string, unknown>[];
  const r = rows[0] ?? {};
  return { qcHold: (r.qcHold as number) ?? 0, available: (r.available as number) ?? 0, rejected: (r.rejected as number) ?? 0, specs: r.specs ?? null };
};

describe('laptop flow', () => {
  it('Laptop master -> SKU -> PO -> GRN -> QC ticket -> QC 9 pass / 1 fail (after a hold) -> 9 available, fully traceable', async () => {
    const p = on(proc.app, owner);

    // Purchase order: select the SKU; specs come from the configuration
    const created = await p.post('/api/v1/procurement/purchase-orders', { supplierId, shipToWarehouseId: warehouseId, orderDate: '2026-10-01', lines: [{ itemId: laptopId, orderedQty: 10, unitPrice: 55000 }] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const po = created.body.data;
    assert.equal(po.lines[0].item.sku, 'DELL-LAT5440-I5-16-512');
    assert.deepEqual(po.lines[0].item.specs, EXPECTED, 'the PO line shows the configuration specs');
    assert.equal((await p.post(`/api/v1/procurement/purchase-orders/${po.id}/submit`)).status, 200);
    assert.equal((await on(proc.app, approver).post(`/api/v1/procurement/purchase-orders/${po.id}/approve`)).status, 200);
    assert.equal((await on(proc.app, approver).post(`/api/v1/procurement/purchase-orders/${po.id}/issue`)).body.data.status, 'ISSUED');
    await settle();
    assert.deepEqual(await stock(), { qcHold: 0, available: 0, rejected: 0, specs: null }, 'a PO never creates inventory');

    // GRN: physically received, in QC hold, not available
    const grn = await p.post('/api/v1/procurement/grns?receive=true', { poId: po.id, receivedDate: '2026-10-02', supplierInvoiceNo: 'ABC-991', lines: [{ poLineId: po.lines[0].id, qty: 10, serials: SERIALS.map((s) => ({ serialNo: s })) }] }, idem());
    assert.equal(grn.status, 201, JSON.stringify(grn.body));
    assert.deepEqual(grn.body.data.lines[0].item.specs, EXPECTED, 'the GRN line carries the specs');
    await settle();
    assert.equal((await p.get(`/api/v1/procurement/grns/${grn.body.data.id}`)).body.data.status, 'QC_PENDING');
    const held = await stock();
    assert.equal(held.qcHold, 10);
    assert.equal(held.available, 0, 'received but not available before QC');
    assert.deepEqual(held.specs, EXPECTED, 'stock rows show the laptop specs');

    // QC ticket generated automatically in the existing QC queue
    const lots = (await on(qc.app, owner).get(`/api/v1/qc/lots?sourceId=${grn.body.data.id}`)).body.data as { id: string; number: string; mode: string; isLaptop: boolean; expectedSpecs: unknown; sourceNumber: string; qty: number; serials: string[] }[];
    assert.equal(lots.length, 1);
    const lot = lots[0];
    assert.equal(lot.isLaptop, true);
    assert.equal(lot.mode, 'SERIAL');
    assert.equal(lot.qty, 10);
    assert.equal(lot.sourceNumber, grn.body.data.number);
    assert.deepEqual(lot.expectedSpecs, EXPECTED, 'QC verifies against the ordered configuration');
    assert.deepEqual(lot.serials, SERIALS);
    const q = on(qc.app, approver);
    const put = (results: unknown[]) => q.put(`/api/v1/qc/lots/${lot.id}/results`, { results });

    // Laptop QC rules
    const noCheck = await put([{ serialNo: SERIALS[0], result: 'PASS' }]);
    assert.equal(noCheck.status, 422);
    assert.equal(noCheck.body.error.code, 'QC_LAPTOP_CHECK_REQUIRED');
    const passWithMismatch = await put([{ serialNo: SERIALS[0], result: 'PASS', laptop: { specChecks: { ...allMatch(), ram: { match: false, actual: '8 GB' } }, powersOn: true } }]);
    assert.equal(passWithMismatch.status, 422);
    assert.equal(passWithMismatch.body.error.code, 'QC_LAPTOP_CHECK_FAILED');
    assert.match(passWithMismatch.body.error.message, /RAM do not match/);
    const mismatchWithoutActual = await put([{ serialNo: SERIALS[0], result: 'FAIL', laptop: { specChecks: { ...allMatch(), ssd: { match: false } }, powersOn: true } }]);
    assert.equal(mismatchWithoutActual.status, 422);
    assert.equal(mismatchWithoutActual.body.error.details[0].path, 'results.0.laptop.specChecks.ssd.actual');
    const passNoPower = await put([{ serialNo: SERIALS[0], result: 'PASS', laptop: { specChecks: allMatch(), powersOn: false } }]);
    assert.equal(passNoPower.status, 422, 'a laptop that does not power on cannot pass');
    const passMissingCharger = await put([{ serialNo: SERIALS[0], result: 'PASS', laptop: { specChecks: allMatch(), powersOn: true, missingParts: ['CHARGER'] } }]);
    assert.equal(passMissingCharger.status, 422, 'a laptop with missing parts cannot pass');
    const holdWithoutReason = await put([{ serialNo: SERIALS[0], result: 'HOLD', laptop: { specChecks: allMatch(), powersOn: true } }]);
    assert.equal(holdWithoutReason.status, 422);
    assert.equal(holdWithoutReason.body.error.details[0].path, 'results.0.remarks');

    // 8 pass, 1 fail (RAM mismatch), 1 on hold
    const saved = await put([
      ...SERIALS.slice(0, 8).map((s, i) => ({ serialNo: s, result: 'PASS', gradeCode: 'A', laptop: { specChecks: allMatch(), powersOn: true, assetTag: `ttspl${6040 + i}` } })),
      { serialNo: SERIALS[8], result: 'FAIL', laptop: { specChecks: { ...allMatch(), ram: { match: false, actual: '8 GB' } }, powersOn: true } },
      { serialNo: SERIALS[9], result: 'HOLD', remarks: 'Battery health check pending', laptop: { specChecks: allMatch(), powersOn: true } },
    ]);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.deepEqual(saved.body.data.progress, { inspected: 10, total: 10, passed: 8, failed: 1, onHold: 1 });
    const failed = saved.body.data.results.find((r: { serialNo: string }) => r.serialNo === SERIALS[8]);
    assert.deepEqual(failed.defectCodes, ['SPEC_MISMATCH'], 'the reason is recorded automatically');
    assert.equal(failed.laptopCheck.specChecks.ram.actual, '8 GB');
    assert.equal(saved.body.data.results.find((r: { serialNo: string }) => r.serialNo === SERIALS[0]).laptopCheck.assetTag, 'TTSPL6040');

    // HOLD blocks the decision; nothing becomes available
    const blocked = await q.post(`/api/v1/qc/lots/${lot.id}/decide`, {});
    assert.equal(blocked.status, 422);
    assert.equal(blocked.body.error.code, 'QC_UNITS_ON_HOLD');
    assert.match(blocked.body.error.details[0].message, /DL5440-010/);
    await settle();
    assert.equal((await stock()).available, 0);

    // resolve the hold, decide
    assert.equal((await put([{ serialNo: SERIALS[9], result: 'PASS', gradeCode: 'A', laptop: { specChecks: allMatch(), powersOn: true } }])).status, 200);
    const decided = await q.post(`/api/v1/qc/lots/${lot.id}/decide`, {});
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    assert.equal(decided.body.data.passQty, 9);
    assert.equal(decided.body.data.failQty, 1);
    await settle();

    // Only QC-passed laptops are available inventory
    const after = await stock();
    assert.equal(after.available, 9);
    assert.equal(after.rejected, 1);
    assert.equal(after.qcHold, 0);
    assert.equal((await on(qc.app, owner).get(`/api/v1/qc/lots/${lot.id}`)).body.data.status, 'CLOSED');
    assert.equal((await p.get(`/api/v1/procurement/grns/${grn.body.data.id}`)).body.data.status, 'QC_COMPLETED');
    assert.equal((await p.get(`/api/v1/procurement/purchase-orders/${po.id}`)).body.data.status, 'CLOSED');

    // Traceability: serial -> QC lot -> GRN -> PO, with the configuration specs
    const inv = on(inventory.app, owner);
    const good = (await inv.get(`/api/v1/inventory/serials?q=${SERIALS[0]}`)).body.data[0];
    assert.equal(good.bucket, 'AVAILABLE');
    assert.equal(good.qcLotId, lot.id);
    assert.equal(good.grnId, grn.body.data.id);
    assert.equal(good.poId, po.id);
    const detail = (await inv.get(`/api/v1/inventory/serials/${good.id}`)).body.data;
    assert.equal(detail.item.sku, 'DELL-LAT5440-I5-16-512');
    assert.deepEqual(detail.item.specs, EXPECTED);
    const bad = (await inv.get(`/api/v1/inventory/serials?q=${SERIALS[8]}`)).body.data[0];
    assert.equal(bad.bucket, 'REJECTED', 'the failed laptop is never available');
  });
});
