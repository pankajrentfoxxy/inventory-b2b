import { Prisma } from '@prisma/client';
import { PURCHASE_ORDER_RECEIVABLE_STATUSES, type PurchaseReceiveListQuery, type PurchaseReceivePayload } from '@b2b/shared';
import { prisma } from '../../lib/prisma.js';
import { conflict, notFound, validationError } from '../../lib/errors.js';
import type { RequestContext } from '../../middleware/auth.js';
import { allocateDocumentNumber, claimManualDocumentNumber, getSequence } from './documentNumber.service.js';
import { findLivePoOrThrow } from './purchaseOrder.repository.js';
import { recordPoActivity } from './purchaseOrder.audit.js';
import { recomputeReceiveStatus } from './purchaseOrder.service.js';
import { day, n0 } from './purchaseOrder.serializer.js';

type Ctx = Pick<RequestContext, 'userId' | 'userName' | 'organizationId'>;
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

async function findReceiveOrThrow(organizationId: string, id: string) {
  const r = await prisma.purchaseReceive.findFirst({ where: { id, organizationId }, include: receiveInclude });
  if (!r) throw notFound('Purchase receive not found', 'PURCHASE_RECEIVE_NOT_FOUND');
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

export async function createReceive(ctx: Ctx, p: PurchaseReceivePayload) {
  const { organizationId } = ctx;
  const po = await findLivePoOrThrow(prisma, organizationId, p.purchaseOrderId, { lines: true });
  if (!PURCHASE_ORDER_RECEIVABLE_STATUSES.includes(po.status)) {
    throw conflict(`Goods can only be received against issued or partially received orders (this one is ${po.status.toLowerCase().replace('_', ' ')})`, 'PO_NOT_RECEIVABLE');
  }
  const poLines = new Map(po.lines.map((l) => [l.id, l]));
  const problems = p.lines.flatMap((l, i) => {
    const line = poLines.get(l.purchaseOrderLineId);
    if (!line) return [{ path: `lines.${i}.purchaseOrderLineId`, message: 'Line does not belong to this purchase order' }];
    const remaining = q3(n0(line.quantity) - n0(line.receivedQuantity));
    if (l.quantity > remaining + 1e-9) return [{ path: `lines.${i}.quantity`, message: `Only ${remaining} ${line.unit ?? ''} of "${line.name}" remain to be received`.replace(/\s+/g, ' ') }];
    return [];
  });
  const seen = new Set<string>();
  for (const l of p.lines) {
    if (seen.has(l.purchaseOrderLineId)) problems.push({ path: 'lines', message: 'Each purchase order line may appear only once' });
    seen.add(l.purchaseOrderLineId);
  }
  if (problems.length) throw validationError(problems);

  const active = p.lines.filter((l) => l.quantity > 0);
  const totalQuantity = q3(active.reduce((s, l) => s + l.quantity, 0));

  const id = await prisma.$transaction(async (tx) => {
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
        createdById: ctx.userId,
        createdByName: ctx.userName,
        lines: { create: active.map((l) => ({ organizationId, purchaseOrderLineId: l.purchaseOrderLineId, itemId: poLines.get(l.purchaseOrderLineId)!.itemId, quantity: l.quantity })) },
      },
    });
    for (const l of active) {
      await tx.purchaseOrderLine.update({ where: { id: l.purchaseOrderLineId }, data: { receivedQuantity: { increment: l.quantity } } });
    }
    const status = await recomputeReceiveStatus(tx, po.id);
    await recordPoActivity(tx, ctx, po.id, {
      action: 'RECEIVE_CREATED',
      entityType: 'RECEIVE',
      entityId: created.id,
      summary: `Received ${totalQuantity} units on ${number}`,
      newValue: { receiveNumber: number, totalQuantity, status, lines: active.map((l) => ({ item: poLines.get(l.purchaseOrderLineId)!.name, quantity: l.quantity })) },
    });
    return created.id;
  });
  return getReceive(organizationId, id);
}

/** Cancelling reverses the received quantities and re-derives the PO status. Records are kept. */
export async function cancelReceive(ctx: Ctx, id: string, reason: string | null) {
  const r = await findReceiveOrThrow(ctx.organizationId, id);
  if (r.status === 'CANCELLED') throw conflict('This purchase receive is already cancelled', 'RECEIVE_ALREADY_CANCELLED');
  await prisma.$transaction(async (tx) => {
    await tx.purchaseReceive.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason } });
    for (const l of r.lines) {
      await tx.purchaseOrderLine.update({ where: { id: l.purchaseOrderLineId }, data: { receivedQuantity: { decrement: l.quantity } } });
    }
    const status = await recomputeReceiveStatus(tx, r.purchaseOrderId);
    await recordPoActivity(tx, ctx, r.purchaseOrderId, {
      action: 'RECEIVE_CANCELLED',
      entityType: 'RECEIVE',
      entityId: id,
      summary: `Cancelled ${r.receiveNumber}${reason ? `: ${reason}` : ''}`,
      oldValue: { receiveNumber: r.receiveNumber, totalQuantity: n0(r.totalQuantity) },
      newValue: { status, reason },
    });
  });
  return getReceive(ctx.organizationId, id);
}
