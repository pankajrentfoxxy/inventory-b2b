import type { VendorStatus } from '@b2b/shared';

export interface VendorListItem {
  id: string;
  displayName: string;
  companyName: string | null;
  primaryContact: string | null;
  email: string | null;
  workPhone: string | null;
  mobile: string | null;
  gstin: string | null;
  gstTreatment: { id: string; name: string } | null;
  sourceOfSupply: { id: string; name: string; shortCode: string | null } | null;
  status: VendorStatus;
  vendorType: string | null;
  currencyCode: string;
  openingBalance: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface VendorListResponse {
  data: VendorListItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  counts: { ALL: number; ACTIVE: number; INACTIVE: number };
}

export interface VendorAddress {
  id: string;
  type: 'BILLING' | 'SHIPPING';
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

export interface VendorContact {
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

export interface VendorBankAccount {
  id: string;
  bankName: string;
  accountHolderName: string;
  accountNumberMasked: string;
  ifsc: string;
  branch: string | null;
  accountType: string;
  isPrimary: boolean;
}

export interface VendorDetail {
  id: string;
  organizationId: string;
  displayName: string;
  companyName: string | null;
  salutation: string | null;
  firstName: string | null;
  lastName: string | null;
  primaryContact: string | null;
  email: string | null;
  workPhoneCountryCode: string | null;
  workPhone: string | null;
  mobileCountryCode: string | null;
  mobile: string | null;
  language: string;
  website: string | null;
  gstTreatmentId: string | null;
  gstTreatment: { id: string; code: string; name: string; requiresGstin: boolean } | null;
  sourceOfSupplyId: string | null;
  sourceOfSupply: { id: string; code: string; name: string; shortCode: string | null } | null;
  gstin: string | null;
  pan: string | null;
  paymentTermId: string | null;
  paymentTerm: { id: string; name: string; days: number } | null;
  currencyCode: string;
  currency: { code: string; name: string; symbol: string };
  vendorType: string | null;
  msmeRegistered: boolean;
  msmeNumber: string | null;
  tdsApplicable: boolean;
  tdsSectionCode: string | null;
  tcsApplicable: boolean;
  taxConfig: Record<string, unknown>;
  openingBalance: number | null;
  status: VendorStatus;
  remarks: string | null;
  addresses: VendorAddress[];
  contacts: VendorContact[];
  bankAccounts: VendorBankAccount[];
  customFields: { fieldId: string; key: string; label: string; fieldType: string; value: unknown }[];
  reportingTags: { tagId: string; tagName: string; optionId: string; optionName: string }[];
  counts: { notes: number; documents: number };
  createdAt: string;
  updatedAt: string;
}

export interface VendorActivityItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  userId: string | null;
  userName: string | null;
  summary: string | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  createdAt: string;
}

export interface VendorNote {
  id: string;
  body: string;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface VendorDocument {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByName: string | null;
  createdAt: string;
}

export interface VendorTransactions {
  vendorId: string;
  currencyCode: string;
  summary: { openingBalance: number | null; outstandingPayables: number | null; unusedCredits: number | null };
  modules: Record<'purchaseOrders' | 'purchaseReceives' | 'bills' | 'paymentsMade' | 'vendorCredits' | 'returns', { available: boolean; items: unknown[]; total: number }>;
}

export interface VendorFormOptions {
  gstTreatments: { id: string; code: string; name: string; description: string | null; requiresGstin: boolean }[];
  sourcesOfSupply: { id: string; code: string; shortCode: string | null; name: string; countryCode: string }[];
  paymentTerms: { id: string; name: string; days: number; isDefault: boolean }[];
  currencies: { code: string; name: string; symbol: string }[];
  customFields: { id: string; key: string; label: string; fieldType: 'TEXT' | 'NUMBER' | 'DATE' | 'DROPDOWN' | 'BOOLEAN'; options: string[]; isRequired: boolean }[];
  reportingTags: { id: string; name: string; options: { id: string; name: string }[] }[];
  salutations: readonly string[];
  languages: readonly { code: string; label: string }[];
  countries: readonly { code: string; name: string; dialCode: string }[];
  indianStates: readonly { code: string; short: string; name: string }[];
  vendorTypes: { value: string; label: string }[];
  bankAccountTypes: { value: string; label: string }[];
}

export interface Paginated<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}
