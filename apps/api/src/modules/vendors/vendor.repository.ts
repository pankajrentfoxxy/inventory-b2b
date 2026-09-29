import { Prisma } from '@prisma/client';
import {
  digitsOnly,
  isBlankAddress,
  isValidDateString,
  type VendorAddressPayload,
  type VendorBankAccountPayload,
  type VendorContactPayload,
  type VendorCustomFieldValuePayload,
  type VendorPayload,
  type VendorReportingTagValuePayload,
} from '@b2b/shared';
import { prisma, type PrismaTx } from '../../lib/prisma.js';
import { conflict, notFound, validationError, type ErrorDetail } from '../../lib/errors.js';
import { encryptSecret } from '../../lib/crypto.js';

export type Db = PrismaTx | typeof prisma;

/* ---- lookups ------------------------------------------------------------ */

/** Org-scoped, soft-delete-aware vendor lookup. Every vendor read goes through here. */
export async function findLiveVendorOrThrow<I extends Prisma.VendorInclude>(
  db: Db,
  organizationId: string,
  vendorId: string,
  include?: I,
) {
  const vendor = await db.vendor.findFirst({
    where: { id: vendorId, organizationId, deletedAt: null },
    include,
  });
  if (!vendor) throw notFound('Vendor not found', 'VENDOR_NOT_FOUND');
  return vendor as Prisma.VendorGetPayload<{ include: I }>;
}

export async function assertDisplayNameAvailable(
  db: Db,
  organizationId: string,
  displayName: string,
  excludeVendorId?: string,
) {
  const clash = await db.vendor.findFirst({
    where: {
      organizationId,
      deletedAt: null,
      displayName: { equals: displayName, mode: 'insensitive' },
      ...(excludeVendorId ? { id: { not: excludeVendorId } } : {}),
    },
    select: { id: true, displayName: true },
  });
  if (clash) {
    throw conflict(`A vendor named "${clash.displayName}" already exists in this organization`, 'DUPLICATE_DISPLAY_NAME', [
      { path: 'displayName', message: 'This display name is already used by another vendor' },
    ]);
  }
}

/* ---- master-data validation -------------------------------------------- */

export interface ResolvedMasters {
  gstTreatment: { id: string; name: string; requiresGstin: boolean };
  customFieldDefinitions: Map<string, { id: string; key: string; label: string; fieldType: string; options: unknown; isRequired: boolean }>;
}

/**
 * Confirms every referenced master row belongs to the caller's organization and is active,
 * and applies master-driven rules (GSTIN required by treatment, required custom fields, dropdown options).
 */
export async function validateMasters(db: Db, organizationId: string, p: VendorPayload): Promise<ResolvedMasters> {
  const details: ErrorDetail[] = [];

  const [gstTreatment, sourceOfSupply, paymentTerm, currency, fieldDefs, tags] = await Promise.all([
    db.gstTreatment.findFirst({ where: { id: p.gstTreatmentId, organizationId, isActive: true } }),
    db.sourceOfSupply.findFirst({ where: { id: p.sourceOfSupplyId, organizationId, isActive: true } }),
    p.paymentTermId
      ? db.paymentTerm.findFirst({ where: { id: p.paymentTermId, organizationId, isActive: true } })
      : Promise.resolve(null),
    db.currency.findFirst({ where: { code: p.currencyCode, isActive: true } }),
    db.customFieldDefinition.findMany({ where: { organizationId, entityType: 'VENDOR', isActive: true } }),
    db.reportingTag.findMany({
      where: { organizationId, isActive: true },
      include: { options: { where: { isActive: true }, select: { id: true } } },
    }),
  ]);

  if (!gstTreatment) details.push({ path: 'gstTreatmentId', message: 'Select a valid GST treatment' });
  if (!sourceOfSupply) details.push({ path: 'sourceOfSupplyId', message: 'Select a valid source of supply' });
  if (p.paymentTermId && !paymentTerm) details.push({ path: 'paymentTermId', message: 'Select a valid payment term' });
  if (!currency) details.push({ path: 'currencyCode', message: 'Select a valid currency' });
  if (gstTreatment?.requiresGstin && !p.gstin) {
    details.push({ path: 'gstin', message: `GSTIN is required for "${gstTreatment.name}" vendors` });
  }

  const defs = new Map(fieldDefs.map((f) => [f.id, f]));
  p.customFields.forEach((cf, index) => {
    const def = defs.get(cf.fieldId);
    if (!def) {
      details.push({ path: `customFields.${index}.value`, message: 'Unknown custom field' });
      return;
    }
    const problem = validateCustomValue(def.fieldType, def.options, cf.value);
    if (problem) details.push({ path: `customFields.${index}.value`, message: `${def.label}: ${problem}` });
  });
  for (const def of fieldDefs) {
    if (!def.isRequired) continue;
    const provided = p.customFields.find((cf) => cf.fieldId === def.id);
    const empty = provided === undefined || provided.value === null || provided.value === '';
    if (empty) {
      const index = p.customFields.findIndex((cf) => cf.fieldId === def.id);
      details.push({
        path: index >= 0 ? `customFields.${index}.value` : 'customFields',
        message: `${def.label} is required`,
      });
    }
  }

  const tagMap = new Map(tags.map((t) => [t.id, new Set(t.options.map((o) => o.id))]));
  p.reportingTags.forEach((rt, index) => {
    if (!rt.optionId) return;
    const options = tagMap.get(rt.tagId);
    if (!options) details.push({ path: `reportingTags.${index}.optionId`, message: 'Unknown reporting tag' });
    else if (!options.has(rt.optionId)) {
      details.push({ path: `reportingTags.${index}.optionId`, message: 'Option does not belong to this tag' });
    }
  });

  if (details.length) throw validationError(details);

  return {
    gstTreatment: gstTreatment!,
    customFieldDefinitions: new Map(
      fieldDefs.map((f) => [
        f.id,
        { id: f.id, key: f.key, label: f.label, fieldType: f.fieldType, options: f.options, isRequired: f.isRequired },
      ]),
    ),
  };
}

export function validateCustomValue(fieldType: string, options: unknown, value: unknown): string | null {
  if (value === null || value === '') return null;
  switch (fieldType) {
    case 'TEXT':
      return typeof value === 'string' && value.length <= 1000 ? null : 'must be text up to 1000 characters';
    case 'NUMBER':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'must be a number';
    case 'BOOLEAN':
      return typeof value === 'boolean' ? null : 'must be yes or no';
    case 'DATE':
      return typeof value === 'string' && isValidDateString(value) ? null : 'must be a valid date (YYYY-MM-DD)';
    case 'DROPDOWN': {
      const allowed = Array.isArray(options) ? (options as unknown[]).map(String) : [];
      return typeof value === 'string' && allowed.includes(value) ? null : `must be one of: ${allowed.join(', ')}`;
    }
    default:
      return null;
  }
}

/* ---- payload normalisation --------------------------------------------- */

export function normalizeContacts(contacts: VendorContactPayload[]) {
  const list = contacts.map((c) => ({
    ...c,
    workPhone: c.workPhone ? digitsOnly(c.workPhone) : null,
    mobile: c.mobile ? digitsOnly(c.mobile) : null,
  }));
  if (list.length && !list.some((c) => c.isPrimary)) list[0].isPrimary = true;
  return list;
}

export function normalizeAddresses(addresses: VendorAddressPayload[]) {
  const list = addresses
    .filter((a) => !isBlankAddress(a))
    .map((a) => ({ ...a, phone: a.phone ? digitsOnly(a.phone) : null }));
  for (const type of ['BILLING', 'SHIPPING'] as const) {
    const ofType = list.filter((a) => a.type === type);
    if (ofType.length && !ofType.some((a) => a.isPrimary)) ofType[0].isPrimary = true;
    // Keep at most one primary per type; the first flagged wins.
    let seen = false;
    for (const a of ofType) {
      if (a.isPrimary && seen) a.isPrimary = false;
      if (a.isPrimary) seen = true;
    }
  }
  return list;
}

export function normalizeBankAccounts(accounts: VendorBankAccountPayload[]) {
  const list = accounts.map((b) => ({ ...b }));
  if (list.length && !list.some((b) => b.isPrimary)) list[0].isPrimary = true;
  return list;
}

export function vendorScalarData(p: VendorPayload) {
  return {
    displayName: p.displayName,
    companyName: p.companyName,
    salutation: p.salutation,
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email ? p.email.toLowerCase() : null,
    workPhoneCountryCode: p.workPhone ? p.workPhoneCountryCode : null,
    workPhone: p.workPhone ? digitsOnly(p.workPhone) : null,
    mobileCountryCode: p.mobile ? p.mobileCountryCode : null,
    mobile: p.mobile ? digitsOnly(p.mobile) : null,
    language: p.language,
    website: p.website,
    gstTreatmentId: p.gstTreatmentId,
    sourceOfSupplyId: p.sourceOfSupplyId,
    gstin: p.gstin,
    pan: p.pan,
    paymentTermId: p.paymentTermId,
    currencyCode: p.currencyCode,
    vendorType: p.vendorType,
    msmeRegistered: p.msmeRegistered,
    msmeNumber: p.msmeRegistered ? p.msmeNumber : null,
    tdsApplicable: p.tdsApplicable,
    tdsSectionCode: p.tdsApplicable ? p.tdsSectionCode : null,
    tcsApplicable: p.tcsApplicable,
    taxConfig: p.taxConfig as Prisma.InputJsonValue,
    openingBalance: p.openingBalance,
    remarks: p.remarks,
  };
}

export const VENDOR_SCALAR_KEYS = [
  'displayName', 'companyName', 'salutation', 'firstName', 'lastName', 'email',
  'workPhoneCountryCode', 'workPhone', 'mobileCountryCode', 'mobile', 'language', 'website',
  'gstTreatmentId', 'sourceOfSupplyId', 'gstin', 'pan', 'paymentTermId', 'currencyCode', 'vendorType',
  'msmeRegistered', 'msmeNumber', 'tdsApplicable', 'tdsSectionCode', 'tcsApplicable', 'taxConfig',
  'openingBalance', 'remarks',
] as const;

export function addressData(organizationId: string, a: VendorAddressPayload) {
  return {
    organizationId,
    type: a.type,
    attention: a.attention,
    countryCode: a.countryCode,
    addressLine1: a.addressLine1,
    addressLine2: a.addressLine2,
    city: a.city,
    state: a.state,
    stateCode: a.stateCode,
    postalCode: a.postalCode,
    phone: a.phone,
    fax: a.fax,
    isPrimary: a.isPrimary,
  };
}
export const ADDRESS_KEYS = ['type', 'attention', 'countryCode', 'addressLine1', 'addressLine2', 'city', 'state', 'stateCode', 'postalCode', 'phone', 'fax', 'isPrimary'] as const;

export function contactData(organizationId: string, c: VendorContactPayload) {
  return {
    organizationId,
    salutation: c.salutation,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email ? c.email.toLowerCase() : null,
    workPhone: c.workPhone,
    mobile: c.mobile,
    designation: c.designation,
    department: c.department,
    isPrimary: c.isPrimary,
  };
}
export const CONTACT_KEYS = ['salutation', 'firstName', 'lastName', 'email', 'workPhone', 'mobile', 'designation', 'department', 'isPrimary'] as const;

export function bankAccountData(organizationId: string, b: VendorBankAccountPayload & { accountNumber: string }) {
  return {
    organizationId,
    bankName: b.bankName,
    accountHolderName: b.accountHolderName,
    accountNumberEncrypted: encryptSecret(b.accountNumber),
    accountNumberLast4: b.accountNumber.slice(-4),
    ifsc: b.ifsc,
    branch: b.branch,
    accountType: b.accountType,
    isPrimary: b.isPrimary,
  };
}
export const BANK_KEYS = ['bankName', 'accountHolderName', 'accountNumberLast4', 'ifsc', 'branch', 'accountType', 'isPrimary'] as const;

export function customFieldRows(organizationId: string, values: VendorCustomFieldValuePayload[]) {
  return values
    .filter((cf) => cf.value !== null && cf.value !== '')
    .map((cf) => ({ organizationId, fieldId: cf.fieldId, value: cf.value as Prisma.InputJsonValue }));
}

export function reportingTagRows(organizationId: string, values: VendorReportingTagValuePayload[]) {
  return values
    .filter((rt): rt is { tagId: string; optionId: string } => Boolean(rt.optionId))
    .map((rt) => ({ organizationId, tagId: rt.tagId, optionId: rt.optionId }));
}
