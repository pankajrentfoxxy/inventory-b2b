/**
 * Shapes returned by svc-party (`/v1/party/suppliers|customers`). The create / edit / detail screens
 * use the vendor-form shaped endpoints (`/form`), whose field names mirror the legacy vendor module;
 * the list and the pickers use the plain serialized party.
 */
import { PARTY_GST_TREATMENT_LABELS, PARTY_GST_TREATMENTS, type PartyGstTreatment } from '@b2b/shared';

export type PartyType = 'SUPPLIER' | 'CUSTOMER';
export type PartyStatus = 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
export type GstTreatment = PartyGstTreatment;
export type AddressKind = 'BILLING' | 'SHIPPING';

export const GST_TREATMENTS = PARTY_GST_TREATMENTS;
export const GST_TREATMENT_LABELS: Record<GstTreatment, string> = PARTY_GST_TREATMENT_LABELS;

/**
 * `path` is the svc-party API segment; `route` is the browser URL segment. Suppliers are called
 * "vendors" in the UI (business wording); the API keeps its SUPPLIER party type.
 */
export const PARTY_META: Record<PartyType, { path: 'suppliers' | 'customers'; route: 'vendors' | 'customers'; singular: string; plural: string; view: string[]; manage: string; customFieldEntity: 'SUPPLIER' | 'CUSTOMER' }> = {
  SUPPLIER: { path: 'suppliers', route: 'vendors', singular: 'Vendor', plural: 'Vendors', view: ['supplier.view', 'purchase.view', 'grn.view', 'billing.view'], manage: 'supplier.manage', customFieldEntity: 'SUPPLIER' },
  CUSTOMER: { path: 'customers', route: 'customers', singular: 'Customer', plural: 'Customers', view: ['customer.view', 'sales.view', 'dispatch.view', 'billing.view'], manage: 'customer.manage', customFieldEntity: 'CUSTOMER' },
};

export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
}

/* ---- list row (plain serializer) ---------------------------------------------------- */

export interface PartyListAddress {
  id: string;
  kind: AddressKind;
  line1: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  isDefault: boolean;
}
export interface PartyListContact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}
export interface PartyListItem {
  id: string;
  code: string;
  legalName: string;
  displayName: string;
  gstTreatment: GstTreatment;
  gstin: string | null;
  stateCode: string | null;
  status: PartyStatus;
  blockedReason: string | null;
  email: string | null;
  phone: string | null;
  paymentTermId: string | null;
  addresses: PartyListAddress[];
  contacts: PartyListContact[];
}

export interface PartyListParams {
  q?: string;
  status?: string;
  gstTreatment?: string;
  limit?: number;
  cursor?: string;
}

/** Snapshot returned by the lookups endpoint (pickers on procurement / sales documents). */
export interface PartySnapshot {
  id: string;
  tenantId: string;
  partyType: PartyType;
  code: string;
  legalName: string;
  displayName: string;
  gstTreatment: GstTreatment;
  gstin: string | null;
  pan: string | null;
  stateCode: string | null;
  billingAddress: { attention: string | null; line1: string; line2: string | null; city: string; state: string | null; stateCode: string; pincode: string; country: string; phone: string | null } | null;
  paymentTermId: string | null;
  status: PartyStatus;
  blockedReason: string | null;
  version: number;
}

/* ---- form view (GET/PUT .../:id/form) --------------------------------------------- */

export interface PartyAddress {
  id: string;
  type: AddressKind;
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
}

export interface PartyContact {
  id: string;
  salutation: string | null;
  firstName: string;
  lastName: string | null;
  email: string | null;
  workPhone: string | null;
  mobile: string | null;
  designation: string | null;
  department: string | null;
  isPrimary: boolean;
}

export interface PartyBankAccount {
  id: string;
  bankName: string;
  accountHolderName: string;
  accountNumberMasked: string;
  ifsc: string;
  branch: string | null;
  accountType: string;
  isPrimary: boolean;
}

export interface PartyDetail {
  id: string;
  partyType: PartyType;
  code: string;
  status: PartyStatus;
  blockedReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  salutation: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  displayName: string;
  email: string | null;
  workPhoneCountryCode: string | null;
  workPhone: string | null;
  mobileCountryCode: string | null;
  mobile: string | null;
  language: string | null;
  website: string | null;
  gstTreatment: GstTreatment;
  sourceOfSupply: string | null;
  gstin: string | null;
  pan: string | null;
  paymentTermId: string | null;
  currencyCode: string | null;
  vendorType: string | null;
  msmeRegistered: boolean;
  msmeNumber: string | null;
  tdsApplicable: boolean;
  tdsSectionCode: string | null;
  tcsApplicable: boolean;
  openingBalance: number | null;
  remarks: string | null;
  addresses: PartyAddress[];
  contacts: PartyContact[];
  bankAccounts: PartyBankAccount[];
  customFields: { fieldId: string; value: unknown }[];
  /** Present on GET .../:id/form (services holding documents for this party). */
  referencedBy?: string[];
}

/* ---- form options (replaces the legacy /vendors/form-options) ------------------------ */

export type CustomFieldKind = 'TEXT' | 'NUMBER' | 'DATE' | 'DROPDOWN' | 'BOOLEAN';

export interface PartyFormOptions {
  gstTreatments: { value: GstTreatment; label: string; requiresGstin: boolean }[];
  sourcesOfSupply: readonly { code: string; short: string; name: string }[];
  paymentTerms: { id: string; name: string; days: number; isDefault: boolean }[];
  currencies: { code: string; name: string; symbol: string }[];
  customFields: { id: string; key: string; label: string; fieldType: CustomFieldKind; options: string[]; isRequired: boolean }[];
  salutations: readonly string[];
  languages: readonly { code: string; label: string }[];
  countries: readonly { code: string; name: string; dialCode: string }[];
  indianStates: readonly { code: string; short: string; name: string }[];
  vendorTypes: { value: string; label: string }[];
  bankAccountTypes: { value: string; label: string }[];
}

/* ---- GST lookup (GET /public/gst/lookup) ------------------------------------------- */

export interface GstAddress {
  nature: string | null;
  addressLine1: string;
  addressLine2: string;
  city: string;
  district: string | null;
  state: string;
  stateCode: string | null;
  postalCode: string;
  isPrincipal: boolean;
}

export interface GstLookupResult {
  gstin: string;
  legalName: string | null;
  tradeName: string | null;
  status: string | null;
  taxpayerType: string | null;
  constitution: string | null;
  registeredDate: string | null;
  eInvoiceApplicable: boolean | null;
  natureOfBusiness: string[];
  stateCode: string | null;
  suggestedGstTreatmentCode: string | null;
  addresses: GstAddress[];
  source: string;
}

/* ---- related documents / audit ------------------------------------------------------ */

export interface PartyPurchaseOrderRow {
  id: string;
  number: string;
  status: string;
  orderDate: string;
  expectedDate: string | null;
  currency: string;
  total: number;
}

