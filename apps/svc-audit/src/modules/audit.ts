/**
 * Audit recorder + query API. The consumer stores every `audit.recorded.v1` envelope append-only;
 * queries are tenant-scoped through RLS (tenant tokens) or platform-wide (platform / service tokens).
 */
import { Router } from 'express';
import { z } from 'zod';
import { EVENT_TYPES, auditRecordedPayload, rk } from '@b2b/contracts';
import {
  asyncHandler,
  authenticate,
  decodeCursor,
  encodeCursor,
  getContext,
  parseQuery,
  registerConsumer,
  requirePermission,
  requireTenant,
  setTenantContext,
  uuidv7,
  validateQuery,
  withPlatformTx,
  withTenantTx,
  type ConsumerRuntime,
  type TokenVerifier,
  type TransactionalClient,
} from '@b2b/platform-kit';
import type { PrismaClient, Tx } from '../db.js';

export async function registerAuditConsumer(runtime: ConsumerRuntime): Promise<void> {
  await registerConsumer(runtime, {
    name: 'audit.recorder',
    bindings: [rk(EVENT_TYPES.AUDIT_RECORDED)],
    // Platform context: rows may belong to any tenant or none.
    tenantOf: () => null,
    handle: async (envelope, tx) => {
      const p = auditRecordedPayload.parse(envelope.payload);
      await tx.$executeRaw`
        INSERT INTO "audit_events" ("id", "event_id", "tenant_id", "producer", "actor_type", "actor_id", "actor_name", "action", "entity_type", "entity_id", "entity_version",
                                    "summary", "old_value", "new_value", "reason", "ip", "user_agent", "correlation_id", "occurred_at")
        VALUES (${uuidv7()}::uuid, ${envelope.eventId}::uuid, ${envelope.tenantId}::uuid, ${envelope.producer}, ${envelope.actor.type}, ${envelope.actor.id}::uuid, ${envelope.actor.name ?? p.actorName ?? null},
                ${p.action}, ${p.entityType}, ${p.entityId}::uuid, ${envelope.aggregate.version}, ${p.summary ?? null},
                ${p.oldValue === undefined || p.oldValue === null ? null : JSON.stringify(p.oldValue)}::jsonb,
                ${p.newValue === undefined || p.newValue === null ? null : JSON.stringify(p.newValue)}::jsonb,
                ${p.reason ?? null}, ${p.ip ?? null}, ${p.userAgent ?? null}, ${envelope.correlationId}, ${new Date(envelope.occurredAt)})
        ON CONFLICT ("event_id") DO NOTHING`;
    },
  });
}

const querySchema = z.object({
  tenantId: z.string().uuid().optional(),
  action: z.string().max(60).optional(),
  entityType: z.string().max(60).optional(),
  entityId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  correlationId: z.string().max(128).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
type AuditQuery = z.infer<typeof querySchema>;

async function queryEvents(tx: Tx, q: AuditQuery, tenantFilter: string | null | undefined) {
  const cursor = decodeCursor(q.cursor);
  const where: Record<string, unknown> = {};
  if (tenantFilter !== undefined) where.tenantId = tenantFilter;
  if (q.action) where.action = q.action;
  if (q.entityType) where.entityType = q.entityType;
  if (q.entityId) where.entityId = q.entityId;
  if (q.actorId) where.actorId = q.actorId;
  if (q.correlationId) where.correlationId = q.correlationId;
  if (q.from || q.to) where.occurredAt = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) };
  if (cursor && typeof cursor[0] === 'string' && typeof cursor[1] === 'string') {
    where.OR = [{ occurredAt: { lt: new Date(cursor[0]) } }, { occurredAt: new Date(cursor[0]), id: { lt: cursor[1] } }];
  }
  const rows = await tx.auditEvent.findMany({ where, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: q.limit + 1 });
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return { data: page, nextCursor: rows.length > q.limit && last ? encodeCursor([last.occurredAt.toISOString(), last.id]) : null };
}

export function createAuditRouters(prisma: PrismaClient, kit: TransactionalClient, verifier: TokenVerifier) {
  const tenantRouter = Router();
  tenantRouter.use(authenticate({ verifier, types: ['tenant'] }), requireTenant);
  tenantRouter.get('/', requirePermission('audit.view'), validateQuery(querySchema), asyncHandler(async (req, res) => {
    const ctx = getContext(req);
    const q = parseQuery<typeof querySchema>(res);
    // RLS is the net: the transaction runs with the caller's tenant context, and the filter matches it.
    const result = await withTenantTx(prisma as unknown as typeof kit & { $transaction: PrismaClient['$transaction'] }, ctx.tenantId!, (tx) => queryEvents(tx as unknown as Tx, q, ctx.tenantId!));
    res.json(result);
  }));

  const internalRouter = Router();
  internalRouter.use(authenticate({ verifier, types: ['service', 'platform'], serviceName: 'svc-audit' }));
  internalRouter.get('/audit-events', validateQuery(querySchema), asyncHandler(async (req, res) => {
    const ctx = getContext(req);
    if (ctx.tokenType === 'platform' && !ctx.permissions.has('platform.audit.view')) {
      res.status(403).json({ success: false, message: 'Forbidden', error: { code: 'FORBIDDEN', message: 'platform.audit.view required', correlationId: req.correlationId } });
      return;
    }
    const q = parseQuery<typeof querySchema>(res);
    const result = await withPlatformTx(prisma as unknown as typeof kit & { $transaction: PrismaClient['$transaction'] }, (tx) => queryEvents(tx as unknown as Tx, q, q.tenantId));
    res.json(result);
  }));

  return { tenantRouter, internalRouter };
}

/** Raw-SQL count under a tenant context; used by tests to prove RLS with the runtime role. */
export async function countVisibleAs(prisma: PrismaClient, tenantId: string | null): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await setTenantContext(tx, tenantId);
    const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "audit_events"`;
    return Number(rows[0]?.n ?? 0);
  });
}
