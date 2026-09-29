import type { Prisma } from '@prisma/client';
import { maskAccountNumber } from '@b2b/shared';

export const vendorDetailInclude = {
  gstTreatment: { select: { id: true, code: true, name: true, requiresGstin: true } },
  sourceOfSupply: { select: { id: true, code: true, name: true, shortCode: true } },
  paymentTerm: { select: { id: true, name: true, days: true } },
  currency: { select: { code: true, name: true, symbol: true } },
  addresses: { orderBy: [{ type: 'asc' }, { isPrimary: 'desc' }, { createdAt: 'asc' }] },
  contacts: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
  bankAccounts: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
  customFields: { include: { field: true } },
  reportingTags: { include: { tag: { select: { id: true, name: true } }, option: { select: { id: true, name: true } } } },
  _count: { select: { notes: true, documents: true } },
} satisfies Prisma.VendorInclude;

export type VendorDetailRecord = Prisma.VendorGetPayload<{ include: typeof vendorDetailInclude }>;

export const vendorListInclude = {
  gstTreatment: { select: { id: true, name: true } },
  sourceOfSupply: { select: { id: true, name: true, shortCode: true } },
  contacts: { where: { isPrimary: true }, take: 1 },
} satisfies Prisma.VendorInclude;

export type VendorListRecord = Prisma.VendorGetPayload<{ include: typeof vendorListInclude }>;

export function fullName(p: { salutation?: string | null; firstName?: string | null; lastName?: string | null }) {
  return [p.salutation, p.firstName, p.lastName].filter(Boolean).join(' ').trim() || null;
}

export function formatPhone(countryCode: string | null | undefined, number: string | null | undefined) {
  if (!number) return null;
  return countryCode ? `${countryCode} ${number}` : number;
}

export function serializeBankAccount(b: {
  id: string;
  bankName: string;
  accountHolderName: string;
  accountNumberLast4: string;
  ifsc: string;
  branch: string | null;
  accountType: string;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: b.id,
    bankName: b.bankName,
    accountHolderName: b.accountHolderName,
    accountNumberMasked: maskAccountNumber(b.accountNumberLast4),
    ifsc: b.ifsc,
    branch: b.branch,
    accountType: b.accountType,
    isPrimary: b.isPrimary,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

export function serializeVendorListItem(v: VendorListRecord) {
  const primaryContactPerson = v.contacts[0];
  const primaryContact =
    fullName(v) ??
    (primaryContactPerson ? fullName(primaryContactPerson) : null);
  return {
    id: v.id,
    displayName: v.displayName,
    companyName: v.companyName,
    primaryContact,
    email: v.email ?? primaryContactPerson?.email ?? null,
    workPhone: formatPhone(v.workPhoneCountryCode, v.workPhone),
    mobile: formatPhone(v.mobileCountryCode, v.mobile),
    gstin: v.gstin,
    gstTreatment: v.gstTreatment,
    sourceOfSupply: v.sourceOfSupply,
    status: v.status,
    vendorType: v.vendorType,
    currencyCode: v.currencyCode,
    openingBalance: v.openingBalance === null ? null : Number(v.openingBalance),
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

export function serializeVendorDetail(v: VendorDetailRecord) {
  return {
    id: v.id,
    organizationId: v.organizationId,
    displayName: v.displayName,
    companyName: v.companyName,
    salutation: v.salutation,
    firstName: v.firstName,
    lastName: v.lastName,
    primaryContact: fullName(v),
    email: v.email,
    workPhoneCountryCode: v.workPhoneCountryCode,
    workPhone: v.workPhone,
    mobileCountryCode: v.mobileCountryCode,
    mobile: v.mobile,
    language: v.language,
    website: v.website,
    gstTreatmentId: v.gstTreatmentId,
    gstTreatment: v.gstTreatment,
    sourceOfSupplyId: v.sourceOfSupplyId,
    sourceOfSupply: v.sourceOfSupply,
    gstin: v.gstin,
    pan: v.pan,
    paymentTermId: v.paymentTermId,
    paymentTerm: v.paymentTerm,
    currencyCode: v.currencyCode,
    currency: v.currency,
    vendorType: v.vendorType,
    msmeRegistered: v.msmeRegistered,
    msmeNumber: v.msmeNumber,
    tdsApplicable: v.tdsApplicable,
    tdsSectionCode: v.tdsSectionCode,
    tcsApplicable: v.tcsApplicable,
    taxConfig: v.taxConfig,
    openingBalance: v.openingBalance === null ? null : Number(v.openingBalance),
    status: v.status,
    remarks: v.remarks,
    addresses: v.addresses,
    contacts: v.contacts,
    bankAccounts: v.bankAccounts.map(serializeBankAccount),
    customFields: v.customFields.map((cf) => ({
      fieldId: cf.fieldId,
      key: cf.field.key,
      label: cf.field.label,
      fieldType: cf.field.fieldType,
      value: cf.value,
    })),
    reportingTags: v.reportingTags.map((t) => ({
      tagId: t.tagId,
      tagName: t.tag.name,
      optionId: t.optionId,
      optionName: t.option.name,
    })),
    counts: { notes: v._count.notes, documents: v._count.documents },
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    createdById: v.createdById,
    updatedById: v.updatedById,
  };
}

export type VendorDetailDto = ReturnType<typeof serializeVendorDetail>;
export type VendorListItemDto = ReturnType<typeof serializeVendorListItem>;
