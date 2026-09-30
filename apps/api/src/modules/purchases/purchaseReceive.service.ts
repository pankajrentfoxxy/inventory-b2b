import { Prisma } from '@prisma/client';
import { PURCHASE_ORDER_RECEIVABLE_STATUSES, type PurchaseReceiveListQuery, type PurchaseReceivePayload } from '@b2b/shared';
import { LOCKING_TX_OPTIONS, prisma } from '../../lib/prisma.js';
import { businessRuleError, conflict, notFound, validationError, type ErrorDetail } from '../../lib/errors.js';
import type { RequestContext } from '../../middleware/auth.js';
import { allocateDocumentNumber, claimManualDocumentNumber, getSequence } from './documentNumber.service.js';
import { lockPurchaseOrder, lockPurchaseOrderLines } from './purchaseOrder.repository.js';
import { recordPoActivity } from './purchaseOrder.audit.js';
import { recomputeReceiveStatus } from './purchaseOrder.service.js';
import { day, n0 } from './purchaseOrder.serializer.js';

type Ctx = Pick<RequestContext, 'userId' | 'userName' | 'organizationId' | 'correlationId'>;
const toDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
const q3 = (v: number) => Math.round(v * 1000) / 1000;

const receiveInclude = {
  purchaseOrder: { select: { id: true, purchaseOrderNumber: true, status: true } },
  vendor: { select: { id: true, displayName: true } },
  location: { select: { id: true, name: true } },
  lines: { include: { purchaseOrderLine: { select: { id: true, name: true, sku: true, unit: true, quantity: true, receivedQuantity: true, lineNumber: true } } }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.PurchaseReceiveInclude;
type ReceiveRecord = Prisma.PurchaseReceiveGetPayload<{ include: typeof receiveInclude }>;

export function serializeReceive(r: ReceiveRecord) {
  return {
    id: r.id,
    receiveNumber: r.receiveNumber,
    receivedDate: day(r.receivedDate),
    status: r.status,
    purchaseOrder: r.purchaseOrder,
    vendor: r.vendor,
    location: r.location,
    notes: r.notes,
    totalQuantity: n0(r.totalQuantity),
    lines: r.lines
      .slice()
      .sort((a, b) => a.purchaseOrderLine.lineNumber - b.purchaseOrderLine.lineNumber)
      .map((l) => ({
        id: l.id,
        purchaseOrderLineId: l.purchaseOrderLineId,
        itemId: l.itemId,
        name: l.purchaseOrderLine.name,
        sku: l.purchaseOrderLine.sku,
        unit: l.purchaseOrderLine.unit,
        orderedQuantity: n0(l.purchaseOrderLine.quantity),
        quantity: n0(l.quantity),
        receivedToDate: n0(l.purchaseOrderLine.receivedQuantity),
      })),
    cancelledAt: r.cancelledAt,
    cancelReason: r.cancelReason,
    createdAt: r.createdAt,
    createdByName: r.createdByName,
  };
}

const RECEIVE_NOT_FOUND = () => notFound('Purchase receive not found', 'PURCHASE_RECEIVE_NOT_FOUND');

async function findReceiveOrThrow(organizationId: string, id: string) {
  const r = await prisma.purchaseReceive.findFirst({ where: { id, organizationId }, include: receiveInclude });
  if (!r) throw RECEIVE_NOT_FOUND();
  return r;
}

const SORT: Record<PurchaseReceiveListQuery['sortBy'], (d: 'asc' | 'desc') => Prisma.PurchaseReceiveOrderByWithRelationInput> = {
  receivedDate: (d) => ({ receivedDate: d }),
  receiveNumber: (d) => ({ receiveNumber: d }),
  createdAt: (d) => ({ createdAt: d }),
};

export async function listReceives(organizationId: string, q: PurchaseReceiveListQuery) {
  const base: Prisma.PurchaseReceiveWhereInput = { organizationId };
  if (q.vendorId) base.vendorId = q.vendorId;
  if (q.purchaseOrderId) base.purchaseOrderId = q.purchaseOrderId;
  if (q.search) {
    base.OR = [
      { receiveNumber: { contains: q.search, mode: 'insensitive' } },
      { purchaseOrder: { purchaseOrderNumber: { contains: q.search, mode: 'insensitive' } } },
      { vendor: { displayName: { contains: q.search, mode: 'insensitive' } } },
    ];
  }
  const where: Prisma.PurchaseReceiveWhereInput = { ...base };
  if (q.status && q.status !== 'ALL') where.status = q.status;
  const orderBy: Prisma.PurchaseReceiveOrderByWithRelationInput[] = [SORT[q.sortBy](q.sortOrder)];
  if (q.sortBy !== 'createdAt') orderBy.push({ createdAt: 'desc' });

  const [total, rows, grouped] = await Promise.all([
    prisma.purchaseReceive.count({ where }),
    prisma.purchaseReceive.findMany({ where, orderBy, skip: (q.page - 1) * q.limit, take: q.limit, include: receiveInclude }),
    prisma.purchaseReceive.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
  ]);
  const counts: Record<string, number> = { ALL: 0, RECEIVED: 0, CANCELLED: 0 };
  for (const g of grouped) {
    counts[g.status] = g._count._all;
    counts.ALL += g._count._all;
  }
  return { data: rows.map(serializeReceive), pagination: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) }, counts };
}

export async function getReceive(organizationId: string, id: string) {
  return serializeReceive(await findReceiveOrThrow(organizationId, id));
}

export async function previewNextNumber(organizationId: string) {
  return getSequence(organizationId, 'PURCHASE_RECEIVE');
}

/**
 * Records a goods receipt. Everything runs in ONE transaction under a row lock on the purchase
 * order (Phase 0 R1/R6/R7):
 *
 *   lock PO FOR UPDATE -> assert receivable -> lock lines FOR UPDATE (by id) ->
 *   assert received + qty <= ordered per line -> allocate number -> insert GRN + lines ->
 *   conditional UPDATE of received_quantity -> recompute PO status, version + 1 ->
 *   activity row + audit.recorded outbox event
 *
 * `idempotencyKey` comes from the Idempotency-Key header (R2) and is stored on the GRN, where a
 * unique index per organization is the last guard against duplicates.
 */
export async function createReceive(ctx: Ctx, p: PurchaseReceivePayload, idempotencyKey: string | null) {
  const { organizationId } = ctx;

  const duplicates: ErrorDetail[] = [];
  const seen = new Set<string>();
  for (const l of p.lines) {
    if (seen.has(l.purchaseOrderLineId)) duplicates.push({ path: 'lines', message: 'Each purchase order line may appear only once' });
    seen.add(l.purchaseOrderLineId);
  }
  if (duplicates.length) throw validationError(duplicates);

  const active = p.lines.filter((l) => l.quantity > 0);
  const totalQuantity = q3(active.reduce((s, l) => s + l.quantity, 0));

  const id = await prisma.$transaction(async (tx) => {
    const po = await lockPurchaseOrder(tx, organizationId, p.purchaseOrderId);
    if (!PURCHASE_ORDER_RECEIVABLE_STATUSES.includes(po.status)) {
      throw conflict(`Goods can only be received against issued or partially received orders (this one is ${po.status.toLowerCase().replace('_', ' ')})`, 'PO_NOT_RECEIVABLE');
    }
    const poLines = new Map((await lockPurchaseOrderLines(tx, po.id)).map((l) => [l.id, l]));

    const problems: ErrorDetail[] = [];
    let overReceipt = false;
    p.lines.forEach((l, i) => {
      const line = poLines.get(l.purchaseOrderLineId);
      if (!line) {
        problems.push({ path: `lines.${i}.purchaseOrderLineId`, message: 'Line does not belong to this purchase order' });
        return;
      }
      const remaining = q3(line.quantity - line.receivedQuantity);
      if (l.quantity > remaining + 1e-9) {
        overReceipt = true;
        problems.push({ path: `lines.${i}.quantity`, message: `Only ${remaining}${line.unit ? ` ${line.unit}` : ''} of "${line.name}" remain to be received` });
      }
    });
    if (problems.length) {
      throw overReceipt ? businessRuleError('OVER_RECEIPT', 'Some quantities exceed what remains to be received', problems) : validationError(problems);
    }

    const number = p.receiveNumber
      ? await claimManualDocumentNumber(tx, organizationId, 'PURCHASE_RECEIVE', p.receiveNumber)
      : await allocateDocumentNumber(tx, organizationId, 'PURCHASE_RECEIVE');
    const created = await tx.purchaseReceive.create({
      data: {
        organizationId,
        purchaseOrderId: po.id,
        vendorId: po.vendorId,
        locationId: po.deliveryLocationId ?? po.locationId,
        receiveNumber: number,
        receivedDate: toDate(p.receivedDate),
        notes: p.notes,
        totalQuantity,
        idempotencyKey,
        createdById: ctx.userId,
        createdByName: ctx.userName,
        lines: { create: active.map((l) => ({ organizationId, purchaseOrderLineId: l.purchaseOrderLineId, itemId: poLines.get(l.purchaseOrderLineId)!.itemId, quantity: l.quantity })) },
      },
    });
    for (const l of active) {
      // Conditional update: the CHECK constraint is the final net, this keeps the error a clean 422.
      const updated = await tx.$executeRaw`
        UPDATE "purchase_order_lines"
           SET "received_quantity" = "received_quantity" + ${l.quantity}::numeric, "updated_at" = now()
         WHERE "id" = ${l.purchaseOrderLineId}::uuid
           AND "received_quantity" + ${l.quantity}::numeric <= "quantity"`;
      if (updated !== 1) throw businessRuleError('OVER_RECEIPT', 'Some quantities exceed what remains to be received');
    }
    const { status, version } = await recomputeReceiveStatus(tx, po.id, { bumpVersion: true, updatedById: ctx.userId });
    await recordPoActivity(tx, ctx, po.id, {
      action: 'RECEIVE_CREATED',
      entityType: 'RECEIVE',
      entityId: created.id,
      summary: `Received ${totalQuantity} units on ${number}`,
      newValue: { receiveNumber: number, totalQuantity, status, purchaseOrderVersion: version, lines: active.map((l) => ({ item: poLines.get(l.purchaseOrderLineId)!.name, quantity: l.quantity })) },
    });
    return created.id;
  }, LOCKING_TX_OPTIONS);
  return getReceive(organizationId, id);
}

interface LockedReceive {
  id: string;
  status: 'RECEIVED' | 'CANCELLED';
  purchaseOrderId: string;
  receiveNumber: string;
  totalQuantity: number;
}

/**
 * Cancelling reverses the received quantities and re-derives the PO status. Records are kept.
 * The GRN row is locked and its status re-checked inside the transaction, so two concurrent
 * cancels cannot both reverse the quantities (Phase 0 R7 / audit finding 2).
 */
export async function cancelReceive(ctx: Ctx, id: string, reason: string | null) {
  const { organizationId } = ctx;
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<LockedReceive[]>`
      SELECT "id", "status", "purchase_order_id" AS "purchaseOrderId", "receive_number" AS "receiveNumber", "total_quantity"::float8 AS "totalQuantity"
      FROM "purchase_receives"
      WHERE "id" = ${id}::uuid AND "organization_id" = ${organizationId}::uuid
      FOR UPDATE`;
    const r = rows[0];
    if (!r) throw RECEIVE_NOT_FOUND();
    if (r.status === 'CANCELLED') throw conflict('This purchase receive is already cancelled', 'RECEIVE_ALREADY_CANCELLED');

    await lockPurchaseOrder(tx, organizationId, r.purchaseOrderId);
    const lines = await tx.purchaseReceiveLine.findMany({ where: { purchaseReceiveId: id }, select: { purchaseOrderLineId: true, quantity: true } });

    await tx.purchaseReceive.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason } });
    for (const l of lines) {
      const qty = Number(l.quantity);
      const updated = await tx.$executeRaw`
        UPDATE "purchase_order_lines"
           SET "received_quantity" = "received_quantity" - ${qty}::numeric, "updated_at" = now()
         WHERE "id" = ${l.purchaseOrderLineId}::uuid
           AND "received_quantity" - ${qty}::numeric >= 0`;
      if (updated !== 1) throw conflict('Received quantities are inconsistent; this receive cannot be reversed', 'RECEIVE_REVERSAL_CONFLICT');
    }
    const { status, version } = await recomputeReceiveStatus(tx, r.purchaseOrderId, { bumpVersion: true, updatedById: ctx.userId });
    await recordPoActivity(tx, ctx, r.purchaseOrderId, {
      action: 'RECEIVE_CANCELLED',
      entityType: 'RECEIVE',
      entityId: id,
      summary: `Cancelled ${r.receiveNumber}${reason ? `: ${reason}` : ''}`,
      oldValue: { receiveNumber: r.receiveNumber, totalQuantity: r.totalQuantity },
      newValue: { status, reason, purchaseOrderVersion: version },
    });
  }, LOCKING_TX_OPTIONS);
  return getReceive(organizationId, id);
}
