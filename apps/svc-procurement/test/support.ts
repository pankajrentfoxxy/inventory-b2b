/** Fixtures for procurement suites: fake master / party / inventory sources, tokens, request helpers. */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import type { PartySnapshot, ProductSnapshot, WarehouseSnapshot } from '@b2b/contracts';
import { StaticKeyProvider, loadEnv } from '@b2b/platform-kit';
import { InMemoryBroker, testKeys, truncateAll } from '@b2b/test-kit';
import { procurementEnvSchema } from '../src/config.js';
import type { ProcurementSources } from '../src/modules/sources.js';
import { createProcurementRuntime, type ProcurementRuntime } from '../src/service.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export class FakeSources implements ProcurementSources {
  products = new Map<string, ProductSnapshot>();
  warehouses = new Map<string, WarehouseSnapshot>();
  suppliers = new Map<string, PartySnapshot>();
  duplicates = new Set<string>();
  master = {
    products: async (tenantId: string, ids: string[]) => ids.map((id) => this.products.get(id)).filter((p): p is ProductSnapshot => Boolean(p && p.tenantId === tenantId)),
    warehouse: async (tenantId: string, id: string) => {
      const w = this.warehouses.get(id);
      return w && w.tenantId === tenantId ? w : null;
    },
  };
  party = {
    supplier: async (tenantId: string, id: string) => {
      const s = this.suppliers.get(id);
      return s && s.tenantId === tenantId ? s : null;
    },
  };
  inventory = {
    serialsCheck: async (_tenantId: string, _itemId: string, serials: string[]) => ({ duplicates: serials.filter((s) => this.duplicates.has(s.toUpperCase())), invalidPattern: [], duplicatesInRequest: [] }),
  };
}

export function product(tenantId: string, over: Partial<ProductSnapshot> = {}): ProductSnapshot {
  const id = over.id ?? randomUUID();
  return { id, tenantId, sku: `SKU-${id.slice(0, 6).toUpperCase()}`, name: `Product ${id.slice(0, 4)}`, type: 'GOODS', trackInventory: true, isSerialized: false, requiresImei: false, serialPattern: null, qcRequired: true, unitCode: 'PCS', hsnCode: '8471', taxRate: 18, status: 'ACTIVE', version: 0, ...over };
}
export function warehouse(tenantId: string, over: Partial<WarehouseSnapshot> = {}): WarehouseSnapshot {
  const id = over.id ?? randomUUID();
  return { id, tenantId, code: `WH${id.slice(0, 4).toUpperCase()}`, name: 'Warehouse', stateCode: '27', gstin: null, address: {}, isDefault: true, status: 'ACTIVE', version: 0, ...over };
}
export function supplier(tenantId: string, over: Partial<PartySnapshot> = {}): PartySnapshot {
  const id = over.id ?? randomUUID();
  return { id, tenantId, partyType: 'SUPPLIER', code: `SUP${id.slice(0, 4).toUpperCase()}`, legalName: 'Acme Components Pvt Ltd', displayName: 'Acme', gstTreatment: 'REGISTERED', gstin: '27AAPFU0939F1ZV', pan: 'AAPFU0939F', stateCode: '27', billingAddress: { stateCode: '27', city: 'Pune' }, paymentTermId: null, status: 'ACTIVE', blockedReason: null, version: 0, ...over };
}

export async function bootRuntime(sources: ProcurementSources): Promise<{ rt: ProcurementRuntime; broker: InMemoryBroker }> {
  const env = loadEnv(procurementEnvSchema, { dir: path.resolve(here, '..') });
  await truncateAll(env.MIGRATE_DATABASE_URL!);
  const broker = new InMemoryBroker();
  const rt = await createProcurementRuntime(env, { broker, keys: new StaticKeyProvider(testKeys().publicKeyPem), sources });
  await rt.start();
  return { rt, broker };
}

export const api = (rt: ProcurementRuntime, token: string) => ({
  get: (p: string) => request(rt.app).get(p).set('Authorization', `Bearer ${token}`),
  post: (p: string, body: unknown = {}, headers: Record<string, string> = {}) => request(rt.app).post(p).set('Authorization', `Bearer ${token}`).set(headers).send(body as object),
  patch: (p: string, body: unknown, version?: number) => {
    const r = request(rt.app).patch(p).set('Authorization', `Bearer ${token}`);
    return (version !== undefined ? r.set('If-Match', String(version)) : r).send(body as object);
  },
  put: (p: string, body: unknown = {}) => request(rt.app).put(p).set('Authorization', `Bearer ${token}`).send(body as object),
});
export const idem = () => ({ 'Idempotency-Key': randomUUID() });
