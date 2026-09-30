/**
 * Consumers (phase-02 2.7): tenant activation seeds the system roles; the owner identity created
 * by svc-auth (auth.owner.invited) becomes the OWNER membership.
 */
import { z } from 'zod';
import { EVENT_TYPES, rk, tenantLifecyclePayload } from '@b2b/contracts';
import { registerConsumer, type ConsumerRuntime } from '@b2b/platform-kit';
import type { Tx } from '../db.js';
import type { IamService } from './iam.service.js';

const ownerInvitedPayload = z.object({ userId: z.string().uuid(), tenantId: z.string().uuid(), email: z.string(), fullName: z.string() });

export async function registerIamConsumers(runtime: ConsumerRuntime, service: IamService): Promise<void> {
  await registerConsumer(runtime, {
    name: 'iam.tenant-activated',
    bindings: [rk(EVENT_TYPES.TENANT_ACTIVATED)],
    // Platform context: the tenant has no members yet.
    tenantOf: () => null,
    handle: async (envelope, tx) => {
      const p = tenantLifecyclePayload.parse(envelope.payload);
      await service.seedTenantRoles(tx as unknown as Tx, p.tenantId);
    },
  });
  await registerConsumer(runtime, {
    name: 'iam.owner-invited',
    bindings: [rk(EVENT_TYPES.AUTH_OWNER_INVITED)],
    tenantOf: () => null,
    handle: async (envelope, tx) => {
      const p = ownerInvitedPayload.parse(envelope.payload);
      await service.ensureOwnerMembership(tx as unknown as Tx, { tenantId: p.tenantId, userId: p.userId, email: p.email, fullName: p.fullName, correlationId: envelope.correlationId });
    },
  });
}
