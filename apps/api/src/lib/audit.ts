/**
 * Central audit stream (phase-plan/README.md 5.10). Every important write emits an
 * `audit.recorded.v1` event through the outbox in the same transaction; `svc-audit` stores the
 * rows append-only. Legacy per-module activity tables keep working alongside until Phase 5.
 * Never put full bank account numbers, passwords or tokens in `oldValue` / `newValue`.
 */
import type { Prisma } from '@prisma/client';
import type { PrismaTx } from './prisma.js';
import { enqueueEvent, type EventEnvelope } from './outbox.js';

export const AUDIT_EVENT_TYPE = 'audit.recorded';

export interface AuditActor {
  organizationId: string;
  userId: string | null;
  userName?: string | null;
  correlationId: string;
}

export interface AuditEntry {
  /** UPPER_SNAKE action name, e.g. PO_CREATED, GRN_CREATED. */
  action: string;
  /** Aggregate type, e.g. PURCHASE_ORDER, PURCHASE_RECEIVE. */
  entityType: string;
  /** Aggregate id (uuid). */
  entityId: string;
  /** Aggregate version after the write, when the aggregate has one. */
  entityVersion?: number | null;
  summary?: string | null;
  oldValue?: Prisma.InputJsonValue | null;
  newValue?: Prisma.InputJsonValue | null;
  reason?: string | null;
}

export interface AuditPayload extends Record<string, unknown> {
  action: string;
  entityType: string;
  entityId: string;
  summary: string | null;
  oldValue: Prisma.InputJsonValue | null;
  newValue: Prisma.InputJsonValue | null;
  reason: string | null;
  actorName: string | null;
}

export async function recordAuditEvent(tx: PrismaTx, actor: AuditActor, entry: AuditEntry): Promise<EventEnvelope<AuditPayload>> {
  return enqueueEvent<AuditPayload>(tx, {
    eventType: AUDIT_EVENT_TYPE,
    eventVersion: 1,
    tenantId: actor.organizationId,
    correlationId: actor.correlationId,
    actor: { type: 'user', id: actor.userId, name: actor.userName ?? null },
    aggregate: { type: entry.entityType.toLowerCase(), id: entry.entityId, version: entry.entityVersion ?? null },
    payload: {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      summary: entry.summary ?? null,
      oldValue: entry.oldValue ?? null,
      newValue: entry.newValue ?? null,
      reason: entry.reason ?? null,
      actorName: actor.userName ?? null,
    },
  });
}
