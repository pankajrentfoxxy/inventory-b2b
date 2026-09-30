/**
 * svc-master (phase-03 step 9): seeding on activation, product rules, duplicate SKU (sequential +
 * concurrent), field locks after movements, lifecycle, delete guard with references, warehouses
 * with scope filtering, simple masters, numbering, tenant isolation, events with versions,
 * internal batch API.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { EVENT_TYPES, rk } from '@b2b/contracts';
import { StaticKeyProvider, loadEnv, uuidv7, type EventEnvelope } from '@b2b/platform-kit';
import { InMemoryBroker, serviceToken, tenantToken, testKeys, truncateAll } from '@b2b/test-kit';
import { masterEnvSchema } from '../src/config.js';
import type { MovementSource } from '../src/modules/master.service.js';
import { createMasterRuntime, type MasterRuntime } from '../src/service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let rt: MasterRuntime;
let broker: InMemoryBroker;
const moved = new Set<string>();
const movements: MovementSource = { hasMovements: async (_t, itemId) => moved.has(itemId) };
const tenantA = randomUUID();
const tenantB = randomUUID();
const ownerA = tenantToken({ tenantId: tenantA, name: 'Owner A' });
const ownerB = tenantToken({ tenantId: tenantB, name: 'Owner B' });
const viewerA = tenantToken({ tenantId: tenantA, perms: ['master.view', 'warehouse.view'] });

const api = (token: string) => ({
  get: (p: string) => request(rt.app).get(p).set('Authorization', `Bearer ${token}`),
  post: (p: string, body: unknown = {}) => request(rt.app).post(p).set('Authorization', `Bearer ${token}`).send(body as object),
  patch: (p: string, body: unknown, version?: number) => {
    const r = request(rt.app).patch(p).set('Authorization', `Bearer ${token}`);
    return (version !== undefined ? r.set('If-Match', String(version)) : r).send(body as object);
  },
  del: (p: string) => request(rt.app).delete(p).set('Authorization', `Bearer ${token}`),
});

function activated(tenantId: string, stateCode = '27'): EventEnvelope {
  return { eventId: uuidv7(), eventType: EVENT_TYPES.TENANT_ACTIVATED, eventVersion: 1, occurredAt: new Date().toISOString(), tenantId, producer: 'svc-tenant', correlationId: 'c', causationId: null, actor: { type: 'user', id: null }, aggregate: { type: 'tenant', id: tenantId, version: 2 }, payload: { tenantId, code: 'T', legalName: 'T', displayName: 'T', status: 'ACTIVE', previousStatus: 'APPROVED', reason: null, ownerName: 'o', ownerEmail: 'o@t.test', actorId: null, occurredAt: new Date().toISOString(), stateCode, registeredAddress: { line1: '1 Road', city: 'Pune', stateCode, pincode: '411001', country: 'IN' } } };
}

let unitId: string;
let taxId: string;
let seq = 0;
const product = (overrides: Record<string, unknown> = {}) => ({ sku: `SKU-${++seq}`, name: `Widget ${seq}`, type: 'GOODS', unitId, taxRateId: taxId, ...overrides });

before(async () => {
  const env = loadEnv(masterEnvSchema, { dir: path.resolve(here, '..') });
  await truncateAll(env.MIGRATE_DATABASE_URL!);
  broker = new InMemoryBroker();
  rt = await createMasterRuntime(env, { broker, keys: new StaticKeyProvider(testKeys().publicKeyPem), movements });
  await rt.start();
  await broker.publish(rk(EVENT_TYPES.TENANT_ACTIVATED), activated(tenantA));
  await broker.publish(rk(EVENT_TYPES.TENANT_ACTIVATED), activated(tenantA)); // redelivery
  await broker.publish(rk(EVENT_TYPES.TENANT_ACTIVATED), activated(tenantB, '29'));
  await broker.drain();
  const units = await api(ownerA).get('/api/v1/master/units');
  unitId = units.body.data.find((u: { code: string }) => u.code === 'PCS').id;
  const taxes = await api(ownerA).get('/api/v1/master/tax-rates');
  taxId = taxes.body.data.find((t: { name: string }) => t.name === 'GST 18%').id;
});
after(async () => {
  await rt.stop();
});

describe('seeding', () => {
  it('seeds units, tax slabs, payment terms, grades, numbering and a default warehouse once per tenant', async () => {
    assert.equal((await api(ownerA).get('/api/v1/master/units')).body.data.length, 8);
    assert.equal((await api(ownerA).get('/api/v1/master/tax-rates')).body.data.length, 5);
    assert.equal((await api(ownerA).get('/api/v1/master/payment-terms')).body.data.filter((p: { isDefault: boolean }) => p.isDefault).length, 1);
    assert.equal((await api(ownerA).get('/api/v1/master/condition-grades')).body.data.length, 6);
    const numbering = await api(ownerA).get('/api/v1/master/settings/numbering');
    assert.equal(numbering.body.data.length, 14);
    const wh = await api(ownerA).get('/api/v1/master/warehouses');
    assert.equal(wh.body.data.length, 1, 'one default warehouse despite the redelivered event');
    assert.equal(wh.body.data[0].code, 'MAIN');
    assert.equal(wh.body.data[0].isDefault, true);
    assert.equal(wh.body.data[0].stateCode, '27');
    assert.equal((await api(ownerB).get('/api/v1/master/warehouses')).body.data[0].stateCode, '29');
    const events = await rt.prisma.outboxEvent.findMany({ where: { tenantId: tenantA, eventType: EVENT_TYPES.MASTER_WAREHOUSE_CREATED } });
    assert.equal(events.length, 1);
  });
});

describe('products', () => {
  it('creates a draft with snapshot fields and rejects inconsistent settings', async () => {
    const res = await api(ownerA).post('/api/v1/master/products', product({ sku: 'ssd-870', name: 'Samsung SSD', isSerialized: true }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'DRAFT');
    assert.equal(res.body.data.trackInventory, true, 'goods track inventory by default');
    assert.equal(res.body.data.unitCode, 'PCS');
    assert.equal(res.body.data.taxRate, 18);
    assert.equal(res.body.data.version, 0);
    const service = await api(ownerA).post('/api/v1/master/products', product({ type: 'SERVICE', trackInventory: true }));
    assert.equal(service.status, 422);
    assert.equal(service.body.error.code, 'MASTER_RULE_VIOLATION');
    const serialNoTrack = await api(ownerA).post('/api/v1/master/products', product({ isSerialized: true, trackInventory: false }));
    assert.equal(serialNoTrack.status, 422);
    const imei = await api(ownerA).post('/api/v1/master/products', product({ requiresImei: true }));
    assert.equal(imei.status, 422);
    const badUnit = await api(ownerA).post('/api/v1/master/products', product({ unitId: randomUUID() }));
    assert.equal(badUnit.status, 422);
    assert.equal(badUnit.body.error.details[0].path, 'unitId');
    const okService = await api(ownerA).post('/api/v1/master/products', product({ type: 'SERVICE', trackInventory: false, activate: true }));
    assert.equal(okService.status, 201, JSON.stringify(okService.body));
    assert.equal(okService.body.data.status, 'ACTIVE');
    assert.equal(okService.body.data.qcRequired, false);
  });

  it('rejects duplicate SKUs case-insensitively, also under concurrency', async () => {
    const first = await api(ownerA).post('/api/v1/master/products', product({ sku: 'DUP-1' }));
    assert.equal(first.status, 201);
    const dup = await api(ownerA).post('/api/v1/master/products', product({ sku: 'dup-1' }));
    assert.equal(dup.status, 422);
    assert.equal(dup.body.error.code, 'MASTER_DUPLICATE_SKU');
    const results = await Promise.all(Array.from({ length: 6 }, () => api(ownerA).post('/api/v1/master/products', product({ sku: 'RACE-1' }))));
    assert.equal(results.filter((r) => r.status === 201).length, 1, JSON.stringify(results.map((r) => r.status)));
    assert.ok(results.filter((r) => r.status !== 201).every((r) => r.status === 422 && r.body.error.code === 'MASTER_DUPLICATE_SKU'));
    // Same SKU in another tenant is fine.
    const unitsB = await api(ownerB).get('/api/v1/master/units');
    const other = await api(ownerB).post('/api/v1/master/products', { sku: 'DUP-1', name: 'B widget', type: 'GOODS', unitId: unitsB.body.data[0].id });
    assert.equal(other.status, 201, JSON.stringify(other.body));
  });

  it('locks inventory fields after the first stock movement and enforces If-Match', async () => {
    const created = await api(ownerA).post('/api/v1/master/products', product({ isSerialized: true }));
    const id = created.body.data.id as string;
    const stale = await api(ownerA).patch(`/api/v1/master/products/${id}`, { name: 'Renamed' }, 5);
    assert.equal(stale.status, 409);
    const rename = await api(ownerA).patch(`/api/v1/master/products/${id}`, { name: 'Renamed' }, 0);
    assert.equal(rename.status, 200, JSON.stringify(rename.body));
    assert.equal(rename.body.data.version, 1);
    const flip = await api(ownerA).patch(`/api/v1/master/products/${id}`, { isSerialized: false }, 1);
    assert.equal(flip.status, 200, 'no movements yet: flags may change');
    moved.add(id);
    const locked = await api(ownerA).patch(`/api/v1/master/products/${id}`, { isSerialized: true, trackInventory: true }, 2);
    assert.equal(locked.status, 422);
    assert.equal(locked.body.error.code, 'MASTER_FIELD_LOCKED');
    const priceOk = await api(ownerA).patch(`/api/v1/master/products/${id}`, { sellingPrice: 999 }, 2);
    assert.equal(priceOk.status, 200, 'non-locked fields still editable');
    const detail = await api(ownerA).get(`/api/v1/master/products/${id}`);
    assert.deepEqual(detail.body.data.lockedFields, ['isSerialized', 'trackInventory', 'unitId', 'type']);
    const updates = await rt.prisma.outboxEvent.findMany({ where: { aggregateId: id, eventType: EVENT_TYPES.MASTER_PRODUCT_UPDATED }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(updates.map((e) => (e.envelope as unknown as EventEnvelope).aggregate.version), [1, 2, 3], 'each update bumps the version consumers compare');
  });

  it('walks the lifecycle and applies the delete guard', async () => {
    const created = await api(ownerA).post('/api/v1/master/products', product());
    const id = created.body.data.id as string;
    assert.equal((await api(ownerA).post(`/api/v1/master/products/${id}/deactivate`)).status, 409, 'DRAFT cannot deactivate');
    assert.equal((await api(ownerA).post(`/api/v1/master/products/${id}/activate`)).body.data.status, 'ACTIVE');
    assert.equal((await api(ownerA).post(`/api/v1/master/products/${id}/activate`)).status, 409);
    assert.equal((await api(ownerA).post(`/api/v1/master/products/${id}/deactivate`)).body.data.status, 'INACTIVE');
    const lookups = await api(ownerA).get('/api/v1/master/lookups/products?q=Widget');
    assert.ok(!lookups.body.data.some((p: { id: string }) => p.id === id), 'inactive items are not offered on new documents');
    assert.equal((await api(ownerA).del(`/api/v1/master/products/${id}`)).status, 422, 'only drafts can be deleted');
    // A referenced draft cannot be deleted either.
    const draft = await api(ownerA).post('/api/v1/master/products', product());
    await broker.publish(rk(EVENT_TYPES.PO_CREATED), { eventId: uuidv7(), eventType: EVENT_TYPES.PO_CREATED, eventVersion: 1, occurredAt: new Date().toISOString(), tenantId: tenantA, producer: 'svc-procurement', correlationId: 'c', causationId: null, actor: { type: 'user', id: null }, aggregate: { type: 'po', id: randomUUID(), version: 0 }, payload: { lines: [{ itemId: draft.body.data.id }] } });
    await broker.drain();
    const guarded = await api(ownerA).del(`/api/v1/master/products/${draft.body.data.id}`);
    assert.equal(guarded.status, 422);
    assert.equal(guarded.body.error.code, 'MASTER_IN_USE');
    assert.deepEqual((await api(ownerA).get(`/api/v1/master/products/${draft.body.data.id}`)).body.data.referencedBy, ['svc-procurement']);
    assert.equal((await api(ownerA).post(`/api/v1/master/products/${draft.body.data.id}/archive`)).body.data.status, 'ARCHIVED');
    assert.equal((await api(ownerA).patch(`/api/v1/master/products/${draft.body.data.id}`, { name: 'Renamed after archive' })).status, 409, 'archived is frozen');
    const unreferenced = await api(ownerA).post('/api/v1/master/products', product());
    assert.equal((await api(ownerA).del(`/api/v1/master/products/${unreferenced.body.data.id}`)).status, 200);
  });

  it('imports rows with per-row results and lists with filters and cursors', async () => {
    const imp = await api(ownerA).post('/api/v1/master/products/import', { rows: [product({ sku: 'IMP-1' }), product({ sku: 'IMP-1' }), product({ sku: 'IMP-2', type: 'SERVICE', trackInventory: true })], activate: true });
    assert.equal(imp.status, 200, JSON.stringify(imp.body));
    assert.equal(imp.body.data.created, 1);
    assert.equal(imp.body.data.failed, 2);
    assert.equal(imp.body.data.results[1].error.includes('already exists'), true);
    const page1 = await api(ownerA).get('/api/v1/master/products?limit=3');
    assert.equal(page1.body.data.length, 3);
    assert.ok(page1.body.nextCursor);
    const page2 = await api(ownerA).get(`/api/v1/master/products?limit=3&cursor=${encodeURIComponent(page1.body.nextCursor)}`);
    assert.ok(page2.body.data.every((p: { id: string }) => !page1.body.data.some((q: { id: string }) => q.id === p.id)));
    const active = await api(ownerA).get('/api/v1/master/products?status=ACTIVE&type=SERVICE');
    assert.ok(active.body.data.every((p: { status: string; type: string }) => p.status === 'ACTIVE' && p.type === 'SERVICE'));
    assert.equal((await api(viewerA).post('/api/v1/master/products', product())).status, 403);
    assert.equal((await api(viewerA).get('/api/v1/master/products')).status, 200);
  });
});

describe('warehouses and scope', () => {
  it('creates warehouses/locations/bins, keeps one default, and filters by the caller warehouse scope', async () => {
    const wh = await api(ownerA).post('/api/v1/master/warehouses', { code: 'PUNE', name: 'Pune Hub', address: { line1: 'Plot 7', city: 'Pune', stateCode: '27', pincode: '410501' } });
    assert.equal(wh.status, 201, JSON.stringify(wh.body));
    assert.equal(wh.body.data.isDefault, false);
    assert.equal((await api(ownerA).post('/api/v1/master/warehouses', { code: 'pune', name: 'Dup', address: { line1: 'x', city: 'y', stateCode: '27', pincode: '410501' } })).status, 422);
    const loc = await api(ownerA).post(`/api/v1/master/warehouses/${wh.body.data.id}/locations`, { code: 'QC', purpose: 'QC' });
    assert.equal(loc.status, 201);
    const bin = await api(ownerA).post(`/api/v1/master/locations/${loc.body.data.id}/bins`, { code: 'A-01', capacity: 100 });
    assert.equal(bin.status, 201);
    assert.equal((await api(ownerA).post(`/api/v1/master/locations/${loc.body.data.id}/bins`, { code: 'a-01' })).status, 422);
    const makeDefault = await api(ownerA).patch(`/api/v1/master/warehouses/${wh.body.data.id}`, { isDefault: true }, 0);
    assert.equal(makeDefault.status, 200, JSON.stringify(makeDefault.body));
    const list = await api(ownerA).get('/api/v1/master/warehouses');
    assert.equal(list.body.data.filter((w: { isDefault: boolean }) => w.isDefault).length, 1);
    assert.equal(list.body.data.find((w: { code: string }) => w.code === 'PUNE').locations.length, 2, 'STORE default + QC');
    const cannotDeactivateDefault = await api(ownerA).post(`/api/v1/master/warehouses/${wh.body.data.id}/status`, { status: 'INACTIVE' });
    assert.equal(cannotDeactivateDefault.status, 422);

    const scoped = tenantToken({ tenantId: tenantA, perms: ['warehouse.view'], warehouseIds: [wh.body.data.id] });
    const scopedList = await api(scoped).get('/api/v1/master/warehouses');
    assert.deepEqual(scopedList.body.data.map((w: { code: string }) => w.code), ['PUNE']);
    const main = list.body.data.find((w: { code: string }) => w.code === 'MAIN');
    assert.equal((await api(scoped).get(`/api/v1/master/warehouses/${main.id}`)).status, 404, 'out-of-scope warehouse looks like it does not exist');
    const binEvents = await rt.prisma.outboxEvent.findMany({ where: { tenantId: tenantA, eventType: EVENT_TYPES.MASTER_BIN_CREATED } });
    assert.equal(binEvents.length, 1);
  });
});

describe('simple masters and numbering', () => {
  it('rejects duplicate names, guards archives of used records, and validates numbering templates', async () => {
    const brand = await api(ownerA).post('/api/v1/master/brands', { name: 'Samsung' });
    assert.equal(brand.status, 201);
    assert.equal((await api(ownerA).post('/api/v1/master/brands', { name: 'samsung' })).status, 422);
    const cat = await api(ownerA).post('/api/v1/master/categories', { name: 'Laptops' });
    const sub = await api(ownerA).post('/api/v1/master/categories', { name: 'Gaming', parentId: cat.body.data.id });
    assert.equal(sub.status, 201);
    assert.ok(String(sub.body.data.path).startsWith(String(cat.body.data.path)));
    const used = await api(ownerA).post('/api/v1/master/products', product({ brandId: brand.body.data.id }));
    assert.equal(used.status, 201);
    const archive = await api(ownerA).post(`/api/v1/master/brands/${brand.body.data.id}/status`, { status: 'ARCHIVED' });
    assert.equal(archive.status, 422);
    assert.equal(archive.body.error.code, 'MASTER_IN_USE');
    assert.equal((await api(ownerA).post(`/api/v1/master/brands/${brand.body.data.id}/status`, { status: 'INACTIVE' })).status, 200);
    const badSlab = await api(ownerA).post('/api/v1/master/tax-rates', { name: 'GST 13%', gstRate: 13 });
    assert.equal(badSlab.status, 422, 'GST slabs are constrained');
    const hsn = await api(ownerA).post('/api/v1/master/hsn-codes', { code: '84717020', kind: 'HSN', defaultTaxRateId: taxId });
    assert.equal(hsn.status, 201, JSON.stringify(hsn.body));
    assert.equal((await api(ownerA).post('/api/v1/master/hsn-codes', { code: '12' })).status, 422);
    const grade = await api(ownerA).post('/api/v1/master/condition-grades', { code: 'D', name: 'Grade D', sortOrder: 5, sellable: false });
    assert.equal(grade.status, 201);
    const gradeEvents = await rt.prisma.outboxEvent.findMany({ where: { tenantId: tenantA, eventType: EVENT_TYPES.MASTER_GRADE_UPDATED } });
    assert.ok(gradeEvents.length >= 2);
    const numbering = await request(rt.app).put('/api/v1/master/settings/numbering/PO').set('Authorization', `Bearer ${ownerA}`).send({ prefixTemplate: 'PO/{FY}/', padding: 5, resetEachFy: true });
    assert.equal(numbering.status, 200, JSON.stringify(numbering.body));
    assert.equal(numbering.body.data.padding, 5);
    assert.equal((await request(rt.app).put('/api/v1/master/settings/numbering/NOPE').set('Authorization', `Bearer ${ownerA}`).send({ prefixTemplate: 'X/' })).status, 404);
    assert.equal((await request(rt.app).put('/api/v1/master/settings/numbering/PO').set('Authorization', `Bearer ${viewerA}`).send({ prefixTemplate: 'X/' })).status, 403);
  });
});

describe('tenant isolation and internal API', () => {
  it('tenant B cannot see or touch tenant A products/warehouses; services fetch snapshots on behalf of a tenant', async () => {
    const a = await api(ownerA).post('/api/v1/master/products', product({ sku: 'ISO-1' }));
    assert.equal((await api(ownerB).get(`/api/v1/master/products/${a.body.data.id}`)).status, 404);
    assert.equal((await api(ownerB).patch(`/api/v1/master/products/${a.body.data.id}`, { name: 'hijack' })).status, 404);
    assert.equal((await api(ownerB).post(`/api/v1/master/products/${a.body.data.id}/activate`)).status, 404);
    const listB = await api(ownerB).get('/api/v1/master/products?q=ISO');
    assert.equal(listB.body.data.length, 0);
    const raw = await rt.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantB}, true), set_config('app.platform', 'false', true)`;
      return tx.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "products" WHERE "tenant_id" = ${tenantA}::uuid`;
    });
    assert.equal(Number(raw[0].n), 0, 'RLS hides tenant A rows from tenant B context');

    const svc = serviceToken('svc-procurement', 'svc-master');
    const batch = await request(rt.app).get(`/internal/v1/products:batch?ids=${a.body.data.id}`).set('Authorization', `Bearer ${svc}`).set('x-on-behalf-of-tenant', tenantA);
    assert.equal(batch.status, 200, JSON.stringify(batch.body));
    assert.equal(batch.body.data[0].sku, 'ISO-1');
    const wrongTenant = await request(rt.app).get(`/internal/v1/products:batch?ids=${a.body.data.id}`).set('Authorization', `Bearer ${svc}`).set('x-on-behalf-of-tenant', tenantB);
    assert.equal(wrongTenant.body.data.length, 0);
    assert.equal((await request(rt.app).get(`/internal/v1/products:batch?ids=${a.body.data.id}`).set('Authorization', `Bearer ${ownerA}`)).status, 401);
  });
});
