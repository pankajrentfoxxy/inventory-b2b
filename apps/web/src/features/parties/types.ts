/** Shapes returned by svc-party (`/v1/party/suppliers|customers`). Mirrors party.service.ts serializers. */

export type PartyType = 'SUPPLIER' | 'CUSTOMER';
export type PartyStatus = 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
export type GstTreatment = 'REGISTERED' | 'UNREGISTERED' | 'COMPOSITION' | 'CONSUMER' | 'OVERSEAS' | 'SEZ';
export type AddressKind = 'BILLING' | 'SHIPPING';
export type BankAccountType = 'SAVINGS' | 'CURRENT' | 'CASH_CREDIT' | 'OVERDRAFT' | 'OTHER';

export const GST_TREATMENTS: GstTreatment[] = ['REGISTERED', 'UNREGISTERED', 'COMPOSITION', 'CONSUMER', 'OVERSEAS', 'SEZ'];
export const GST_TREATMENT_LABELS: Record<GstTreatment, string> = {
  REGISTERED: 'Registered business - regular',
  COMPOSITION: 'Registered business - composition',
  UNREGISTERED: 'Unregistered business',
  CONSUMER: 'Consumer',
  OVERSEAS: 'Overseas',
  SEZ: 'Special Economic Zone',
};
/** Treatments for which the service insists on a GSTIN (party.schema.ts GSTIN_REQUIRED_TREATMENTS). */
export const GSTIN_REQUIRED_TREATMENTS: GstTreatment[] = ['REGISTERED', 'COMPOSITION', 'SEZ'];

/** Route path segment and copy per party type. */
export const PARTY_META: Record<PartyType, { path: 'suppliers' | 'customers'; singular: string; plural: string; view: string[]; manage: string }> = {
  SUPPLIER: { path: 'suppliers', singular: 'Supplier', plural: 'Suppliers', view: ['supplier.view', 'purchase.view', 'grn.view', 'billing.view'], manage: 'supplier.manage' },
  CUSTOMER: { path: 'customers', singular: 'Customer', plural: 'Customers', view: ['customer.view', 'sales.view', 'dispatch.view', 'billing.view'], manage: 'customer.manage' },
};

export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
}

export interface PartyAddress {
  id: string;
  kind: AddressKind;
  attention: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  stateCode: string;
  pincode: string;
  country: string;
  phone: string | null;
  isDefault: boolean;
}
export interface PartyContact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  designation: string | null;
  isPrimary: boolean;
}
/** `accountNumber` is masked (`****1234`) unless it came from the reveal endpoint. */
export interface PartyBankAccount {
  id: string;
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  ifsc: string;
  branch: string | null;
  accountType: BankAccountType;
  isPrimary: boolean;
}

/** Snapshot published in events and returned by the lookups endpoint. */
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
  billingAddress: Omit<PartyAddress, 'id' | 'kind' | 'isDefault'> | null;
  paymentTermId: string | null;
  status: PartyStatus;
  blockedReason: string | null;
  version: number;
}

export interface Party extends PartySnapshot {
  email: string | null;
  phone: string | null;
  website: string | null;
  creditLimit: number | null;
  creditDays: number | null;
  linkedPartyId: string | null;
  remarks: string | null;
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  addresses: PartyAddress[];
  contacts: PartyContact[];
  bankAccounts: PartyBankAccount[];
}

export interface PartyDetail extends Party {
  referencedBy: string[];
}

export interface PartyListParams {
  q?: string;
  status?: string;
  gstTreatment?: string;
  limit?: number;
  cursor?: string;
}

/* ---- payloads (party.schema.ts) ------------------------------------------------- */

export interface AddressPayload {
  kind: AddressKind;
  attention?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  state?: string | null;
  stateCode: string;
  pincode: string;
  country?: string;
  phone?: string | null;
  isDefault: boolean;
}
export interface ContactPayload {
  name: string;
  email?: string | null;
  phone?: string | null;
  designation?: string | null;
  isPrimary: boolean;
}
export interface BankAccountPayload {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  ifsc: string;
  branch?: string | null;
  accountType: BankAccountType;
  isPrimary: boolean;
}
export interface PartyPayload {
  code?: string | null;
  legalName: string;
  displayName: string;
  gstTreatment: GstTreatment;
  gstin?: string | null;
  pan?: string | null;
  paymentTermId?: string | null;
  creditLimit?: number | null;
  creditDays?: number | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  remarks?: string | null;
  addresses: AddressPayload[];
  contacts: ContactPayload[];
  bankAccounts: BankAccountPayload[];
}
/** PATCH body: code and the sub-resources are managed through their own endpoints. */
export type PartyPatch = Partial<Omit<PartyPayload, 'code' | 'addresses' | 'contacts' | 'bankAccounts'>>;
