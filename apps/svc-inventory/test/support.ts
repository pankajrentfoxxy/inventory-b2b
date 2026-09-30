/** Shared fixtures for the inventory suites: master events that seed refs, token helpers, request helpers. */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { EVENT_TYPES, rk, type ProductSnapshot, type WarehouseSnapshot } from '@b2b/contracts';
import { StaticKeyProvider, loadEnv, uuidv7, type EventEnvelope } from '@b2b/platform-kit';
import { InMemoryBroker, testKeys, truncateAll } from '@b2b/test-kit';
import { inventoryEnvSchema } from '../src/config.js';
import { createInventoryRuntime, type InventoryRuntime } from '../src/service.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export const UNBINNED = '00000000-0000-0000-0000-000000000000';

export function envelope(tenantId: string, eventType: string, aggregate: { type: string; id: string; version: number }, payload: Record<string, unknown>, producer = 'svc-master'): EventEnvelope {
  return { eventId: uuidv7(), eventType, eventVersion: 1, occurredAt: new Date().toISOString(), tenantId, producer, correlationId: 'test', causationId: null, actor: { type: 'user', id: null }, aggregate, payload };
}

export function product(tenantId: string, overrides: Partial<ProductSnapshot> = {}): ProductSnapshot {
  const id = overrides.id ?? randomUUID();
  return { id, tenantId, sku: `SKU-${id.slice(0, 6).toUpperCase()}`, name: `Product ${id.slice(0, 4)}`, type: 'GOODS', trackInventory: true, isSerialized: false, requiresImei: false, serialPattern: null, qcRequired: true, unitCode: 'PCS', hsnCode: null, taxRate: 18, status: 'ACTIVE', version: 0, ...overrides };
}

export function warehouse(tenantId: string, overrides: Partial<WarehouseSnapshot> = {}): WarehouseSnapshot {
  const id = overrides.id ?? randomUUID();
  return { id, tenantId, code: `WH${id.slice(0, 4).toUpperCase()}`, name: `Warehouse ${id.slice(0, 4)}`, stateCode: '27', gstin: null, address: {}, isDefault: false, status: 'ACTIVE', version: 0, ...overrides };
}

export async function seedRefs(broker: InMemoryBroker, tenantId: string, products: ProductSnapshot[], warehouses: WarehouseSnapshot[], bins: { id: string; warehouseId: string; code: string }[] = []) {
  for (const p of products) await broker.publish(rk(EVENT_TYPES.MASTER_PRODUCT_CREATED), envelope(tenantId, EVENT_TYPES.MASTER_PRODUCT_CREATED, { type: 'product', id: p.id, version: p.version }, p as unknown as Record<string, unknown>));
  for (const w of warehouses) await broker.publish(rk(EVENT_TYPES.MASTER_WAREHOUSE_CREATED), envelope(tenantId, EVENT_TYPES.MASTER_WAREHOUSE_CREATED, { type: 'warehouse', id: w.id, version: w.version }, w as unknown as Record<string, unknown>));
  for (const b of bins) await broker.publish(rk(EVENT_TYPES.MASTER_BIN_CREATED), envelope(tenantId, EVENT_TYPES.MASTER_BIN_CREATED, { type: 'bin', id: b.id, version: 0 }, { id: b.id, tenantId, warehouseId: b.warehouseId, locationId: randomUUID(), code: b.code, status: 'ACTIVE', version: 0 }));
  await broker.drain();
}

export async function bootRuntime(): Promise<{ rt: InventoryRuntime; broker: InMemoryBroker; adminUrl: string }> {
  const env = loadEnv(inventoryEnvSchema, { dir: path.resolve(here, '..') });
  await truncateAll(env.MIGRATE_DATABASE_URL!);
  const broker = new InMemoryBroker();
  const rt = await createInventoryRuntime(env, { broker, keys: new StaticKeyProvider(testKeys().publicKeyPem) });
  await rt.start();
  return { rt, broker, adminUrl: env.MIGRATE_DATABASE_URL! };
}

export const api = (rt: InventoryRuntime, token: string) => ({
  get: (p: string) => request(rt.app).get(p).set('Authorization', `Bearer ${token}`),
  post: (p: string, body: unknown = {}, headers: Record<string, string> = {}) => request(rt.app).post(p).set('Authorization', `Bearer ${token}`).set(headers).send(body as object),
  put: (p: string, body: unknown = {}) => request(rt.app).put(p).set('Authorization', `Bearer ${token}`).send(body as object),
});

export const internal = (rt: InventoryRuntime, token: string, tenantId: string) => ({
  get: (p: string) => request(rt.app).get(p).set('Authorization', `Bearer ${token}`).set('x-on-behalf-of-tenant', tenantId),
  post: (p: string, body: unknown = {}) => request(rt.app).post(p).set('Authorization', `Bearer ${token}`).set('x-on-behalf-of-tenant', tenantId).send(body as object),
});

export const idem = () => ({ 'Idempotency-Key': randomUUID() });
