import { Prisma, type PurchaseOrderStatus } from '@prisma/client';
import {
  PURCHASE_ORDER_EDITABLE_STATUSES,
  computePurchaseOrderTotals,
  type PurchaseOrderActivityAction,
  type PurchaseOrderListQuery,
  type PurchaseOrderPayload,
} from '@b2b/shared';
import { LOCKING_TX_OPTIONS, prisma, type PrismaTx } from '../../lib/prisma.js';
import { conflict, validationError, type ErrorDetail } from '../../lib/errors.js';
import type { RequestContext } from '../../middleware/auth.js';
import { allocateDocumentNumber, claimManualDocumentNumber, getSequence } from './documentNumber.service.js';
import {
  findLivePoOrThrow,
  lockPurchaseOrder,
  lockPurchaseOrderLines,
  resolvePurchaseOrder,
  type LockedPurchaseOrder,
  type ResolvedLine,
  type ResolvedPurchaseOrder,
} from './purchaseOrder.repository.js';
import { recordPoActivity } from './purchaseOrder.audit.js';
import { poDetailInclude, poListInclude, receiveProgress, serializePoDetail, serializePoListItem } from './purchaseOrder.serializer.js';

type Ctx = Pick<RequestContext, 'userId' | 'userName' | 'organizationId' | 'correlationId'>;

const toDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
const label = (s: PurchaseOrderStatus) => s.toLowerCase().replace('_', ' ');

/** Raised when the row changed between the client's read and this write (Phase 0, R4). */
const versionConflict = () =>
  conflict('This purchase order was changed by someone else. Reload it and apply your changes again.', 'PO_VERSION_CONFLICT');

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
        version: 0,
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
      version: 0,
    });
    if (issue) {
      await recordPoActivity(tx, ctx, created.id, { action: 'PO_ISSUED', entityType: 'PURCHASE_ORDER', entityId: created.id, summary: `Purchase order ${number} issued`, version: 0 });
    }
    return created.id;
  }, LOCKING_TX_OPTIONS);
  return getPurchaseOrder(organizationId, id);
}

/**
 * Edits run entirely under the purchase order row lock (Phase 0 R4/R5): status, version and the
 * received quantities are re-read inside the lock, so a GRN committed a millisecond earlier is
 * always seen. Lines that have received quantity keep their item and never drop below the
 * received quantity; the vendor is frozen once anything was received.
 */
export async function updatePurchaseOrder(ctx: Ctx, id: string, p: PurchaseOrderPayload) {
  const { organizationId } = ctx;
  await prisma.$transaction(async (tx) => {
    const locked = await lockPurchaseOrder(tx, organizationId, id);
    if (!PURCHASE_ORDER_EDITABLE_STATUSES.includes(locked.status)) {
      throw conflict(`A ${label(locked.status)} purchase order cannot be edited`, 'PO_NOT_EDITABLE');
    }
    if (p.version != null && p.version !== locked.version) throw versionConflict();

    const existing = await findLivePoOrThrow(tx, organizationId, id, { vendor: { select: { displayName: true } } });
    const lines = await lockPurchaseOrderLines(tx, id);
    const liveReceives = await tx.purchaseReceive.count({ where: { purchaseOrderId: id, status: 'RECEIVED' } });
    const hasReceives = liveReceives > 0 || lines.some((l) => l.receivedQuantity > 0);
    if (hasReceives && p.vendorId !== existing.vendorId) {
      throw validationError([{ path: 'vendorId', message: 'The vendor cannot be changed after goods have been received against this order' }]);
    }

    const resolved = await resolvePurchaseOrder(tx, organizationId, p, { allowInactiveVendor: p.vendorId === existing.vendorId });
    const totals = totalsFor(p, resolved);

    const known = new Map(lines.map((l) => [l.id, l]));
    const incomingIds = new Set(resolved.lines.filter((l) => l.id).map((l) => l.id as string));
    const problems: ErrorDetail[] = [];
    resolved.lines.forEach((l, i) => {
      if (!l.id) return;
      const old = known.get(l.id);
      if (!old) {
        problems.push({ path: `lines.${i}.id`, message: 'Unknown line for this purchase order' });
        return;
      }
      if (old.receivedQuantity <= 0) return;
      if (l.itemId !== old.itemId) problems.push({ path: `lines.${i}.itemId`, message: `"${old.name}" has received quantity; the item cannot be changed` });
      if (l.quantity < old.receivedQuantity) {
        problems.push({ path: `lines.${i}.quantity`, message: `${old.receivedQuantity} already received; quantity cannot be lower than that` });
      }
    });
    for (const old of lines) {
      if (!incomingIds.has(old.id) && old.receivedQuantity > 0) {
        problems.push({ path: 'lines', message: `"${old.name}" has received quantity and cannot be removed` });
      }
    }
    if (problems.length) throw validationError(problems);

    let number = existing.purchaseOrderNumber;
    if (p.purchaseOrderNumber && p.purchaseOrderNumber.toLowerCase() !== existing.purchaseOrderNumber.toLowerCase()) {
      number = await claimManualDocumentNumber(tx, organizationId, 'PURCHASE_ORDER', p.purchaseOrderNumber, id);
    }
    const updated = await tx.purchaseOrder.updateMany({
      where: { id, organizationId, version: locked.version },
      data: { purchaseOrderNumber: number, updatedById: ctx.userId, version: locked.version + 1, ...headerData(p, resolved, totals) },
    });
    if (updated.count !== 1) throw versionConflict();

    for (const old of lines) if (!incomingIds.has(old.id)) await tx.purchaseOrderLine.delete({ where: { id: old.id } });
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
    if (lines.length !== resolved.lines.length) changed.push('lines');
    if ((existing.referenceNumber ?? null) !== (p.referenceNumber ?? null)) changed.push('reference');
    if (existing.orderDate.toISOString().slice(0, 10) !== p.orderDate) changed.push('order date');
    if ((existing.expectedDeliveryDate?.toISOString().slice(0, 10) ?? null) !== (p.expectedDeliveryDate ?? null)) changed.push('expected delivery');
    await recordPoActivity(tx, ctx, id, {
      action: 'PO_UPDATED',
      entityType: 'PURCHASE_ORDER',
      entityId: id,
      summary: changed.length ? `Updated ${changed.join(', ')}` : 'Purchase order updated',
      oldValue: { total: Number(existing.total), lines: lines.length, vendor: existing.vendor.displayName, number: existing.purchaseOrderNumber, version: locked.version },
      newValue: { total: totals.total, lines: resolved.lines.length, vendor: resolved.vendor.displayName, number, version: locked.version + 1 },
      version: locked.version + 1,
    });

    if (existing.status !== 'DRAFT') await recomputeReceiveStatus(tx, id);
  }, LOCKING_TX_OPTIONS);
  return getPurchaseOrder(organizationId, id);
}

/* ---- status transitions --------------------------------------------------- */

/**
 * ISSUED -> PARTIALLY_RECEIVED -> RECEIVED based on line quantities. CLOSED / CANCELLED / DRAFT are
 * left alone. Must run inside the transaction that changed the quantities, after the PO row lock
 * (Phase 0 R7). `bumpVersion` marks the order as written by this transaction.
 */
export async function recomputeReceiveStatus(
  tx: PrismaTx,
  purchaseOrderId: string,
  opts: { bumpVersion?: boolean; updatedById?: string | null } = {},
): Promise<{ status: PurchaseOrderStatus; version: number }> {
  const po = await tx.purchaseOrder.findUniqueOrThrow({
    where: { id: purchaseOrderId },
    select: { status: true, version: true, lines: { select: { quantity: true, receivedQuantity: true } } },
  });
  let next: PurchaseOrderStatus = po.status;
  if (['ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(po.status)) {
    const { state } = receiveProgress(po.lines);
    next = state === 'FULL' ? 'RECEIVED' : state === 'PARTIAL' ? 'PARTIALLY_RECEIVED' : 'ISSUED';
  }
  const data: Prisma.PurchaseOrderUpdateInput = {};
  if (next !== po.status) data.status = next;
  if (opts.bumpVersion) {
    data.version = { increment: 1 };
    if (opts.updatedById !== undefined) data.updatedById = opts.updatedById;
  }
  if (Object.keys(data).length) await tx.purchaseOrder.update({ where: { id: purchaseOrderId }, data });
  return { status: next, version: po.version + (opts.bumpVersion ? 1 : 0) };
}

function assertTransition(from: PurchaseOrderStatus, allowed: PurchaseOrderStatus[], verb: string) {
  if (!allowed.includes(from)) {
    throw conflict(`A ${label(from)} purchase order cannot be ${verb}`, 'PO_INVALID_TRANSITION');
  }
}

interface TransitionSpec {
  allowed: PurchaseOrderStatus[];
  verb: string;
  action: PurchaseOrderActivityAction;
  /** Extra checks that run inside the row lock (e.g. "no live receives"). */
  guard?: (tx: PrismaTx, po: LockedPurchaseOrder) => Promise<void>;
  data: (po: LockedPurchaseOrder) => Prisma.PurchaseOrderUpdateManyMutationInput & { status: PurchaseOrderStatus };
  /** When the final status depends on line quantities (reopen), compute it after the update. */
  finalStatus?: (tx: PrismaTx, po: LockedPurchaseOrder) => Promise<PurchaseOrderStatus>;
  summary: (po: LockedPurchaseOrder) => string;
  reason?: string | null;
}

/**
 * Every transition: lock the row -> check the transition table -> run guards -> conditional
 * UPDATE on (status, version) -> activity + audit event, all in one transaction (README 5.7).
 * Zero rows updated means a concurrent writer got there first: 409.
 */
async function transitionPurchaseOrder(ctx: Ctx, id: string, spec: TransitionSpec) {
  await prisma.$transaction(async (tx) => {
    const po = await lockPurchaseOrder(tx, ctx.organizationId, id);
    assertTransition(po.status, spec.allowed, spec.verb);
    if (spec.guard) await spec.guard(tx, po);
    const data = spec.data(po);
    const result = await tx.purchaseOrder.updateMany({
      where: { id, organizationId: ctx.organizationId, status: po.status, version: po.version },
      data: { ...data, version: po.version + 1, updatedById: ctx.userId },
    });
    if (result.count !== 1) throw versionConflict();
    const next = spec.finalStatus ? await spec.finalStatus(tx, po) : data.status;
    await recordPoActivity(tx, ctx, id, {
      action: spec.action,
      entityType: 'PURCHASE_ORDER',
      entityId: id,
      summary: spec.summary(po),
      oldValue: { status: po.status },
      newValue: spec.reason === undefined ? { status: next } : { status: next, reason: spec.reason },
      version: po.version + 1,
    });
  }, LOCKING_TX_OPTIONS);
  return getPurchaseOrder(ctx.organizationId, id);
}

export async function issuePurchaseOrder(ctx: Ctx, id: string) {
  return transitionPurchaseOrder(ctx, id, {
    allowed: ['DRAFT'],
    verb: 'issued',
    action: 'PO_ISSUED',
    guard: async (tx, po) => {
      const lines = await tx.purchaseOrderLine.count({ where: { purchaseOrderId: po.id } });
      if (lines === 0) throw validationError([{ path: 'lines', message: 'Add at least one item before issuing' }]);
    },
    data: () => ({ status: 'ISSUED', issuedAt: new Date() }),
    summary: (po) => `Purchase order ${po.purchaseOrderNumber} issued`,
  });
}

export async function cancelPurchaseOrder(ctx: Ctx, id: string, reason: string | null) {
  return transitionPurchaseOrder(ctx, id, {
    allowed: ['DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED', 'CLOSED'],
    verb: 'cancelled',
    action: 'PO_CANCELLED',
    guard: async (tx, po) => {
      // Inside the lock: a GRN committed a moment ago is visible here (Phase 0 R6).
      const receives = await tx.purchaseReceive.count({ where: { purchaseOrderId: po.id, status: 'RECEIVED' } });
      if (receives > 0) {
        throw conflict('Goods have already been received against this purchase order. Cancel the receives first, or close the order instead.', 'PO_HAS_RECEIVES');
      }
    },
    data: () => ({ status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason }),
    summary: (po) => `Purchase order ${po.purchaseOrderNumber} cancelled${reason ? `: ${reason}` : ''}`,
    reason,
  });
}

/** Stops further receipts on a partially received / issued order (short-closed). */
export async function closePurchaseOrder(ctx: Ctx, id: string) {
  return transitionPurchaseOrder(ctx, id, {
    allowed: ['ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED'],
    verb: 'closed',
    action: 'PO_CLOSED',
    data: () => ({ status: 'CLOSED', closedAt: new Date() }),
    summary: (po) => `Purchase order ${po.purchaseOrderNumber} closed`,
  });
}

export async function reopenPurchaseOrder(ctx: Ctx, id: string) {
  return transitionPurchaseOrder(ctx, id, {
    allowed: ['CLOSED', 'CANCELLED'],
    verb: 'reopened',
    action: 'PO_REOPENED',
    data: (po) => ({ status: po.issuedAt ? 'ISSUED' : 'DRAFT', closedAt: null, cancelledAt: null, cancelReason: null }),
    finalStatus: async (tx, po) => (po.issuedAt ? (await recomputeReceiveStatus(tx, po.id)).status : 'DRAFT'),
    summary: (po) => `Purchase order ${po.purchaseOrderNumber} reopened`,
  });
}

/** Soft delete; only drafts and cancelled orders (nothing downstream references them). */
export async function deletePurchaseOrder(ctx: Ctx, id: string) {
  await prisma.$transaction(async (tx) => {
    const po = await lockPurchaseOrder(tx, ctx.organizationId, id);
    const receives = await tx.purchaseReceive.count({ where: { purchaseOrderId: id } });
    if (!['DRAFT', 'CANCELLED'].includes(po.status) || receives > 0) {
      throw conflict('Only draft or cancelled purchase orders without receives can be deleted. Cancel the order instead.', 'PO_NOT_DELETABLE');
    }
    const result = await tx.purchaseOrder.updateMany({
      where: { id, organizationId: ctx.organizationId, version: po.version },
      data: { deletedAt: new Date(), updatedById: ctx.userId, version: po.version + 1 },
    });
    if (result.count !== 1) throw versionConflict();
    await recordPoActivity(tx, ctx, id, {
      action: 'PO_DELETED',
      entityType: 'PURCHASE_ORDER',
      entityId: id,
      summary: `Purchase order ${po.purchaseOrderNumber} deleted`,
      oldValue: { status: po.status },
      version: po.version + 1,
    });
  }, LOCKING_TX_OPTIONS);
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
