import type { Prisma } from '@prisma/client';
import type { PurchaseOrderActivityAction } from '@b2b/shared';
import type { PrismaTx } from '../../lib/prisma.js';
import type { RequestContext } from '../../middleware/auth.js';

type Json = Prisma.InputJsonValue;

export interface PoAuditEntry {
  action: PurchaseOrderActivityAction;
  entityType: 'PURCHASE_ORDER' | 'LINE' | 'RECEIVE' | 'DOCUMENT';
  entityId?: string | null;
  summary: string;
  oldValue?: Json | null;
  newValue?: Json | null;
}

export async function recordPoActivity(
  tx: PrismaTx,
  ctx: Pick<RequestContext, 'userId' | 'userName' | 'organizationId'>,
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
}
