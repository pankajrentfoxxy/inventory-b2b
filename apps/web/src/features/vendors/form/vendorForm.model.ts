/**
 * Form model for VendorForm: string-based values for controlled inputs, plus mappers to/from
 * the API payload and a mapper from API validation errors to form field paths.
 */
import type { UseFormSetError } from 'react-hook-form';
import { DEFAULT_COUNTRY_CODE, DEFAULT_DIAL_CODE, DEFAULT_VENDOR_LANGUAGE, vendorCreateSchema, type VendorPayload } from '@b2b/shared';
import type { ApiError } from '../../../lib/api';
import { applyServerErrors as applyFieldErrors } from '../../../lib/validation';
import type { VendorDetail, VendorFormOptions } from '../types';

export interface AddressFormValues {
  id?: string | null;
  type: 'BILLING' | 'SHIPPING';
  attention: string;
  countryCode: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  stateCode: string;
  postalCode: string;
  phone: string;
  fax: string;
  isPrimary: boolean;
}

export interface ContactFormValues {
  id?: string | null;
  salutation: string;
  firstName: string;
  lastName: string;
  email: string;
  workPhone: string;
  mobile: string;
  designation: string;
  department: string;
  isPrimary: boolean;
}

export interface BankFormValues {
  id?: string | null;
  bankName: string;
  accountHolderName: string;
  accountNumber: string;
  /** Read-only hint shown for existing accounts (server never returns the full number). */
  accountNumberMasked?: string;
  ifsc: string;
  branch: string;
  accountType: string;
  isPrimary: boolean;
}

export interface VendorFormValues {
  salutation: string;
  firstName: string;
  lastName: string;
  companyName: string;
  displayName: string;
  email: string;
  workPhoneCountryCode: string;
  workPhone: string;
  mobileCountryCode: string;
  mobile: string;
  language: string;
  website: string;
  gstTreatmentId: string;
  sourceOfSupplyId: string;
  gstin: string;
  pan: string;
  paymentTermId: string;
  currencyCode: string;
  vendorType: string;
  msmeRegistered: boolean;
  msmeNumber: string;
  tdsApplicable: boolean;
  tdsSectionCode: string;
  tcsApplicable: boolean;
  openingBalance: string;
  remarks: string;
  addresses: AddressFormValues[];
  contacts: ContactFormValues[];
  bankAccounts: BankFormValues[];
  customFields: { fieldId: string; value: string | number | boolean | null }[];
  reportingTags: { tagId: string; optionId: string }[];
  /** UI-only helper; stripped by the zod schema. */
  shippingSameAsBilling: boolean;
}

export const emptyAddress = (type: 'BILLING' | 'SHIPPING', isPrimary = false): AddressFormValues => ({
  id: null,
  type,
  attention: '',
  countryCode: DEFAULT_COUNTRY_CODE,
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  stateCode: '',
  postalCode: '',
  phone: '',
  fax: '',
  isPrimary,
});

export const emptyContact = (isPrimary = false): ContactFormValues => ({
  id: null,
  salutation: '',
  firstName: '',
  lastName: '',
  email: '',
  workPhone: '',
  mobile: '',
  designation: '',
  department: '',
  isPrimary,
});

export const emptyBankAccount = (isPrimary = false): BankFormValues => ({
  id: null,
  bankName: '',
  accountHolderName: '',
  accountNumber: '',
  ifsc: '',
  branch: '',
  accountType: 'CURRENT',
  isPrimary,
});

export function defaultVendorValues(options: VendorFormOptions): VendorFormValues {
  return {
    salutation: '',
    firstName: '',
    lastName: '',
    companyName: '',
    displayName: '',
    email: '',
    workPhoneCountryCode: DEFAULT_DIAL_CODE,
    workPhone: '',
    mobileCountryCode: DEFAULT_DIAL_CODE,
    mobile: '',
    language: DEFAULT_VENDOR_LANGUAGE,
    website: '',
    gstTreatmentId: '',
    sourceOfSupplyId: '',
    gstin: '',
    pan: '',
    paymentTermId: options.paymentTerms.find((p) => p.isDefault)?.id ?? '',
    currencyCode: 'INR',
    vendorType: '',
    msmeRegistered: false,
    msmeNumber: '',
    tdsApplicable: false,
    tdsSectionCode: '',
    tcsApplicable: false,
    openingBalance: '',
    remarks: '',
    addresses: [emptyAddress('BILLING', true), emptyAddress('SHIPPING', true)],
    contacts: [],
    bankAccounts: [],
    customFields: options.customFields.map((f) => ({ fieldId: f.id, value: f.fieldType === 'BOOLEAN' ? false : null })),
    reportingTags: options.reportingTags.map((t) => ({ tagId: t.id, optionId: '' })),
    shippingSameAsBilling: false,
  };
}

export function vendorToFormValues(v: VendorDetail, options: VendorFormOptions): VendorFormValues {
  const base = defaultVendorValues(options);
  const addresses: AddressFormValues[] = v.addresses.map((a) => ({
    id: a.id,
    type: a.type,
    attention: a.attention ?? '',
    countryCode: a.countryCode,
    addressLine1: a.addressLine1 ?? '',
    addressLine2: a.addressLine2 ?? '',
    city: a.city ?? '',
    state: a.state ?? '',
    stateCode: a.stateCode ?? '',
    postalCode: a.postalCode ?? '',
    phone: a.phone ?? '',
    fax: a.fax ?? '',
    isPrimary: a.isPrimary,
  }));
  if (!addresses.some((a) => a.type === 'BILLING')) addresses.push(emptyAddress('BILLING', true));
  if (!addresses.some((a) => a.type === 'SHIPPING')) addresses.push(emptyAddress('SHIPPING', true));

  const cfValues = new Map(v.customFields.map((c) => [c.fieldId, c.value]));
  const tagValues = new Map(v.reportingTags.map((t) => [t.tagId, t.optionId]));

  return {
    ...base,
    salutation: v.salutation ?? '',
    firstName: v.firstName ?? '',
    lastName: v.lastName ?? '',
    companyName: v.companyName ?? '',
    displayName: v.displayName,
    email: v.email ?? '',
    workPhoneCountryCode: v.workPhoneCountryCode ?? DEFAULT_DIAL_CODE,
    workPhone: v.workPhone ?? '',
    mobileCountryCode: v.mobileCountryCode ?? DEFAULT_DIAL_CODE,
    mobile: v.mobile ?? '',
    language: v.language,
    website: v.website ?? '',
    gstTreatmentId: v.gstTreatmentId ?? '',
    sourceOfSupplyId: v.sourceOfSupplyId ?? '',
    gstin: v.gstin ?? '',
    pan: v.pan ?? '',
    paymentTermId: v.paymentTermId ?? '',
    currencyCode: v.currencyCode,
    vendorType: v.vendorType ?? '',
    msmeRegistered: v.msmeRegistered,
    msmeNumber: v.msmeNumber ?? '',
    tdsApplicable: v.tdsApplicable,
    tdsSectionCode: v.tdsSectionCode ?? '',
    tcsApplicable: v.tcsApplicable,
    openingBalance: v.openingBalance === null ? '' : String(v.openingBalance),
    remarks: v.remarks ?? '',
    addresses,
    contacts: v.contacts.map((c) => ({
      id: c.id,
      salutation: c.salutation ?? '',
      firstName: c.firstName,
      lastName: c.lastName ?? '',
      email: c.email ?? '',
      workPhone: c.workPhone ?? '',
      mobile: c.mobile ?? '',
      designation: c.designation ?? '',
      department: c.department ?? '',
      isPrimary: c.isPrimary,
    })),
    bankAccounts: v.bankAccounts.map((b) => ({
      id: b.id,
      bankName: b.bankName,
      accountHolderName: b.accountHolderName,
      accountNumber: '',
      accountNumberMasked: b.accountNumberMasked,
      ifsc: b.ifsc,
      branch: b.branch ?? '',
      accountType: b.accountType,
      isPrimary: b.isPrimary,
    })),
    customFields: options.customFields.map((f) => ({
      fieldId: f.id,
      value: cfValues.has(f.id) ? (cfValues.get(f.id) as string | number | boolean | null) : f.fieldType === 'BOOLEAN' ? false : null,
    })),
    reportingTags: options.reportingTags.map((t) => ({ tagId: t.id, optionId: tagValues.get(t.id) ?? '' })),
    shippingSameAsBilling: false,
  };
}

/** Runs the shared zod schema to produce the exact payload the API expects (trimmed, normalised). */
export function toVendorPayload(values: VendorFormValues): VendorPayload {
  const prepared: VendorFormValues = { ...values };
  if (values.shippingSameAsBilling) {
    const billing = values.addresses.find((a) => a.type === 'BILLING' && a.isPrimary) ?? values.addresses.find((a) => a.type === 'BILLING');
    const shippingIdx = values.addresses.findIndex((a) => a.type === 'SHIPPING' && a.isPrimary);
    if (billing) {
      const copy = { ...billing, id: shippingIdx >= 0 ? values.addresses[shippingIdx].id : null, type: 'SHIPPING' as const, isPrimary: true };
      prepared.addresses = shippingIdx >= 0 ? values.addresses.map((a, i) => (i === shippingIdx ? copy : a)) : [...values.addresses, copy];
    }
  }
  return vendorCreateSchema.parse(prepared);
}

export type VendorFormTab = 'other' | 'address' | 'contacts' | 'bank' | 'custom' | 'tags' | 'remarks';

const OTHER_FIELDS = new Set(['gstTreatmentId', 'sourceOfSupplyId', 'gstin', 'pan', 'paymentTermId', 'currencyCode', 'vendorType', 'msmeRegistered', 'msmeNumber', 'tdsApplicable', 'tdsSectionCode', 'tcsApplicable', 'openingBalance', 'website']);

export function tabForPath(path: string): VendorFormTab | 'basic' {
  const root = path.split('.')[0];
  if (root === 'addresses') return 'address';
  if (root === 'contacts') return 'contacts';
  if (root === 'bankAccounts') return 'bank';
  if (root === 'customFields') return 'custom';
  if (root === 'reportingTags') return 'tags';
  if (root === 'remarks') return 'remarks';
  if (OTHER_FIELDS.has(root)) return 'other';
  return 'basic';
}

/** Applies API validation details to the form; returns the first offending tab and any unmapped messages. */
export function applyServerErrors(error: ApiError, setError: UseFormSetError<VendorFormValues>) {
  const unmapped = applyFieldErrors(setError, error);
  const firstPath = error.details.find((d) => d.path)?.path;
  const firstTab: VendorFormTab | 'basic' | null = firstPath ? tabForPath(firstPath) : null;
  return { firstTab, unmapped };
}
