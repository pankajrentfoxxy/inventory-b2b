/**
 * Event consumers (phase-01 1.7): tenant lifecycle -> status replica, session revocation and the
 * owner invite on activation. Phase 2: membership events -> session revocation.
 */
import { EVENT_TYPES, iamMembershipPayload, rk, tenantLifecyclePayload } from '@b2b/contracts';
import { registerConsumer, type ConsumerRuntime } from '@b2b/platform-kit';
import type { PrismaClient, Tx } from '../db.js';
import type { AuthService } from './auth.service.js';

export async function registerAuthConsumers(runtime: ConsumerRuntime, prisma: PrismaClient, service: AuthService): Promise<void> {
  await registerConsumer(runtime, {
    name: 'auth.tenant-lifecycle',
    bindings: [rk(EVENT_TYPES.TENANT_CREATED), rk(EVENT_TYPES.TENANT_APPROVED), rk(EVENT_TYPES.TENANT_REJECTED), rk(EVENT_TYPES.TENANT_ACTIVATED), rk(EVENT_TYPES.TENANT_SUSPENDED), rk(EVENT_TYPES.TENANT_REACTIVATED), rk(EVENT_TYPES.TENANT_DEACTIVATED), rk(EVENT_TYPES.TENANT_OWNER_INVITE_REQUESTED)],
    tenantOf: () => null,
    handle: async (envelope, sql) => {
      const payload = tenantLifecyclePayload.parse(envelope.payload);
      const tx = sql as unknown as Tx;
      if (envelope.eventType !== EVENT_TYPES.TENANT_OWNER_INVITE_REQUESTED) {
        await service.onTenantStatus(tx, payload.tenantId, payload.status, envelope.aggregate.version ?? 0, payload.reason, envelope.correlationId);
      }
      if (envelope.eventType === EVENT_TYPES.TENANT_ACTIVATED || envelope.eventType === EVENT_TYPES.TENANT_OWNER_INVITE_REQUESTED) {
        await service.createOwnerInvite(tx, { tenantId: payload.tenantId, email: payload.ownerEmail, fullName: payload.ownerName, correlationId: envelope.correlationId, actorId: payload.actorId });
      }
    },
  });

  await registerConsumer(runtime, {
    name: 'auth.membership-lifecycle',
    bindings: [rk(EVENT_TYPES.IAM_MEMBERSHIP_SUSPENDED), rk(EVENT_TYPES.IAM_MEMBERSHIP_REMOVED)],
    tenantOf: () => null,
    handle: async (envelope, sql) => {
      const payload = iamMembershipPayload.parse(envelope.payload);
      await service.tokens.revokeSessions(sql as unknown as Tx, { membershipId: payload.membershipId }, `MEMBERSHIP_${payload.status}`);
    },
  });

  void prisma;
}
