/**
 * Synchronous dependencies of procurement (phase-05 5.4): snapshots from master and party at
 * document time, and the serial pre-check in inventory. Remote implementations use service tokens;
 * tests plug in fakes or real in-process runtimes.
 */
import type { PartySnapshot, ProductSnapshot, WarehouseSnapshot } from '@b2b/contracts';
import { createServiceClient, type Logger, type ServiceClient, type ServiceTokenSource } from '@b2b/platform-kit';

export interface MasterSource {
  products(tenantId: string, ids: string[], correlationId: string): Promise<ProductSnapshot[]>;
  warehouse(tenantId: string, id: string, correlationId: string): Promise<WarehouseSnapshot | null>;
}
export interface PartySource {
  supplier(tenantId: string, id: string, correlationId: string): Promise<PartySnapshot | null>;
}
export interface SerialCheck {
  duplicates: string[];
  invalidPattern: string[];
  duplicatesInRequest: string[];
}
export interface InventorySource {
  serialsCheck(tenantId: string, itemId: string, serials: string[], correlationId: string): Promise<SerialCheck>;
}
export interface ProcurementSources {
  master: MasterSource;
  party: PartySource;
  inventory: InventorySource;
}

export function createRemoteSources(urls: { master: string; party: string; inventory: string }, tokens: ServiceTokenSource, _logger: Logger): ProcurementSources {
  const master: ServiceClient = createServiceClient({ targetService: 'svc-master', baseUrl: urls.master, tokens });
  const party: ServiceClient = createServiceClient({ targetService: 'svc-party', baseUrl: urls.party, tokens });
  const inventory: ServiceClient = createServiceClient({ targetService: 'svc-inventory', baseUrl: urls.inventory, tokens });
  return {
    master: {
      async products(tenantId, ids, correlationId) {
        if (!ids.length) return [];
        const res = await master.call<{ data: ProductSnapshot[] }>(`/internal/v1/products:batch?ids=${ids.join(',')}`, { correlationId, onBehalfOfTenant: tenantId, retries: 1 });
        return res.data;
      },
      async warehouse(tenantId, id, correlationId) {
        const res = await master.call<{ data: WarehouseSnapshot[] }>(`/internal/v1/warehouses:batch?ids=${id}`, { correlationId, onBehalfOfTenant: tenantId, retries: 1 });
        return res.data[0] ?? null;
      },
    },
    party: {
      async supplier(tenantId, id, correlationId) {
        try {
          const res = await party.call<{ data: PartySnapshot }>(`/internal/v1/parties/${id}/snapshot`, { correlationId, onBehalfOfTenant: tenantId, retries: 1 });
          return res.data;
        } catch (err) {
          if ((err as { status?: number }).status === 404) return null;
          throw err;
        }
      },
    },
    inventory: {
      async serialsCheck(tenantId, itemId, serials, correlationId) {
        const res = await inventory.call<{ data: SerialCheck }>('/internal/v1/serials/check', { method: 'POST', body: { itemId, serials }, correlationId, onBehalfOfTenant: tenantId });
        return res.data;
      },
    },
  };
}

/** For tests and for running without the other services: nothing is known, nothing is duplicated. */
export const emptySources: ProcurementSources = {
  master: { products: async () => [], warehouse: async () => null },
  party: { supplier: async () => null },
  inventory: { serialsCheck: async () => ({ duplicates: [], invalidPattern: [], duplicatesInRequest: [] }) },
};
