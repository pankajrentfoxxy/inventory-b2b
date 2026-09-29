import { Prisma, type PurchaseOrderStatus } from '@prisma/client';
import {
  PURCHASE_ORDER_EDITABLE_STATUSES,
  computePurchaseOrderTotals,
  type PurchaseOrderListQuery,
  type PurchaseOrderPayload,
} from '@b2b/shared';
import { prisma, type PrismaTx } from '../../lib/prisma.js';
import { conflict, validationError } from '../../lib/errors.js';
import type { RequestContext } from '../../middleware/auth.js';
import { allocateDocumentNumber, claimManualDocumentNumber, getSequence } from './documentNumber.service.js';
import { findLivePoOrThrow, resolvePurchaseOrder, type ResolvedLine, type ResolvedPurchaseOrder } from './purchaseOrder.repository.js';
import { recordPoActivity } from './purchaseOrder.audit.js';
import { poDetailInclude, poListInclude, receiveProgress, serializePoDetail, serializePoListItem } from './purchaseOrder.serializer.js';

type Ctx = Pick<RequestContext, 'userId' | 'userName' | 'organizationId'>;

const toDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

/* ---- list ---------------------------------------------------------------- */

const SORT: Record<PurchaseOrderListQuery['sortBy'], (d: 'asc' | 'desc') => Prisma.PurchaseOrderOrderByWithRelationInput> = {
  orderDate: (d) => ({ orderDate: d }),
  purchaseOrderNumber: (d) => ({ purchaseOrderNumber: d }),
  expectedDeliveryDate: (d) => ({ expectedDeliveryDate: { sort: d, nulls: 'last' } }),
  total: (d) => ({ total: d }),
  status: (d) => ({ status: d }),
  createdAt: (d) => ({ createdAt: d }),
  updatedAt: (d) => ({ updatedAt: d }),
};

export async function listPurchaseOrders(organizationId: string, q: PurchaseOrderListQuery) {
  const base: Prisma.PurchaseOrderWhereInput = { organizationId, deletedAt: null };
  if (q.vendorId) base.vendorId = q.vendorId;
  if (q.dateFrom || q.dateTo) {
    base.orderDate = { ...(q.dateFrom ? { gte: toDate(q.dateFrom) } : {}), ...(q.dateTo ? { lte: toDate(q.dateTo) } : {}) };
  }
  if (q.search) {
    base.OR = [
      { purchaseOrderNumber: { contains: q.search, mode: 'insensitive' } },
      { referenceNumber: { contains: q.search, mode: 'insensitive' } },
      { vendor: { displayName: { contains: q.search, mode: 'insensitive' } } },
      { lines: { some: { name: { contains: q.search, mode: 'insensitive' } } } },
    ];
  }
  const where: Prisma.PurchaseOrderWhereInput = { ...base };
  if (q.status === 'OPEN') where.status = { in: ['ISSUED', 'PARTIALLY_RECEIVED'] };
  else if (q.status && q.status !== 'ALL') where.status = q.status;

  const orderBy: Prisma.PurchaseOrderOrderByWithRelationInput[] = [SORT[q.sortBy](q.sortOrder)];
  if (q.sortBy !== 'createdAt') orderBy.push({ createdAt: 'desc' });

  const [total, rows, grouped] = await Promise.all([
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.findMany({
      where,
      orderBy,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      include: { ...poListInclude, lines: { select: { quantity: true, receivedQuantity: true } } },
    }),
    prisma.purchaseOrder.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
  ]);
  const counts: Record<string, number> = { ALL: 0, OPEN: 0, DRAFT: 0, ISSUED: 0, PARTIALLY_RECEIVED: 0, RECEIVED: 0, CLOSED: 0, CANCELLED: 0 };
  for (const g of grouped) {
    counts[g.status] = g._count._all;
    counts.ALL += g._count._all;
    if (g.status === 'ISSUED' || g.status === 'PARTIALLY_RECEIVED') counts.OPEN += g._count._all;
  }
  return { data: rows.map(serializePoListItem), pagination: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) }, counts };
}

export async function getPurchaseOrder(organizationId: string, id: string) {
  return serializePoDetail(await findLivePoOrThrow(prisma, organizationId, id, poDetailInclude));
}

export async function previewNextNumber(organizationId: string) {
  return getSequence(organizationId, 'PURCHASE_ORDER');
}

/* ---- create / update ------------------------------------------------------ */

function headerData(p: PurchaseOrderPayload, r: ResolvedPurchaseOrder, totals: ReturnType<typeof computePurchaseOrderTotals>) {
  return {
    vendorId: p.vendorId,
    locationId: p.locationId,
    deliveryType: p.deliveryType,
    deliveryLocationId: r.delivery.deliveryLocationId,
    deliveryAddress: r.delivery.snapshot as unknown as Prisma.InputJsonValue,
    sourceOfSupplyCode: r.sourceOfSupplyCode,
    placeOfSupplyCode: r.delivery.placeOfSupplyCode,
    isIntraState: r.intraState,
    referenceNumber: p.referenceNumber,
    orderDate: toDate(p.orderDate),
    expectedDeliveryDate: p.expectedDeliveryDate ? toDate(p.expectedDeliveryDate) : null,
    paymentTermId: p.paymentTermId,
    shipmentPreference: p.shipmentPreference,
    currencyCode: r.vendor.currencyCode,
    discountType: p.discountType,
    discountValue: p.discountValue,
    taxDeductionType: p.taxDeductionType,
    taxDeductionRate: p.taxDeductionType === 'NONE' ? 0 : p.taxDeductionRate,
    taxDeductionLabel: p.taxDeductionType === 'NONE' ? null : p.taxDeductionLabel,
    adjustment: p.adjustment,
    adjustmentLabel: p.adjustmentLabel,
    subTotal: totals.subTotal,
    discountAmount: totals.discountAmount,
    taxTotal: totals.taxTotal,
    taxBreakup: totals.taxBreakup as unknown as Prisma.InputJsonValue,
    taxDeductionAmount: totals.taxDeductionAmount,
    total: totals.total,
    notes: p.notes,
    terms: p.terms,
  };
}

function lineData(organizationId: string, l: ResolvedLine, lineNumber: number, t: ReturnType<typeof computePurchaseOrderTotals>['lines'][number]) {
  return {
    organizationId,
    lineNumber,
    itemId: l.itemId,
    name: l.name,
    sku: l.sku,
    description: l.description,
    hsnCode: l.hsnCode,
    quantity: l.quantity,
    unit: l.unit,
    rate: l.rate,
    taxId: l.taxId,
    taxName: l.taxName,
    taxRate: l.taxRate,
    amount: t.amount,
    taxableAmount: t.taxableAmount,
    taxAmount: t.taxAmount,
    total: t.total,
  };
}

function totalsFor(p: PurchaseOrderPayload, r: ResolvedPurchaseOrder) {
  return computePurchaseOrderTotals({
    lines: r.lines.map((l) => ({ quantity: l.quantity, rate: l.rate, taxRate: l.taxRate })),
    discountType: p.discountType,
    discountValue: p.discountValue,
    taxDeductionType: p.taxDeductionType,
    taxDeductionRate: p.taxDeductionRate,
    adjustment: p.adjustment,
    intraState: r.intraState,
  });
}

export async function createPurchaseOrder(ctx: Ctx, p: PurchaseOrderPayload, issue: boolean) {
  const { organizationId } = ctx;
  const resolved = await resolvePurchaseOrder(prisma, organizationId, p);
  const totals = totalsFor(p, resolved);

  const id = await prisma.$transaction(async (tx) => {
    const number = p.purchaseOrderNumber
      ? await claimManualDocumentNumber(tx, organizationId, 'PURCHASE_ORDER', p.purchaseOrderNumber)
      : await allocateDocumentNumber(tx, organizationId, 'PURCHASE_ORDER');
    const now = new Date();
    const created = await tx.purchaseOrder.create({
      data: {
        organizationId,
        purchaseOrderNumber: number,
        status: issue ? 'ISSUED' : 'DRAFT',
        issuedAt: issue ? now : null,
        createdById: ctx.userId,
        updatedById: ctx.userId,
        ...headerData(p, resolved, totals),
        lines: { create: resolved.lines.map((l, i) => lineData(organizationId, l, i + 1, totals.lines[i])) },
        customFields: { create: resolved.customFieldRows },
      },
    });
    await recordPoActivity(tx, ctx, created.id, {
      action: 'PO_CREATED',
      entityType: 'PURCHASE_ORDER',
      entityId: created.id,
      summary: `Purchase order ${number} created for ${resolved.vendor.displayName} (${resolved.lines.length} item${resolved.lines.length === 1 ? '' : 's'}, total ${totals.total.toFixed(2)})`,
      newValue: { status: issue ? 'ISSUED' : 'DRAFT', vendor: resolved.vendor.displayName, total: totals.total, lines: resolved.lines.length },
    });
    if (issue) {
      await recordPoActivity(tx, ctx, created.id, { action: 'PO_ISSUED', entityType: 'PURCHASE_ORDER', entityId: created.id, summary: `Purchase order ${number} issued` });
    }
    return created.id;
  });
  return getPurchaseOrder(organizationId, id);
}

export async function updatePurchaseOrder(ctx: Ctx, id: string, p: PurchaseOrderPayload) {
  const { organizationId } = ctx;
  const existing = await findLivePoOrThrow(prisma, organizationId, id, { lines: true, receives: { where: { status: 'RECEIVED' }, select: { id: true } }, vendor: { select: { displayName: true } } });
  if (!PURCHASE_ORDER_EDITABLE_STATUSES.includes(existing.status)) {
    throw conflict(`A ${existing.status.toLowerCase().replace('_', ' ')} purchase order cannot be edited`, 'PO_NOT_EDITABLE');
  }
  const hasReceives = existing.receives.length > 0;
  if (hasReceives && p.vendorId !== existing.vendorId) {
    throw validationError([{ path: 'vendorId', message: 'The vendor cannot be changed after goods have been received against this order' }]);
  }

  const resolved = await resolvePurchaseOrder(prisma, organizationId, p, { allowInactiveVendor: p.vendorId === existing.vendorId });
  const totals = totalsFor(p, resolved);

  // Received lines must survive the edit with at least the received quantity.
  const known = new Map(existing.lines.map((l) => [l.id, l]));
  const incomingIds = new Set(resolved.lines.filter((l) => l.id).map((l) => l.id as string));
  const problems = resolved.lines.flatMap((l, i) => {
    if (!l.id) return [];
    const old = known.get(l.id);
    if (!old) return [{ path: `lines.${i}.id`, message: 'Unknown line for this purchase order' }];
    if (l.quantity < Number(old.receivedQuantity)) {
      return [{ path: `lines.${i}.quantity`, message: `${Number(old.receivedQuantity)} already received; quantity cannot be lower than that` }];
    }
    return [];
  });
  for (const old of existing.lines) {
    if (!incomingIds.has(old.id) && Number(old.receivedQuantity) > 0) {
      problems.push({ path: 'lines', message: `"${old.name}" has received quantity and cannot be removed` });
    }
  }
  if (problems.length) throw validationError(problems);

  await prisma.$transaction(async (tx) => {
    let number = existing.purchaseOrderNumber;
    if (p.purchaseOrderNumber && p.purchaseOrderNumber.toLowerCase() !== existing.purchaseOrderNumber.toLowerCase()) {
      number = await claimManualDocumentNumber(tx, organizationId, 'PURCHASE_ORDER', p.purchaseOrderNumber, id);
    }
    await tx.purchaseOrder.update({ where: { id }, data: { purchaseOrderNumber: number, updatedById: ctx.userId, ...headerData(p, resolved, totals) } });

    for (const old of existing.lines) if (!incomingIds.has(old.id)) await tx.purchaseOrderLine.delete({ where: { id: old.id } });
    for (const [i, l] of resolved.lines.entries()) {
      const data = lineData(organizationId, l, i + 1, totals.lines[i]);
      if (l.id) await tx.purchaseOrderLine.update({ where: { id: l.id }, data });
      else await tx.purchaseOrderLine.create({ data: { ...data, purchaseOrderId: id } });
    }

    await tx.purchaseOrderCustomFieldValue.deleteMany({ where: { purchaseOrderId: id } });
    if (resolved.customFieldRows.length) {
      await tx.purchaseOrderCustomFieldValue.createMany({ data: resolved.customFieldRows.map((r) => ({ ...r, purchaseOrderId: id })) });
    }

    const changed: string[] = [];
    if (Number(existing.total) !== totals.total) changed.push('total');
    if (existing.vendorId !== p.vendorId) changed.push('vendor');
    if (existing.lines.length !== resolved.lines.length) changed.push('lines');
    if ((existing.referenceNumber ?? null) !== (p.referenceNumber ?? null)) changed.push('reference');
    if (existing.orderDate.toISOString().slice(0, 10) !== p.orderDate) changed.push('order date');
    if ((existing.expectedDeliveryDate?.toISOString().slice(0, 10) ?? null) !== (p.expectedDeliveryDate ?? null)) changed.push('expected delivery');
    await recordPoActivity(tx, ctx, id, {
      action: 'PO_UPDATED',
      entityType: 'PURCHASE_ORDER',
      entityId: id,
      summary: changed.length ? `Updated ${changed.join(', ')}` : 'Purchase order updated',
      oldValue: { total: Number(existing.total), lines: existing.lines.length, vendor: existing.vendor.displayName, number: existing.purchaseOrderNumber },
      newValue: { total: totals.total, lines: resolved.lines.length, vendor: resolved.vendor.displayName, number },
    });

    if (existing.status !== 'DRAFT') await recomputeReceiveStatus(tx, id);
  });
  return getPurchaseOrder(organizationId, id);
}

/* ---- status transitions --------------------------------------------------- */

/** ISSUED -> PARTIALLY_RECEIVED -> RECEIVED based on line quantities. CLOSED / CANCELLED / DRAFT are left alone. */
export async function recomputeReceiveStatus(tx: PrismaTx, purchaseOrderId: string) {
  const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId }, select: { status: true, lines: { select: { quantity: true, receivedQuantity: true } } } });
  if (!['ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(po.status)) return po.status;
  const { state } = receiveProgress(po.lines);
  const next: PurchaseOrderStatus = state === 'FULL' ? 'RECEIVED' : state === 'PARTIAL' ? 'PARTIALLY_RECEIVED' : 'ISSUED';
  if (next !== po.status) await tx.purchaseOrder.update({ where: { id: purchaseOrderId }, data: { status: next } });
  return next;
}

function assertTransition(from: PurchaseOrderStatus, allowed: PurchaseOrderStatus[], verb: string) {
  if (!allowed.includes(from)) {
    throw conflict(`A ${from.toLowerCase().replace('_', ' ')} purchase order cannot be ${verb}`, 'PO_INVALID_TRANSITION');
  }
}

export async function issuePurchaseOrder(ctx: Ctx, id: string) {
  const po = await findLivePoOrThrow(prisma, ctx.organizationId, id, { lines: true });
  assertTransition(po.status, ['DRAFT'], 'issued');
  if (po.lines.length === 0) throw validationError([{ path: 'lines', message: 'Add at least one item before issuing' }]);
  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.update({ where: { id }, data: { status: 'ISSUED', issuedAt: new Date(), updatedById: ctx.userId } });
    await recordPoActivity(tx, ctx, id, { action: 'PO_ISSUED', entityType: 'PURCHASE_ORDER', entityId: id, summary: `Purchase order ${po.purchaseOrderNumber} issued`, oldValue: { status: po.status }, newValue: { status: 'ISSUED' } });
  });
  return getPurchaseOrder(ctx.organizationId, id);
}

export async function cancelPurchaseOrder(ctx: Ctx, id: string, reason: string | null) {
  const po = await findLivePoOrThrow(prisma, ctx.organizationId, id, { receives: { where: { status: 'RECEIVED' }, select: { id: true } } });
  assertTransition(po.status, ['DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED', 'CLOSED'], 'cancelled');
  if (po.receives.length > 0) {
    throw conflict('Goods have already been received against this purchase order. Cancel the receives first, or close the order instead.', 'PO_HAS_RECEIVES');
  }
  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, updatedById: ctx.userId } });
    await recordPoActivity(tx, ctx, id, { action: 'PO_CANCELLED', entityType: 'PURCHASE_ORDER', entityId: id, summary: `Purchase order ${po.purchaseOrderNumber} cancelled${reason ? `: ${reason}` : ''}`, oldValue: { status: po.status }, newValue: { status: 'CANCELLED', reason } });
  });
  return getPurchaseOrder(ctx.organizationId, id);
}

/** Stops further receipts on a partially received / issued order (short-closed). */
export async function closePurchaseOrder(ctx: Ctx, id: string) {
  const po = await findLivePoOrThrow(prisma, ctx.organizationId, id);
  assertTransition(po.status, ['ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED'], 'closed');
  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date(), updatedById: ctx.userId } });
    await recordPoActivity(tx, ctx, id, { action: 'PO_CLOSED', entityType: 'PURCHASE_ORDER', entityId: id, summary: `Purchase order ${po.purchaseOrderNumber} closed`, oldValue: { status: po.status }, newValue: { status: 'CLOSED' } });
  });
  return getPurchaseOrder(ctx.organizationId, id);
}

export async function reopenPurchaseOrder(ctx: Ctx, id: string) {
  const po = await findLivePoOrThrow(prisma, ctx.organizationId, id);
  assertTransition(po.status, ['CLOSED', 'CANCELLED'], 'reopened');
  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.update({ where: { id }, data: { status: po.issuedAt ? 'ISSUED' : 'DRAFT', closedAt: null, cancelledAt: null, cancelReason: null, updatedById: ctx.userId } });
    const next = po.issuedAt ? await recomputeReceiveStatus(tx, id) : 'DRAFT';
    await recordPoActivity(tx, ctx, id, { action: 'PO_REOPENED', entityType: 'PURCHASE_ORDER', entityId: id, summary: `Purchase order ${po.purchaseOrderNumber} reopened`, oldValue: { status: po.status }, newValue: { status: next } });
  });
  return getPurchaseOrder(ctx.organizationId, id);
}

/** Soft delete; only drafts and cancelled orders (nothing downstream references them). */
export async function deletePurchaseOrder(ctx: Ctx, id: string) {
  const po = await findLivePoOrThrow(prisma, ctx.organizationId, id, { receives: { select: { id: true } } });
  if (!['DRAFT', 'CANCELLED'].includes(po.status) || po.receives.length > 0) {
    throw conflict('Only draft or cancelled purchase orders without receives can be deleted. Cancel the order instead.', 'PO_NOT_DELETABLE');
  }
  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.update({ where: { id }, data: { deletedAt: new Date(), updatedById: ctx.userId } });
    await recordPoActivity(tx, ctx, id, { action: 'PO_DELETED', entityType: 'PURCHASE_ORDER', entityId: id, summary: `Purchase order ${po.purchaseOrderNumber} deleted`, oldValue: { status: po.status } });
  });
  return { id, deleted: true };
}

export async function listPurchaseOrderActivity(organizationId: string, id: string, page: number, limit: number) {
  await findLivePoOrThrow(prisma, organizationId, id);
  const where = { purchaseOrderId: id, organizationId };
  const [total, rows] = await Promise.all([
    prisma.purchaseOrderActivity.count({ where }),
    prisma.purchaseOrderActivity.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
  ]);
  return { data: rows, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}
