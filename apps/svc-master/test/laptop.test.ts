/**
 * Laptop configurations: the eight spec masters (seeded, tenant-scoped, model belongs to brand),
 * configurations with generated SKUs, duplicate-configuration guard, spec lock after activation,
 * and specs on the product snapshot that PO / GRN / QC copy.
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
import { createMasterRuntime, type MasterRuntime } from '../src/service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let rt: MasterRuntime;
let broker: InMemoryBroker;
const tenantA = randomUUID();
const tenantB = randomUUID();
const ownerA = tenantToken({ tenantId: tenantA, name: 'Owner A' });
const ownerB = tenantToken({ tenantId: tenantB, name: 'Owner B' });
const viewerA = tenantToken({ tenantId: tenantA, perms: ['master.view'] });

const api = (token: string) => ({
  get: (p: string) => request(rt.app).get(p).set('Authorization', `Bearer ${token}`),
  post: (p: string, body: unknown = {}) => request(rt.app).post(p).set('Authorization', `Bearer ${token}`).send(body as object),
  patch: (p: string, body: unknown, version?: number) => {
    const r = request(rt.app).patch(p).set('Authorization', `Bearer ${token}`);
    return (version !== undefined ? r.set('If-Match', String(version)) : r).send(body as object);
  },
});

function activated(tenantId: string): EventEnvelope {
  return { eventId: uuidv7(), eventType: EVENT_TYPES.TENANT_ACTIVATED, eventVersion: 1, occurredAt: new Date().toISOString(), tenantId, producer: 'svc-tenant', correlationId: 'c', causationId: null, actor: { type: 'user', id: null }, aggregate: { type: 'tenant', id: tenantId, version: 2 }, payload: { tenantId, code: 'T', legalName: 'T', displayName: 'T', status: 'ACTIVE', previousStatus: 'APPROVED', reason: null, ownerName: 'o', ownerEmail: 'o@t.test', actorId: null, occurredAt: new Date().toISOString(), stateCode: '27', registeredAddress: { line1: '1 Road', city: 'Pune', stateCode: '27', pincode: '411001', country: 'IN' } } };
}

type Opt = { id: string; kind: string; name: string; code: string; brandId: string | null };
const opts = async (token = ownerA): Promise<Opt[]> => (await api(token).get('/api/v1/master/laptop-specs')).body.data;
const find = (list: Opt[], kind: string, name: string) => {
  const o = list.find((x) => x.kind === kind && x.name === name);
  assert.ok(o, `${kind} ${name} exists`);
  return o.id;
};
const addSpec = async (kind: string, name: string, extra: Record<string, unknown> = {}) => {
  const r = await api(ownerA).post('/api/v1/master/laptop-specs', { kind, name, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data as Opt;
};

let ids: Record<string, string>;

before(async () => {
  const env = loadEnv(masterEnvSchema, { dir: path.resolve(here, '..') });
  await truncateAll(env.MIGRATE_DATABASE_URL!);
  broker = new InMemoryBroker();
  rt = await createMasterRuntime(env, { broker, keys: new StaticKeyProvider(testKeys().publicKeyPem) });
  await rt.start();
  await broker.publish(rk(EVENT_TYPES.TENANT_ACTIVATED), activated(tenantA));
  await broker.publish(rk(EVENT_TYPES.TENANT_ACTIVATED), activated(tenantA)); // redelivery
  await broker.publish(rk(EVENT_TYPES.TENANT_ACTIVATED), activated(tenantB));
  await broker.drain();

  const seeded = await opts();
  const dell = find(seeded, 'BRAND', 'Dell');
  const model = await addSpec('MODEL', 'Latitude 5440', { brandId: dell, code: 'LAT5440' });
  const cpu = await addSpec('PROCESSOR', 'Intel Core i5-1345U', { code: 'I5' });
  const gpu = await addSpec('GPU', 'Intel Iris Xe');
  ids = {
    brandId: dell,
    modelId: model.id,
    generationId: find(seeded, 'GENERATION', '13th Gen'),
    processorId: cpu.id,
    ramId: find(seeded, 'RAM', '16 GB'),
    ssdId: find(seeded, 'SSD', '512 GB'),
    gpuId: gpu.id,
    screenSizeId: find(seeded, 'SCREEN_SIZE', '14"'),
  };
});
after(async () => {
  await rt.stop();
});

describe('laptop specification masters', () => {
  it('seeds the spec masters once per tenant and keeps them tenant-scoped', async () => {
    const a = await opts();
    const kinds = new Set(a.map((o) => o.kind));
    for (const k of ['BRAND', 'MODEL', 'GENERATION', 'PROCESSOR', 'RAM', 'SSD', 'GPU', 'SCREEN_SIZE']) assert.ok(kinds.has(k), `has ${k}`);
    assert.equal(a.filter((o) => o.kind === 'BRAND' && o.name === 'Dell').length, 1, 'redelivered activation does not duplicate');
    assert.equal(a.find((o) => o.kind === 'RAM' && o.name === '16 GB')!.code, '16');
    const b = await opts(ownerB);
    assert.ok(b.some((o) => o.kind === 'BRAND' && o.name === 'Dell'), 'tenant B has its own seeded values');
    assert.ok(!b.some((o) => o.name === 'Latitude 5440'), 'tenant B never sees tenant A models');
    const models = (await api(ownerA).get(`/api/v1/master/laptop-specs?kind=MODEL&brandId=${ids.brandId}`)).body.data;
    assert.deepEqual(models.map((m: Opt & { brandName: string }) => [m.name, m.brandName]), [['Latitude 5440', 'Dell']]);
  });

  it('enforces model-brand links, unique values per kind and the manage permission', async () => {
    const noBrand = await api(ownerA).post('/api/v1/master/laptop-specs', { kind: 'MODEL', name: 'XPS 13' });
    assert.equal(noBrand.status, 422);
    assert.equal(noBrand.body.error.details[0].path, 'brandId');
    const ramWithBrand = await api(ownerA).post('/api/v1/master/laptop-specs', { kind: 'RAM', name: '12 GB', brandId: ids.brandId });
    assert.equal(ramWithBrand.status, 422);
    const dup = await api(ownerA).post('/api/v1/master/laptop-specs', { kind: 'RAM', name: '16 gb' });
    assert.equal(dup.status, 422);
    assert.equal(dup.body.error.code, 'MASTER_DUPLICATE');
    const sameNameOtherBrand = await addSpec('MODEL', 'Latitude 5440', { brandId: (await opts()).find((o) => o.kind === 'BRAND' && o.name === 'HP')!.id });
    assert.ok(sameNameOtherBrand.id, 'model names are unique per brand, not globally');
    const viewer = await api(viewerA).post('/api/v1/master/laptop-specs', { kind: 'RAM', name: '24 GB' });
    assert.equal(viewer.status, 403);
  });
});

describe('laptop configurations', () => {
  it('creates a serialized, QC-required configuration with a generated SKU and specs on the snapshot', async () => {
    const preview = await api(ownerA).post('/api/v1/master/laptops/preview', ids);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.data.sku, 'DELL-LAT5440-I5-16-512');
    assert.equal(preview.body.data.duplicateOf, null);

    const created = await api(ownerA).post('/api/v1/master/laptops', { ...ids, activate: true, purchasePrice: 55000 });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const p = created.body.data;
    assert.equal(p.sku, 'DELL-LAT5440-I5-16-512');
    assert.equal(p.name, 'Dell Latitude 5440');
    assert.equal(p.isLaptop, true);
    assert.equal(p.isSerialized, true);
    assert.equal(p.trackInventory, true);
    assert.equal(p.qcRequired, true);
    assert.equal(p.status, 'ACTIVE');
    assert.equal(p.taxRate, 18, 'defaults to GST 18%');
    assert.deepEqual(p.specs, { brand: 'Dell', model: 'Latitude 5440', generation: '13th Gen', processor: 'Intel Core i5-1345U', ram: '16 GB', ssd: '512 GB', gpu: 'Intel Iris Xe', screenSize: '14"' });
    assert.equal(p.specIds.modelId, ids.modelId);

    const batch = await request(rt.app).get(`/internal/v1/products:batch?ids=${p.id}`).set('Authorization', `Bearer ${serviceToken('svc-procurement', 'svc-master')}`).set('x-on-behalf-of-tenant', tenantA);
    assert.equal(batch.status, 200, JSON.stringify(batch.body));
    assert.equal(batch.body.data[0].specs.processor, 'Intel Core i5-1345U', 'PO / GRN / QC snapshots carry the specs');

    const lookup = await api(ownerA).get('/api/v1/master/lookups/products?q=LAT5440');
    assert.equal(lookup.body.data[0].specs.ram, '16 GB', 'the PO picker sees the specs');

    const list = await api(ownerA).get(`/api/v1/master/products?laptop=true&ramId=${ids.ramId}`);
    assert.deepEqual(list.body.data.map((x: { sku: string }) => x.sku), ['DELL-LAT5440-I5-16-512']);
  });

  it('refuses a second configuration with identical specs and locks specs after activation', async () => {
    const again = await api(ownerA).post('/api/v1/master/laptops', ids);
    assert.equal(again.status, 422);
    assert.equal(again.body.error.code, 'MASTER_DUPLICATE_CONFIGURATION');
    assert.match(again.body.error.message, /DELL-LAT5440-I5-16-512/);

    const preview = await api(ownerA).post('/api/v1/master/laptops/preview', ids);
    assert.equal(preview.body.data.duplicateOf.sku, 'DELL-LAT5440-I5-16-512');

    const all = await opts();
    const variant = await api(ownerA).post('/api/v1/master/laptops', { ...ids, ramId: find(all, 'RAM', '32 GB') });
    assert.equal(variant.status, 201, JSON.stringify(variant.body));
    assert.equal(variant.body.data.sku, 'DELL-LAT5440-I5-32-512');
    assert.equal(variant.body.data.status, 'DRAFT');

    const draftEdit = await api(ownerA).patch(`/api/v1/master/laptops/${variant.body.data.id}`, { ramId: find(all, 'RAM', '8 GB') }, variant.body.data.version);
    assert.equal(draftEdit.status, 200, JSON.stringify(draftEdit.body));
    assert.equal(draftEdit.body.data.specs.ram, '8 GB', 'drafts may change specs');
    assert.equal(draftEdit.body.data.sku, 'DELL-LAT5440-I5-8-512', 'the draft SKU follows its specs');

    const toOriginal = await api(ownerA).patch(`/api/v1/master/laptops/${variant.body.data.id}`, { ramId: ids.ramId }, draftEdit.body.data.version);
    assert.equal(toOriginal.status, 422, 'editing a draft into an existing configuration is refused');
    assert.equal(toOriginal.body.error.code, 'MASTER_DUPLICATE_CONFIGURATION');

    const active = (await api(ownerA).get('/api/v1/master/products?laptop=true&q=DELL-LAT5440-I5-16-512')).body.data[0];
    const locked = await api(ownerA).patch(`/api/v1/master/laptops/${active.id}`, { ramId: find(all, 'RAM', '32 GB') }, active.version);
    assert.equal(locked.status, 422);
    assert.equal(locked.body.error.code, 'MASTER_FIELD_LOCKED');
    const price = await api(ownerA).patch(`/api/v1/master/laptops/${active.id}`, { purchasePrice: 54000 }, active.version);
    assert.equal(price.status, 200, JSON.stringify(price.body));
    assert.equal(price.body.data.purchasePrice, 54000, 'prices stay editable');
  });

  it('adds a numeric suffix when two configurations share the SKU parts', async () => {
    const gpu2 = await addSpec('GPU', 'NVIDIA RTX A500');
    const r = await api(ownerA).post('/api/v1/master/laptops', { ...ids, gpuId: gpu2.id });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.sku, 'DELL-LAT5440-I5-16-512-2', 'GPU is not part of the SKU, so the second one is suffixed');
  });

  it('rejects wrong-kind, inactive, cross-brand and cross-tenant specs', async () => {
    const all = await opts();
    const crossBrand = await api(ownerA).post('/api/v1/master/laptops', { ...ids, brandId: find(all, 'BRAND', 'Lenovo') });
    assert.equal(crossBrand.status, 422);
    assert.equal(crossBrand.body.error.details[0].path, 'modelId');
    const wrongKind = await api(ownerA).post('/api/v1/master/laptops', { ...ids, ramId: ids.ssdId });
    assert.equal(wrongKind.status, 422);
    assert.equal(wrongKind.body.error.details[0].path, 'ramId');
    const gen = find(all, 'GENERATION', '8th Gen');
    const off = await api(ownerA).post(`/api/v1/master/laptop-specs/${gen}/status`, { status: 'INACTIVE' });
    assert.equal(off.status, 200);
    const inactive = await api(ownerA).post('/api/v1/master/laptops', { ...ids, generationId: gen });
    assert.equal(inactive.status, 422);
    assert.match(inactive.body.error.details[0].message, /inactive/);
    const missing = await api(ownerA).post('/api/v1/master/laptops', { ...ids, gpuId: undefined });
    assert.equal(missing.status, 422, 'all eight specifications are required');
    const otherTenant = await api(ownerB).post('/api/v1/master/laptops', ids);
    assert.equal(otherTenant.status, 422, 'tenant B cannot use tenant A spec ids');
  });
});
