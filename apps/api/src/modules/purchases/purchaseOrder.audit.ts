import type { Prisma } from '@prisma/client';
import type { PurchaseOrderActivityAction } from '@b2b/shared';
import type { PrismaTx } from '../../lib/prisma.js';
import type { RequestContext } from '../../middleware/auth.js';
import { recordAuditEvent } from '../../lib/audit.js';

type Json = Prisma.InputJsonValue;

export interface PoAuditEntry {
  action: PurchaseOrderActivityAction;
  entityType: 'PURCHASE_ORDER' | 'LINE' | 'RECEIVE' | 'DOCUMENT';
  entityId?: string | null;
  summary: string;
  oldValue?: Json | null;
  newValue?: Json | null;
  /** Purchase order version after the write (only meaningful for PURCHASE_ORDER entries). */
  version?: number | null;
}

/** Legacy entity names -> central audit aggregate names (phase-plan/README.md 5.10). */
const AUDIT_ENTITY: Record<PoAuditEntry['entityType'], string> = {
  PURCHASE_ORDER: 'PURCHASE_ORDER',
  LINE: 'PURCHASE_ORDER_LINE',
  RECEIVE: 'PURCHASE_RECEIVE',
  DOCUMENT: 'PURCHASE_ORDER_DOCUMENT',
};

/** Legacy action names -> the business names in the audit catalogue. */
const AUDIT_ACTION: Partial<Record<PurchaseOrderActivityAction, string>> = {
  RECEIVE_CREATED: 'GRN_CREATED',
  RECEIVE_CANCELLED: 'GRN_CANCELLED',
};

/**
 * Writes the per-order activity row (shown in the UI timeline) and, in the same transaction,
 * emits `audit.recorded.v1` through the outbox for the central audit service.
 */
export async function recordPoActivity(
  tx: PrismaTx,
  ctx: Pick<RequestContext, 'userId' | 'userName' | 'organizationId' | 'correlationId'>,
  purchaseOrderId: string,
  entry: PoAuditEntry,
) {
  await tx.purchaseOrderActivity.create({
    data: {
      purchaseOrderId,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      summary: entry.summary.slice(0, 500),
      oldValue: entry.oldValue ?? undefined,
      newValue: entry.newValue ?? undefined,
    },
  });
  await recordAuditEvent(
    tx,
    { organizationId: ctx.organizationId, userId: ctx.userId, userName: ctx.userName, correlationId: ctx.correlationId },
    {
      action: AUDIT_ACTION[entry.action] ?? entry.action,
      entityType: AUDIT_ENTITY[entry.entityType],
      entityId: entry.entityId ?? purchaseOrderId,
      entityVersion: entry.entityType === 'PURCHASE_ORDER' ? (entry.version ?? null) : null,
      summary: entry.summary.slice(0, 500),
      oldValue: entry.oldValue ?? null,
      newValue: entry.newValue ?? null,
    },
  );
}
