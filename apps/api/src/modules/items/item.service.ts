import { Prisma } from '@prisma/client';
import type { ItemListQuery, ItemPayload } from '@b2b/shared';
import { prisma } from '../../lib/prisma.js';
import { conflict, notFound, validationError, type ErrorDetail } from '../../lib/errors.js';
import type { RequestContext } from '../../middleware/auth.js';

type Ctx = Pick<RequestContext, 'userId' | 'userName' | 'organizationId'>;

export const itemInclude = {
  tax: { select: { id: true, name: true, rate: true } },
  preferredVendor: { select: { id: true, displayName: true } },
} satisfies Prisma.ItemInclude;
type ItemRecord = Prisma.ItemGetPayload<{ include: typeof itemInclude }>;

const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

export function serializeItem(i: ItemRecord) {
  return {
    id: i.id,
    name: i.name,
    sku: i.sku,
    type: i.type,
    unit: i.unit,
    description: i.description,
    hsnCode: i.hsnCode,
    purchaseRate: num(i.purchaseRate),
    sellingRate: num(i.sellingRate),
    taxId: i.taxId,
    tax: i.tax ? { id: i.tax.id, name: i.tax.name, rate: Number(i.tax.rate) } : null,
    preferredVendorId: i.preferredVendorId,
    preferredVendor: i.preferredVendor,
    trackInventory: i.trackInventory,
    reorderLevel: num(i.reorderLevel),
    isActive: i.isActive,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
}
export type ItemDto = ReturnType<typeof serializeItem>;

export async function findLiveItemOrThrow(organizationId: string, itemId: string) {
  const item = await prisma.item.findFirst({ where: { id: itemId, organizationId, deletedAt: null }, include: itemInclude });
  if (!item) throw notFound('Item not found', 'ITEM_NOT_FOUND');
  return item;
}

async function validateItemMasters(organizationId: string, p: ItemPayload, excludeId?: string) {
  const details: ErrorDetail[] = [];
  const [tax, vendor, skuClash] = await Promise.all([
    p.taxId ? prisma.tax.findFirst({ where: { id: p.taxId, organizationId, isActive: true } }) : Promise.resolve(null),
    p.preferredVendorId ? prisma.vendor.findFirst({ where: { id: p.preferredVendorId, organizationId, deletedAt: null } }) : Promise.resolve(null),
    p.sku
      ? prisma.item.findFirst({ where: { organizationId, deletedAt: null, sku: { equals: p.sku, mode: 'insensitive' }, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true, name: true } })
      : Promise.resolve(null),
  ]);
  if (p.taxId && !tax) details.push({ path: 'taxId', message: 'Select a valid tax' });
  if (p.preferredVendorId && !vendor) details.push({ path: 'preferredVendorId', message: 'Select a valid vendor' });
  if (details.length) throw validationError(details);
  if (skuClash) {
    throw conflict(`SKU ${p.sku} is already used by "${skuClash.name}"`, 'DUPLICATE_SKU', [{ path: 'sku', message: 'This SKU is already used by another item' }]);
  }
}

const SORT: Record<ItemListQuery['sortBy'], (d: 'asc' | 'desc') => Prisma.ItemOrderByWithRelationInput> = {
  name: (d) => ({ name: d }),
  sku: (d) => ({ sku: { sort: d, nulls: 'last' } }),
  purchaseRate: (d) => ({ purchaseRate: { sort: d, nulls: 'last' } }),
  createdAt: (d) => ({ createdAt: d }),
  updatedAt: (d) => ({ updatedAt: d }),
};

export async function listItems(organizationId: string, q: ItemListQuery) {
  const base: Prisma.ItemWhereInput = { organizationId, deletedAt: null };
  if (q.type) base.type = q.type;
  if (q.search) {
    base.OR = [
      { name: { contains: q.search, mode: 'insensitive' } },
      { sku: { contains: q.search, mode: 'insensitive' } },
      { hsnCode: { contains: q.search } },
      { description: { contains: q.search, mode: 'insensitive' } },
    ];
  }
  const where: Prisma.ItemWhereInput = { ...base };
  if (q.status === 'ACTIVE') where.isActive = true;
  else if (q.status === 'INACTIVE') where.isActive = false;

  const [total, rows, grouped] = await Promise.all([
    prisma.item.count({ where }),
    prisma.item.findMany({ where, orderBy: [SORT[q.sortBy](q.sortOrder), { name: 'asc' }], skip: (q.page - 1) * q.limit, take: q.limit, include: itemInclude }),
    prisma.item.groupBy({ by: ['isActive'], where: base, _count: { _all: true } }),
  ]);
  const counts = { ALL: 0, ACTIVE: 0, INACTIVE: 0 };
  for (const g of grouped) {
    counts[g.isActive ? 'ACTIVE' : 'INACTIVE'] = g._count._all;
    counts.ALL += g._count._all;
  }
  return { data: rows.map(serializeItem), pagination: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) }, counts };
}

export async function getItem(organizationId: string, itemId: string) {
  return serializeItem(await findLiveItemOrThrow(organizationId, itemId));
}

function scalarData(p: ItemPayload) {
  return {
    name: p.name,
    sku: p.sku,
    type: p.type,
    unit: p.unit,
    description: p.description,
    hsnCode: p.hsnCode,
    purchaseRate: p.purchaseRate,
    sellingRate: p.sellingRate,
    taxId: p.taxId,
    preferredVendorId: p.preferredVendorId,
    trackInventory: p.trackInventory,
    reorderLevel: p.reorderLevel,
    isActive: p.isActive,
  };
}

export async function createItem(ctx: Ctx, p: ItemPayload) {
  await validateItemMasters(ctx.organizationId, p);
  const item = await prisma.item.create({
    data: { organizationId: ctx.organizationId, createdById: ctx.userId, updatedById: ctx.userId, ...scalarData(p) },
    include: itemInclude,
  });
  return serializeItem(item);
}

export async function updateItem(ctx: Ctx, itemId: string, p: ItemPayload) {
  await findLiveItemOrThrow(ctx.organizationId, itemId);
  await validateItemMasters(ctx.organizationId, p, itemId);
  const item = await prisma.item.update({ where: { id: itemId }, data: { ...scalarData(p), updatedById: ctx.userId }, include: itemInclude });
  return serializeItem(item);
}

export async function setItemActive(ctx: Ctx, itemId: string, isActive: boolean) {
  await findLiveItemOrThrow(ctx.organizationId, itemId);
  const item = await prisma.item.update({ where: { id: itemId }, data: { isActive, updatedById: ctx.userId }, include: itemInclude });
  return serializeItem(item);
}

/** Soft delete. PO lines keep their snapshot; the item disappears from pickers and lists. */
export async function deleteItem(ctx: Ctx, itemId: string) {
  await findLiveItemOrThrow(ctx.organizationId, itemId);
  await prisma.item.update({ where: { id: itemId }, data: { deletedAt: new Date(), isActive: false, updatedById: ctx.userId } });
  return { id: itemId, deleted: true };
}
