/**
 * Consumers: tenant activation seeds defaults; references from procurement / inventory / sales
 * feed the delete guards (phase-03 3.4).
 */
import { z } from 'zod';
import { EVENT_TYPES, inventoryPostingRecordedPayload, rk, tenantLifecyclePayload } from '@b2b/contracts';
import { registerConsumer, type ConsumerRuntime } from '@b2b/platform-kit';
import type { Tx } from '../db.js';
import type { MasterService } from './master.service.js';

const poCreatedLines = z.object({ lines: z.array(z.object({ itemId: z.string().uuid() })).optional(), shipToWarehouseId: z.string().uuid().optional() });

export async function registerMasterConsumers(runtime: ConsumerRuntime, service: MasterService): Promise<void> {
  await registerConsumer(runtime, {
    name: 'master.tenant-activated',
    bindings: [rk(EVENT_TYPES.TENANT_ACTIVATED)],
    handle: async (envelope, tx) => {
      const p = tenantLifecyclePayload.parse(envelope.payload);
      await service.seedTenant(tx as unknown as Tx, p.tenantId, { stateCode: p.stateCode ?? null, address: (p.registeredAddress as Record<string, unknown> | null) ?? null, correlationId: envelope.correlationId });
    },
  });
  await registerConsumer(runtime, {
    name: 'master.references',
    bindings: [rk(EVENT_TYPES.PO_CREATED), rk(EVENT_TYPES.INVENTORY_POSTING_RECORDED), 'sales.so.created.v1'],
    handle: async (envelope, tx) => {
      if (!envelope.tenantId) return;
      const refs: { entityType: 'PRODUCT' | 'WAREHOUSE'; entityId: string; referencedBy: string }[] = [];
      if (envelope.eventType === EVENT_TYPES.INVENTORY_POSTING_RECORDED) {
        const p = inventoryPostingRecordedPayload.parse(envelope.payload);
        for (const l of p.lines) {
          refs.push({ entityType: 'PRODUCT', entityId: l.itemId, referencedBy: 'svc-inventory' });
          if (l.warehouseId) refs.push({ entityType: 'WAREHOUSE', entityId: l.warehouseId, referencedBy: 'svc-inventory' });
        }
      } else {
        const p = poCreatedLines.parse(envelope.payload);
        const by = envelope.eventType.startsWith('sales.') ? 'svc-sales' : 'svc-procurement';
        for (const l of p.lines ?? []) refs.push({ entityType: 'PRODUCT', entityId: l.itemId, referencedBy: by });
        if (p.shipToWarehouseId) refs.push({ entityType: 'WAREHOUSE', entityId: p.shipToWarehouseId, referencedBy: by });
      }
      await service.recordReferences(tx as unknown as Tx, envelope.tenantId, refs);
    },
  });
}
