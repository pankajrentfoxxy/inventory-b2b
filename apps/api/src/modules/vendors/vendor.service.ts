import { Prisma } from '@prisma/client';
import type { VendorListQuery, VendorPayload, VendorStatus } from '@b2b/shared';
import { prisma } from '../../lib/prisma.js';
import type { RequestContext } from '../../middleware/auth.js';
import {
  ADDRESS_KEYS,
  BANK_KEYS,
  CONTACT_KEYS,
  VENDOR_SCALAR_KEYS,
  addressData,
  assertDisplayNameAvailable,
  bankAccountData,
  contactData,
  customFieldRows,
  findLiveVendorOrThrow,
  normalizeAddresses,
  normalizeBankAccounts,
  normalizeContacts,
  reportingTagRows,
  validateMasters,
  vendorScalarData,
} from './vendor.repository.js';
import {
  addressSnapshot,
  bankAccountSnapshot,
  contactSnapshot,
  diffScalars,
  recordActivity,
} from './vendor.audit.js';
import {
  serializeVendorDetail,
  serializeVendorListItem,
  vendorDetailInclude,
  vendorListInclude,
} from './vendor.serializer.js';
import { encryptSecret } from '../../lib/crypto.js';
import { validationError } from '../../lib/errors.js';

type Ctx = Pick<RequestContext, 'userId' | 'userName' | 'organizationId'>;

/* ---- list ---------------------------------------------------------------- */

const SORT_MAP: Record<VendorListQuery['sortBy'], (dir: 'asc' | 'desc') => Prisma.VendorOrderByWithRelationInput> = {
  displayName: (d) => ({ displayName: d }),
  companyName: (d) => ({ companyName: { sort: d, nulls: 'last' } }),
  email: (d) => ({ email: { sort: d, nulls: 'last' } }),
  gstin: (d) => ({ gstin: { sort: d, nulls: 'last' } }),
  status: (d) => ({ status: d }),
  createdAt: (d) => ({ createdAt: d }),
  updatedAt: (d) => ({ updatedAt: d }),
};

export async function listVendors(organizationId: string, q: VendorListQuery) {
  const base: Prisma.VendorWhereInput = { organizationId, deletedAt: null };
  if (q.gstTreatmentId) base.gstTreatmentId = q.gstTreatmentId;
  if (q.sourceOfSupplyId) base.sourceOfSupplyId = q.sourceOfSupplyId;
  if (q.vendorType) base.vendorType = q.vendorType;
  if (q.tagOptionId) base.reportingTags = { some: { optionId: q.tagOptionId } };

  if (q.search) {
    const s = q.search;
    const digits = s.replace(/\D/g, '');
    const text = (field: string): Prisma.VendorWhereInput => ({ [field]: { contains: s, mode: 'insensitive' } });
    base.OR = [
      text('displayName'),
      text('companyName'),
      text('email'),
      text('firstName'),
      text('lastName'),
      { gstin: { contains: s.toUpperCase() } },
      { pan: { contains: s.toUpperCase() } },
      {
        contacts: {
          some: {
            OR: [
              { firstName: { contains: s, mode: 'insensitive' } },
              { lastName: { contains: s, mode: 'insensitive' } },
              { email: { contains: s, mode: 'insensitive' } },
            ],
          },
        },
      },
    ];
    if (digits.length >= 3) {
      base.OR.push({ workPhone: { contains: digits } }, { mobile: { contains: digits } });
      base.OR.push({ contacts: { some: { OR: [{ workPhone: { contains: digits } }, { mobile: { contains: digits } }] } } });
    }
  }

  const where: Prisma.VendorWhereInput = { ...base };
  if (q.status && q.status !== 'ALL') where.status = q.status;

  const orderBy: Prisma.VendorOrderByWithRelationInput[] = [SORT_MAP[q.sortBy](q.sortOrder)];
  if (q.sortBy !== 'displayName') orderBy.push({ displayName: 'asc' });

  const [total, rows, grouped] = await Promise.all([
    prisma.vendor.count({ where }),
    prisma.vendor.findMany({
      where,
      orderBy,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      include: vendorListInclude,
    }),
    prisma.vendor.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
  ]);

  const counts = { ALL: 0, ACTIVE: 0, INACTIVE: 0 } as Record<'ALL' | VendorStatus, number>;
  for (const g of grouped) {
    counts[g.status] = g._count._all;
    counts.ALL += g._count._all;
  }

  return {
    data: rows.map(serializeVendorListItem),
    pagination: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) },
    counts,
  };
}

/* ---- read ---------------------------------------------------------------- */

export async function getVendor(organizationId: string, vendorId: string) {
  const vendor = await findLiveVendorOrThrow(prisma, organizationId, vendorId, vendorDetailInclude);
  return serializeVendorDetail(vendor);
}

/* ---- create -------------------------------------------------------------- */

export async function createVendor(ctx: Ctx, payload: VendorPayload) {
  const { organizationId } = ctx;
  await assertDisplayNameAvailable(prisma, organizationId, payload.displayName);
  await validateMasters(prisma, organizationId, payload);

  const contacts = normalizeContacts(payload.contacts);
  const addresses = normalizeAddresses(payload.addresses);
  const bankAccounts = normalizeBankAccounts(payload.bankAccounts);
  const missingNumber = bankAccounts.findIndex((b) => !b.accountNumber);
  if (missingNumber >= 0) {
    throw validationError([{ path: `bankAccounts.${missingNumber}.accountNumber`, message: 'Account number is required' }]);
  }

  const vendorId = await prisma.$transaction(async (tx) => {
    const created = await tx.vendor.create({
      data: {
        organizationId,
        createdById: ctx.userId,
        updatedById: ctx.userId,
        ...vendorScalarData(payload),
        addresses: { create: addresses.map((a) => addressData(organizationId, a)) },
        contacts: { create: contacts.map((c) => contactData(organizationId, c)) },
        bankAccounts: {
          create: bankAccounts.map((b) => bankAccountData(organizationId, { ...b, accountNumber: b.accountNumber! })),
        },
        customFields: { create: customFieldRows(organizationId, payload.customFields) },
        reportingTags: { create: reportingTagRows(organizationId, payload.reportingTags) },
      },
      include: { bankAccounts: true, contacts: true, addresses: true },
    });

    await recordActivity(tx, ctx, created.id, {
      action: 'VENDOR_CREATED',
      entityType: 'VENDOR',
      entityId: created.id,
      summary: `Vendor "${created.displayName}" created`,
      newValue: {
        ...vendorScalarData(payload),
        contacts: created.contacts.map(contactSnapshot),
        addresses: created.addresses.map(addressSnapshot),
        bankAccounts: created.bankAccounts.map(bankAccountSnapshot),
      } as Prisma.InputJsonValue,
    });
    return created.id;
  });

  return getVendor(organizationId, vendorId);
}

/* ---- update -------------------------------------------------------------- */

export async function updateVendor(ctx: Ctx, vendorId: string, payload: VendorPayload) {
  const { organizationId } = ctx;
  const existing = await findLiveVendorOrThrow(prisma, organizationId, vendorId, {
    addresses: true,
    contacts: true,
    bankAccounts: true,
    customFields: { include: { field: true } },
    reportingTags: { include: { tag: true, option: true } },
  });
  await assertDisplayNameAvailable(prisma, organizationId, payload.displayName, vendorId);
  const masters = await validateMasters(prisma, organizationId, payload);

  const contacts = normalizeContacts(payload.contacts);
  const addresses = normalizeAddresses(payload.addresses);
  const bankAccounts = normalizeBankAccounts(payload.bankAccounts);

  // Child ids in the payload must belong to this vendor; anything else is treated as tampering.
  const knownContact = new Set(existing.contacts.map((c) => c.id));
  const knownAddress = new Set(existing.addresses.map((a) => a.id));
  const knownBank = new Set(existing.bankAccounts.map((b) => b.id));
  const badIds = [
    ...contacts.filter((c) => c.id && !knownContact.has(c.id)).map((_, i) => `contacts.${i}.id`),
    ...addresses.filter((a) => a.id && !knownAddress.has(a.id)).map((_, i) => `addresses.${i}.id`),
    ...bankAccounts.filter((b) => b.id && !knownBank.has(b.id)).map((_, i) => `bankAccounts.${i}.id`),
  ];
  if (badIds.length) throw validationError(badIds.map((path) => ({ path, message: 'Unknown record for this vendor' })));

  await prisma.$transaction(async (tx) => {
    /* scalars */
    const scalars = vendorScalarData(payload);
    const diff = diffScalars(existing as unknown as Record<string, unknown>, scalars, [...VENDOR_SCALAR_KEYS]);
    await tx.vendor.update({ where: { id: vendorId }, data: { ...scalars, updatedById: ctx.userId } });
    if (diff.changed.length) {
      await recordActivity(tx, ctx, vendorId, {
        action: 'VENDOR_UPDATED',
        entityType: 'VENDOR',
        entityId: vendorId,
        summary: `Updated ${diff.changed.join(', ')}`,
        oldValue: diff.oldValue,
        newValue: diff.newValue,
      });
    }

    /* contacts */
    const incomingContactIds = new Set(contacts.filter((c) => c.id).map((c) => c.id as string));
    for (const old of existing.contacts) {
      if (incomingContactIds.has(old.id)) continue;
      await tx.vendorContact.delete({ where: { id: old.id } });
      await recordActivity(tx, ctx, vendorId, {
        action: 'CONTACT_REMOVED',
        entityType: 'CONTACT',
        entityId: old.id,
        summary: `Removed contact ${[old.firstName, old.lastName].filter(Boolean).join(' ')}`,
        oldValue: contactSnapshot(old),
      });
    }
    for (const c of contacts) {
      const data = contactData(organizationId, c);
      if (c.id) {
        const old = existing.contacts.find((x) => x.id === c.id)!;
        const d = diffScalars(old as unknown as Record<string, unknown>, data, [...CONTACT_KEYS]);
        if (!d.changed.length) continue;
        await tx.vendorContact.update({ where: { id: c.id }, data });
        await recordActivity(tx, ctx, vendorId, {
          action: 'CONTACT_UPDATED',
          entityType: 'CONTACT',
          entityId: c.id,
          summary: `Updated contact ${c.firstName}${c.lastName ? ` ${c.lastName}` : ''} (${d.changed.join(', ')})`,
          oldValue: d.oldValue,
          newValue: d.newValue,
        });
      } else {
        const created = await tx.vendorContact.create({ data: { ...data, vendorId } });
        await recordActivity(tx, ctx, vendorId, {
          action: 'CONTACT_ADDED',
          entityType: 'CONTACT',
          entityId: created.id,
          summary: `Added contact ${c.firstName}${c.lastName ? ` ${c.lastName}` : ''}`,
          newValue: contactSnapshot(created),
        });
      }
    }

    /* addresses */
    const incomingAddressIds = new Set(addresses.filter((a) => a.id).map((a) => a.id as string));
    for (const old of existing.addresses) {
      if (incomingAddressIds.has(old.id)) continue;
      await tx.vendorAddress.delete({ where: { id: old.id } });
      await recordActivity(tx, ctx, vendorId, {
        action: 'ADDRESS_REMOVED',
        entityType: 'ADDRESS',
        entityId: old.id,
        summary: `Removed ${old.type.toLowerCase()} address`,
        oldValue: addressSnapshot(old),
      });
    }
    for (const a of addresses) {
      const data = addressData(organizationId, a);
      if (a.id) {
        const old = existing.addresses.find((x) => x.id === a.id)!;
        const d = diffScalars(old as unknown as Record<string, unknown>, data, [...ADDRESS_KEYS]);
        if (!d.changed.length) continue;
        await tx.vendorAddress.update({ where: { id: a.id }, data });
        await recordActivity(tx, ctx, vendorId, {
          action: 'ADDRESS_UPDATED',
          entityType: 'ADDRESS',
          entityId: a.id,
          summary: `Updated ${a.type.toLowerCase()} address (${d.changed.join(', ')})`,
          oldValue: d.oldValue,
          newValue: d.newValue,
        });
      } else {
        const created = await tx.vendorAddress.create({ data: { ...data, vendorId } });
        await recordActivity(tx, ctx, vendorId, {
          action: 'ADDRESS_ADDED',
          entityType: 'ADDRESS',
          entityId: created.id,
          summary: `Added ${a.type.toLowerCase()} address`,
          newValue: addressSnapshot(created),
        });
      }
    }

    /* bank accounts */
    const incomingBankIds = new Set(bankAccounts.filter((b) => b.id).map((b) => b.id as string));
    for (const old of existing.bankAccounts) {
      if (incomingBankIds.has(old.id)) continue;
      await tx.vendorBankAccount.delete({ where: { id: old.id } });
      await recordActivity(tx, ctx, vendorId, {
        action: 'BANK_ACCOUNT_REMOVED',
        entityType: 'BANK_ACCOUNT',
        entityId: old.id,
        summary: `Removed bank account ${old.bankName} (XXXX${old.accountNumberLast4})`,
        oldValue: bankAccountSnapshot(old),
      });
    }
    for (const b of bankAccounts) {
      if (b.id) {
        const old = existing.bankAccounts.find((x) => x.id === b.id)!;
        const data: Prisma.VendorBankAccountUpdateInput = {
          bankName: b.bankName,
          accountHolderName: b.accountHolderName,
          ifsc: b.ifsc,
          branch: b.branch,
          accountType: b.accountType,
          isPrimary: b.isPrimary,
        };
        if (b.accountNumber) {
          data.accountNumberEncrypted = encryptSecret(b.accountNumber);
          data.accountNumberLast4 = b.accountNumber.slice(-4);
        }
        const d = diffScalars(old as unknown as Record<string, unknown>, data as Record<string, unknown>, [...BANK_KEYS]);
        const numberChanged = Boolean(b.accountNumber) && data.accountNumberEncrypted !== old.accountNumberEncrypted;
        if (!d.changed.length && !numberChanged) continue;
        await tx.vendorBankAccount.update({ where: { id: b.id }, data });
        const changed = [...d.changed.map((k) => (k === 'accountNumberLast4' ? 'accountNumber' : k))];
        if (numberChanged && !changed.includes('accountNumber')) changed.push('accountNumber');
        await recordActivity(tx, ctx, vendorId, {
          action: 'BANK_ACCOUNT_UPDATED',
          entityType: 'BANK_ACCOUNT',
          entityId: b.id,
          summary: `Updated bank account ${b.bankName} (${changed.join(', ')})`,
          oldValue: bankAccountSnapshot(old),
          newValue: bankAccountSnapshot({
            ...old,
            ...data,
            accountNumberLast4: b.accountNumber ? b.accountNumber.slice(-4) : old.accountNumberLast4,
          } as typeof old),
        });
      } else {
        if (!b.accountNumber) {
          throw validationError([{ path: 'bankAccounts', message: 'Account number is required for new bank accounts' }]);
        }
        const created = await tx.vendorBankAccount.create({
          data: { ...bankAccountData(organizationId, { ...b, accountNumber: b.accountNumber }), vendorId },
        });
        await recordActivity(tx, ctx, vendorId, {
          action: 'BANK_ACCOUNT_ADDED',
          entityType: 'BANK_ACCOUNT',
          entityId: created.id,
          summary: `Added bank account ${created.bankName} (XXXX${created.accountNumberLast4})`,
          newValue: bankAccountSnapshot(created),
        });
      }
    }

    /* custom fields */
    const oldCf: Record<string, unknown> = {};
    for (const cf of existing.customFields) oldCf[cf.field.label] = cf.value;
    const newRows = customFieldRows(organizationId, payload.customFields);
    const newCf: Record<string, unknown> = {};
    for (const row of newRows) newCf[masters.customFieldDefinitions.get(row.fieldId)?.label ?? row.fieldId] = row.value;
    if (JSON.stringify(sortKeys(oldCf)) !== JSON.stringify(sortKeys(newCf))) {
      await tx.vendorCustomFieldValue.deleteMany({ where: { vendorId } });
      if (newRows.length) await tx.vendorCustomFieldValue.createMany({ data: newRows.map((r) => ({ ...r, vendorId })) });
      await recordActivity(tx, ctx, vendorId, {
        action: 'CUSTOM_FIELDS_UPDATED',
        entityType: 'CUSTOM_FIELDS',
        summary: 'Updated custom fields',
        oldValue: oldCf as Prisma.InputJsonValue,
        newValue: newCf as Prisma.InputJsonValue,
      });
    }

    /* reporting tags */
    const oldTags: Record<string, string> = {};
    for (const t of existing.reportingTags) oldTags[t.tag.name] = t.option.name;
    const tagRows = reportingTagRows(organizationId, payload.reportingTags);
    const oldByPair = new Set(existing.reportingTags.map((t) => `${t.tagId}:${t.optionId}`));
    const newByPair = new Set(tagRows.map((t) => `${t.tagId}:${t.optionId}`));
    const tagsChanged = oldByPair.size !== newByPair.size || [...newByPair].some((p) => !oldByPair.has(p));
    if (tagsChanged) {
      await tx.vendorReportingTag.deleteMany({ where: { vendorId } });
      if (tagRows.length) await tx.vendorReportingTag.createMany({ data: tagRows.map((r) => ({ ...r, vendorId })) });
      const fresh = await tx.vendorReportingTag.findMany({ where: { vendorId }, include: { tag: true, option: true } });
      const newTags: Record<string, string> = {};
      for (const t of fresh) newTags[t.tag.name] = t.option.name;
      await recordActivity(tx, ctx, vendorId, {
        action: 'REPORTING_TAGS_UPDATED',
        entityType: 'REPORTING_TAGS',
        summary: 'Updated reporting tags',
        oldValue: oldTags,
        newValue: newTags,
      });
    }
  });

  return getVendor(organizationId, vendorId);
}

function sortKeys(obj: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}

/* ---- status / delete ------------------------------------------------------ */

export async function updateVendorStatus(ctx: Ctx, vendorId: string, status: VendorStatus, reason: string | null) {
  const existing = await findLiveVendorOrThrow(prisma, ctx.organizationId, vendorId);
  if (existing.status !== status) {
    await prisma.$transaction(async (tx) => {
      await tx.vendor.update({ where: { id: vendorId }, data: { status, updatedById: ctx.userId } });
      await recordActivity(tx, ctx, vendorId, {
        action: 'VENDOR_STATUS_CHANGED',
        entityType: 'VENDOR',
        entityId: vendorId,
        summary: `Marked as ${status === 'ACTIVE' ? 'active' : 'inactive'}${reason ? `: ${reason}` : ''}`,
        oldValue: { status: existing.status },
        newValue: { status, reason },
      });
    });
  }
  return getVendor(ctx.organizationId, vendorId);
}

/**
 * Soft delete. Once purchasing transactions exist, add a guard here that refuses deletion
 * (or requires INACTIVE instead) when the vendor is referenced by any PO / bill / payment.
 */
export async function deleteVendor(ctx: Ctx, vendorId: string) {
  const existing = await findLiveVendorOrThrow(prisma, ctx.organizationId, vendorId);
  await prisma.$transaction(async (tx) => {
    await tx.vendor.update({
      where: { id: vendorId },
      data: { deletedAt: new Date(), status: 'INACTIVE', updatedById: ctx.userId },
    });
    await recordActivity(tx, ctx, vendorId, {
      action: 'VENDOR_DELETED',
      entityType: 'VENDOR',
      entityId: vendorId,
      summary: `Vendor "${existing.displayName}" deleted`,
      oldValue: { status: existing.status, displayName: existing.displayName },
    });
  });
  return { id: vendorId, deleted: true };
}

/* ---- activity & transactions --------------------------------------------- */

export async function listVendorActivity(organizationId: string, vendorId: string, page: number, limit: number) {
  await findLiveVendorOrThrow(prisma, organizationId, vendorId);
  const where = { vendorId, organizationId };
  const [total, rows] = await Promise.all([
    prisma.vendorActivity.count({ where }),
    prisma.vendorActivity.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
  ]);
  return { data: rows, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

/**
 * Aggregated view of the vendor's transactions across purchasing modules. Each module reports
 * `available: false` until it ships, so the UI can render an honest "not connected yet" state
 * instead of fabricated numbers. Future modules plug in here by adding a loader keyed by module name.
 */
export async function getVendorTransactions(organizationId: string, vendorId: string) {
  const vendor = await findLiveVendorOrThrow(prisma, organizationId, vendorId);
  const pending = { available: false as const, items: [] as never[], total: 0 };

  const [poTotal, purchaseOrders, receiveTotal, receives] = await Promise.all([
    prisma.purchaseOrder.count({ where: { organizationId, vendorId, deletedAt: null } }),
    prisma.purchaseOrder.findMany({
      where: { organizationId, vendorId, deletedAt: null },
      orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }],
      take: 25,
      select: { id: true, purchaseOrderNumber: true, referenceNumber: true, orderDate: true, expectedDeliveryDate: true, status: true, total: true, currencyCode: true },
    }),
    prisma.purchaseReceive.count({ where: { organizationId, vendorId } }),
    prisma.purchaseReceive.findMany({
      where: { organizationId, vendorId },
      orderBy: [{ receivedDate: 'desc' }, { createdAt: 'desc' }],
      take: 25,
      select: { id: true, receiveNumber: true, receivedDate: true, status: true, totalQuantity: true, purchaseOrder: { select: { id: true, purchaseOrderNumber: true } } },
    }),
  ]);

  return {
    vendorId,
    currencyCode: vendor.currencyCode,
    summary: {
      openingBalance: vendor.openingBalance === null ? null : Number(vendor.openingBalance),
      outstandingPayables: null,
      unusedCredits: null,
    },
    modules: {
      purchaseOrders: {
        available: true as const,
        total: poTotal,
        items: purchaseOrders.map((p) => ({
          id: p.id,
          number: p.purchaseOrderNumber,
          reference: p.referenceNumber,
          date: p.orderDate.toISOString().slice(0, 10),
          expectedDeliveryDate: p.expectedDeliveryDate ? p.expectedDeliveryDate.toISOString().slice(0, 10) : null,
          status: p.status,
          amount: Number(p.total),
          currencyCode: p.currencyCode,
        })),
      },
      purchaseReceives: {
        available: true as const,
        total: receiveTotal,
        items: receives.map((r) => ({
          id: r.id,
          number: r.receiveNumber,
          date: r.receivedDate.toISOString().slice(0, 10),
          status: r.status,
          quantity: Number(r.totalQuantity),
          purchaseOrder: r.purchaseOrder,
        })),
      },
      bills: pending,
      paymentsMade: pending,
      vendorCredits: pending,
      returns: pending,
    },
  };
}
