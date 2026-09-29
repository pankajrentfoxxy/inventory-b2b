import type { Prisma } from '@prisma/client';
import type { VendorActivityAction } from '@b2b/shared';
import { maskAccountNumber } from '@b2b/shared';
import type { PrismaTx } from '../../lib/prisma.js';
import type { RequestContext } from '../../middleware/auth.js';

type Json = Prisma.InputJsonValue;

export interface AuditEntry {
  action: VendorActivityAction;
  entityType: 'VENDOR' | 'CONTACT' | 'ADDRESS' | 'BANK_ACCOUNT' | 'CUSTOM_FIELDS' | 'REPORTING_TAGS' | 'NOTE' | 'DOCUMENT';
  entityId?: string | null;
  summary: string;
  oldValue?: Json | null;
  newValue?: Json | null;
}

export async function recordActivity(
  tx: PrismaTx,
  ctx: Pick<RequestContext, 'userId' | 'userName' | 'organizationId'>,
  vendorId: string,
  entry: AuditEntry,
) {
  await tx.vendorActivity.create({
    data: {
      vendorId,
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

/** Field names that are never written to the audit log in clear text. */
const SENSITIVE_KEYS = new Set(['accountNumber', 'accountNumberEncrypted']);

/** Shallow diff of scalar fields; returns { old, new } containing only the keys that changed. */
export function diffScalars<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  keys: (keyof T & string)[],
): { changed: string[]; oldValue: Record<string, Json | null>; newValue: Record<string, Json | null> } {
  const oldValue: Record<string, Json | null> = {};
  const newValue: Record<string, Json | null> = {};
  const changed: string[] = [];
  for (const key of keys) {
    if (!(key in after)) continue;
    const a = normalise(before[key]);
    const b = normalise(after[key]);
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    changed.push(key);
    oldValue[key] = SENSITIVE_KEYS.has(key) ? '[redacted]' : a;
    newValue[key] = SENSITIVE_KEYS.has(key) ? '[redacted]' : b;
  }
  return { changed, oldValue, newValue };
}

function normalise(v: unknown): Json | null {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object' && 'toNumber' in (v as object)) return Number(v as unknown as number);
  if (typeof v === 'bigint') return Number(v);
  return v as Json;
}

/** Audit-safe projection of a bank account: never the full account number. */
export function bankAccountSnapshot(b: {
  bankName: string;
  accountHolderName: string;
  accountNumberLast4: string;
  ifsc: string;
  branch: string | null;
  accountType: string;
  isPrimary: boolean;
}) {
  return {
    bankName: b.bankName,
    accountHolderName: b.accountHolderName,
    accountNumber: maskAccountNumber(b.accountNumberLast4),
    ifsc: b.ifsc,
    branch: b.branch,
    accountType: b.accountType,
    isPrimary: b.isPrimary,
  };
}

export function contactSnapshot(c: {
  salutation: string | null;
  firstName: string;
  lastName: string | null;
  email: string | null;
  workPhone: string | null;
  mobile: string | null;
  designation: string | null;
  department: string | null;
  isPrimary: boolean;
}) {
  const { salutation, firstName, lastName, email, workPhone, mobile, designation, department, isPrimary } = c;
  return { salutation, firstName, lastName, email, workPhone, mobile, designation, department, isPrimary };
}

export function addressSnapshot(a: {
  type: string;
  attention: string | null;
  countryCode: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  postalCode: string | null;
  phone: string | null;
  fax: string | null;
  isPrimary: boolean;
}) {
  const { type, attention, countryCode, addressLine1, addressLine2, city, state, stateCode, postalCode, phone, fax, isPrimary } = a;
  return { type, attention, countryCode, addressLine1, addressLine2, city, state, stateCode, postalCode, phone, fax, isPrimary };
}
