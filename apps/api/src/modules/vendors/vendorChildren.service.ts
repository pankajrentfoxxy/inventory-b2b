/**
 * Row-level operations on a vendor's contacts, addresses, bank accounts and notes,
 * used by the vendor details page. The full-form PUT /api/vendors/:id reconciles the same
 * children in bulk (see vendor.service.ts); both paths share normalisation + audit helpers.
 */
import { Prisma } from '@prisma/client';
import type { VendorAddressPayload, VendorBankAccountPayload, VendorContactPayload } from '@b2b/shared';
import { digitsOnly, isBlankAddress } from '@b2b/shared';
import { prisma } from '../../lib/prisma.js';
import { decryptSecret, encryptSecret } from '../../lib/crypto.js';
import { notFound, validationError } from '../../lib/errors.js';
import type { RequestContext } from '../../middleware/auth.js';
import {
  ADDRESS_KEYS,
  BANK_KEYS,
  CONTACT_KEYS,
  addressData,
  bankAccountData,
  contactData,
  findLiveVendorOrThrow,
} from './vendor.repository.js';
import { addressSnapshot, bankAccountSnapshot, contactSnapshot, diffScalars, recordActivity } from './vendor.audit.js';
import { serializeBankAccount } from './vendor.serializer.js';

type Ctx = Pick<RequestContext, 'userId' | 'userName' | 'organizationId'>;

/* ---- contacts ------------------------------------------------------------ */

export async function addContact(ctx: Ctx, vendorId: string, input: VendorContactPayload) {
  await findLiveVendorOrThrow(prisma, ctx.organizationId, vendorId);
  const c = { ...input, workPhone: input.workPhone ? digitsOnly(input.workPhone) : null, mobile: input.mobile ? digitsOnly(input.mobile) : null };
  return prisma.$transaction(async (tx) => {
    const count = await tx.vendorContact.count({ where: { vendorId } });
    const isPrimary = c.isPrimary || count === 0;
    if (isPrimary) await tx.vendorContact.updateMany({ where: { vendorId, isPrimary: true }, data: { isPrimary: false } });
    const created = await tx.vendorContact.create({ data: { ...contactData(ctx.organizationId, { ...c, isPrimary }), vendorId } });
    await recordActivity(tx, ctx, vendorId, {
      action: 'CONTACT_ADDED',
      entityType: 'CONTACT',
      entityId: created.id,
      summary: `Added contact ${created.firstName}${created.lastName ? ` ${created.lastName}` : ''}`,
      newValue: contactSnapshot(created),
    });
    return created;
  });
}

export async function updateContact(ctx: Ctx, vendorId: string, contactId: string, input: VendorContactPayload) {
  await findLiveVendorOrThrow(prisma, ctx.organizationId, vendorId);
  const old = await prisma.vendorContact.findFirst({ where: { id: contactId, vendorId, organizationId: ctx.organizationId } });
  if (!old) throw notFound('Contact person not found');
  const c = { ...input, workPhone: input.workPhone ? digitsOnly(input.workPhone) : null, mobile: input.mobile ? digitsOnly(input.mobile) : null };
  return prisma.$transaction(async (tx) => {
    // The primary flag can be granted here, but not removed: demote by promoting another contact.
    const isPrimary = c.isPrimary || old.isPrimary;
    if (isPrimary && !old.isPrimary) {
      await tx.vendorContact.updateMany({ where: { vendorId, isPrimary: true }, data: { isPrimary: false } });
    }
    const data = contactData(ctx.organizationId, { ...c, isPrimary });
    const d = diffScalars(old as unknown as Record<string, unknown>, data, [...CONTACT_KEYS]);
    const updated = await tx.vendorContact.update({ where: { id: contactId }, data });
    if (d.changed.length) {
      await recordActivity(tx, ctx, vendorId, {
        action: 'CONTACT_UPDATED',
        entityType: 'CONTACT',
        entityId: contactId,
        summary: `Updated contact ${updated.firstName}${updated.lastName ? ` ${updated.lastName}` : ''} (${d.changed.join(', ')})`,
        oldValue: d.oldValue,
        newValue: d.newValue,
      });
    }
    return updated;
  });
}

export async function removeContact(ctx: Ctx, vendorId: string, contactId: string) {
  await findLiveVendorOrThrow(prisma, ctx.organizationId, vendorId);
  const old = await prisma.vendorContact.findFirst({ where: { id: contactId, vendorId, organizationId: ctx.organizationId } });
  if (!old) throw notFound('Contact person not found');
  await prisma.$transaction(async (tx) => {
    await tx.vendorContact.delete({ where: { id: contactId } });
    if (old.isPrimary) {
      const next = await tx.vendorContact.findFirst({ where: { vendorId }, orderBy: { createdAt: 'asc' } });
      if (next) await tx.vendorContact.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    await recordActivity(tx, ctx, vendorId, {
      action: 'CONTACT_REMOVED',
      entityType: 'CONTACT',
      entityId: contactId,
      summary: `Removed contact ${old.firstName}${old.lastName ? ` ${old.lastName}` : ''}`,
      oldValue: contactSnapshot(old),
    });
  });
  return { id: contactId, deleted: true };
}

/* ---- addresses ----------------------------------------------------------- */

export async function addAddress(ctx: Ctx, vendorId: string, input: VendorAddressPayload) {
  await findLiveVendorOrThrow(prisma, ctx.organizationId, vendorId);
  if (isBlankAddress(input)) throw validationError([{ path: 'addressLine1', message: 'Enter at least one address line' }]);
  const a = { ...input, phone: input.phone ? digitsOnly(input.phone) : null };
  return prisma.$transaction(async (tx) => {
    const count = await tx.vendorAddress.count({ where: { vendorId, type: a.type } });
    const isPrimary = a.isPrimary || count === 0;
    if (isPrimary) await tx.vendorAddress.updateMany({ where: { vendorId, type: a.type, isPrimary: true }, data: { isPrimary: false } });
    const created = await tx.vendorAddress.create({ data: { ...addressData(ctx.organizationId, { ...a, isPrimary }), vendorId } });
    await recordActivity(tx, ctx, vendorId, {
      action: 'ADDRESS_ADDED',
      entityType: 'ADDRESS',
      entityId: created.id,
      summary: `Added ${created.type.toLowerCase()} address`,
      newValue: addressSnapshot(created),
    });
    return created;
  });
}

export async function updateAddress(ctx: Ctx, vendorId: string, addressId: string, input: VendorAddressPayload) {
  await findLiveVendorOrThrow(prisma, ctx.organizationId, vendorId);
  const old = await prisma.vendorAddress.findFirst({ where: { id: addressId, vendorId, organizationId: ctx.organizationId } });
  if (!old) throw notFound('Address not found');
  if (isBlankAddress(input)) throw validationError([{ path: 'addressLine1', message: 'Enter at least one address line' }]);
  const a = { ...input, phone: input.phone ? digitsOnly(input.phone) : null };
  return prisma.$transaction(async (tx) => {
    const isPrimary = a.isPrimary || (old.isPrimary && old.type === a.type);
    if (isPrimary) {
      await tx.vendorAddress.updateMany({
        where: { vendorId, type: a.type, isPrimary: true, id: { not: addressId } },
        data: { isPrimary: false },
      });
    }
    const data = addressData(ctx.organizationId, { ...a, isPrimary });
    const d = diffScalars(old as unknown as Record<string, unknown>, data, [...ADDRESS_KEYS]);
    const updated = await tx.vendorAddress.update({ where: { id: addressId }, data });
    if (d.changed.length) {
      await recordActivity(tx, ctx, vendorId, {
        action: 'ADDRESS_UPDATED',
        entityType: 'ADDRESS',
        entityId: addressId,
        summary: `Updated ${updated.type.toLowerCase()} address (${d.changed.join(', ')})`,
        oldValue: d.oldValue,
        newValue: d.newValue,
      });
    }
    return updated;
  });
}

export async function removeAddress(ctx: Ctx, vendorId: string, addressId: string) {
  await findLiveVendorOrThrow(prisma, ctx.organizationId, vendorId);
  const old = await prisma.vendorAddress.findFirst({ where: { id: addressId, vendorId, organizationId: ctx.organizationId } });
  if (!old) throw notFound('Address not found');
  await prisma.$transaction(async (tx) => {
    await tx.vendorAddress.delete({ where: { id: addressId } });
    if (old.isPrimary) {
      const next = await tx.vendorAddress.findFirst({ where: { vendorId, type: old.type }, orderBy: { createdAt: 'asc' } });
      if (next) await tx.vendorAddress.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    await recordActivity(tx, ctx, vendorId, {
      action: 'ADDRESS_REMOVED',
      entityType: 'ADDRESS',
      entityId: addressId,
      summary: `Removed ${old.type.toLowerCase()} address`,
      oldValue: addressSnapshot(old),
    });
  });
  return { id: addressId, deleted: true };
}

/* ---- bank accounts ------------------------------------------------------- */

export async function addBankAccount(ctx: Ctx, vendorId: string, input: VendorBankAccountPayload) {
  await findLiveVendorOrThrow(prisma, ctx.organizationId, vendorId);
  if (!input.accountNumber) throw validationError([{ path: 'accountNumber', message: 'Account number is required' }]);
  const accountNumber = input.accountNumber;
  return prisma.$transaction(async (tx) => {
    const count = await tx.vendorBankAccount.count({ where: { vendorId } });
    const isPrimary = input.isPrimary || count === 0;
    if (isPrimary) await tx.vendorBankAccount.updateMany({ where: { vendorId, isPrimary: true }, data: { isPrimary: false } });
    const created = await tx.vendorBankAccount.create({
      data: { ...bankAccountData(ctx.organizationId, { ...input, accountNumber, isPrimary }), vendorId },
    });
    await recordActivity(tx, ctx, vendorId, {
      action: 'BANK_ACCOUNT_ADDED',
      entityType: 'BANK_ACCOUNT',
      entityId: created.id,
      summary: `Added bank account ${created.bankName} (XXXX${created.accountNumberLast4})`,
      newValue: bankAccountSnapshot(created),
    });
    return serializeBankAccount(created);
  });
}

export async function updateBankAccount(ctx: Ctx, vendorId: string, accountId: string, input: VendorBankAccountPayload) {
  await findLiveVendorOrThrow(prisma, ctx.organizationId, vendorId);
  const old = await prisma.vendorBankAccount.findFirst({ where: { id: accountId, vendorId, organizationId: ctx.organizationId } });
  if (!old) throw notFound('Bank account not found');
  return prisma.$transaction(async (tx) => {
    const isPrimary = input.isPrimary || old.isPrimary;
    if (isPrimary && !old.isPrimary) {
      await tx.vendorBankAccount.updateMany({ where: { vendorId, isPrimary: true }, data: { isPrimary: false } });
    }
    const data: Prisma.VendorBankAccountUpdateInput = {
      bankName: input.bankName,
      accountHolderName: input.accountHolderName,
      ifsc: input.ifsc,
      branch: input.branch,
      accountType: input.accountType,
      isPrimary,
    };
    if (input.accountNumber) {
      data.accountNumberEncrypted = encryptSecret(input.accountNumber);
      data.accountNumberLast4 = input.accountNumber.slice(-4);
    }
    const d = diffScalars(old as unknown as Record<string, unknown>, data as Record<string, unknown>, [...BANK_KEYS]);
    const numberChanged = Boolean(input.accountNumber) && decryptSecret(old.accountNumberEncrypted) !== input.accountNumber;
    const updated = await tx.vendorBankAccount.update({ where: { id: accountId }, data });
    if (d.changed.length || numberChanged) {
      const changed = d.changed.map((k) => (k === 'accountNumberLast4' ? 'accountNumber' : k));
      if (numberChanged && !changed.includes('accountNumber')) changed.push('accountNumber');
      await recordActivity(tx, ctx, vendorId, {
        action: 'BANK_ACCOUNT_UPDATED',
        entityType: 'BANK_ACCOUNT',
        entityId: accountId,
        summary: `Updated bank account ${updated.bankName} (${changed.join(', ')})`,
        oldValue: bankAccountSnapshot(old),
        newValue: bankAccountSnapshot(updated),
      });
    }
    return serializeBankAccount(updated);
  });
}

export async function removeBankAccount(ctx: Ctx, vendorId: string, accountId: string) {
  await findLiveVendorOrThrow(prisma, ctx.organizationId, vendorId);
  const old = await prisma.vendorBankAccount.findFirst({ where: { id: accountId, vendorId, organizationId: ctx.organizationId } });
  if (!old) throw notFound('Bank account not found');
  await prisma.$transaction(async (tx) => {
    await tx.vendorBankAccount.delete({ where: { id: accountId } });
    if (old.isPrimary) {
      const next = await tx.vendorBankAccount.findFirst({ where: { vendorId }, orderBy: { createdAt: 'asc' } });
      if (next) await tx.vendorBankAccount.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    await recordActivity(tx, ctx, vendorId, {
      action: 'BANK_ACCOUNT_REMOVED',
      entityType: 'BANK_ACCOUNT',
      entityId: accountId,
      summary: `Removed bank account ${old.bankName} (XXXX${old.accountNumberLast4})`,
      oldValue: bankAccountSnapshot(old),
    });
  });
  return { id: accountId, deleted: true };
}

/** Decrypts the full account number. Gated by vendor.bank_details_view and written to the audit trail. */
export async function revealBankAccount(ctx: Ctx, vendorId: string, accountId: string) {
  await findLiveVendorOrThrow(prisma, ctx.organizationId, vendorId);
  const acct = await prisma.vendorBankAccount.findFirst({ where: { id: accountId, vendorId, organizationId: ctx.organizationId } });
  if (!acct) throw notFound('Bank account not found');
  await prisma.$transaction(async (tx) => {
    await recordActivity(tx, ctx, vendorId, {
      action: 'BANK_ACCOUNT_REVEALED',
      entityType: 'BANK_ACCOUNT',
      entityId: accountId,
      summary: `Viewed full account number for ${acct.bankName} (XXXX${acct.accountNumberLast4})`,
    });
  });
  return { id: acct.id, accountNumber: decryptSecret(acct.accountNumberEncrypted) };
}

/* ---- notes ---------------------------------------------------------------- */

export async function listNotes(organizationId: string, vendorId: string) {
  await findLiveVendorOrThrow(prisma, organizationId, vendorId);
  const notes = await prisma.vendorNote.findMany({ where: { vendorId, organizationId }, orderBy: { createdAt: 'desc' } });
  const userIds = [...new Set(notes.map((n) => n.createdById).filter((id): id is string => Boolean(id)))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  return notes.map((n) => ({ ...n, createdByName: n.createdById ? (names.get(n.createdById) ?? null) : null }));
}

export async function addNote(ctx: Ctx, vendorId: string, body: string) {
  await findLiveVendorOrThrow(prisma, ctx.organizationId, vendorId);
  return prisma.$transaction(async (tx) => {
    const note = await tx.vendorNote.create({ data: { vendorId, organizationId: ctx.organizationId, body, createdById: ctx.userId } });
    await recordActivity(tx, ctx, vendorId, {
      action: 'NOTE_ADDED',
      entityType: 'NOTE',
      entityId: note.id,
      summary: `Added a note: ${body.slice(0, 80)}${body.length > 80 ? '...' : ''}`,
    });
    return { ...note, createdByName: ctx.userName };
  });
}

export async function removeNote(ctx: Ctx, vendorId: string, noteId: string) {
  await findLiveVendorOrThrow(prisma, ctx.organizationId, vendorId);
  const note = await prisma.vendorNote.findFirst({ where: { id: noteId, vendorId, organizationId: ctx.organizationId } });
  if (!note) throw notFound('Note not found');
  await prisma.$transaction(async (tx) => {
    await tx.vendorNote.delete({ where: { id: noteId } });
    await recordActivity(tx, ctx, vendorId, {
      action: 'NOTE_REMOVED',
      entityType: 'NOTE',
      entityId: noteId,
      summary: 'Removed a note',
      oldValue: { body: note.body },
    });
  });
  return { id: noteId, deleted: true };
}
