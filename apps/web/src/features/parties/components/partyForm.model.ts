import { INDIAN_STATES } from '@b2b/shared';
import type { AddressKind, AddressPayload, BankAccountPayload, BankAccountType, ContactPayload, GstTreatment, Party, PartyPatch, PartyPayload } from '../types';

/** Form state is strings + booleans; payload builders convert at submit time. */
export interface AddressValues {
  kind: AddressKind;
  attention: string;
  line1: string;
  line2: string;
  city: string;
  stateCode: string;
  pincode: string;
  country: string;
  phone: string;
  isDefault: boolean;
}
export interface ContactValues {
  name: string;
  email: string;
  phone: string;
  designation: string;
  isPrimary: boolean;
}
export interface BankAccountValues {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  ifsc: string;
  branch: string;
  accountType: BankAccountType;
  isPrimary: boolean;
}
export interface PartyFormValues {
  code: string;
  legalName: string;
  displayName: string;
  gstTreatment: GstTreatment;
  gstin: string;
  pan: string;
  paymentTermId: string;
  creditLimit: string;
  creditDays: string;
  email: string;
  phone: string;
  website: string;
  remarks: string;
  addresses: AddressValues[];
  contacts: ContactValues[];
  bankAccounts: BankAccountValues[];
}

export const STATE_OPTIONS = INDIAN_STATES.map((s) => ({ value: s.code, label: `${s.code} - ${s.name}` }));
export const stateName = (code: string | null | undefined) => INDIAN_STATES.find((s) => s.code === code)?.name ?? null;

export const emptyAddress = (kind: AddressKind = 'BILLING', isDefault = false): AddressValues => ({ kind, attention: '', line1: '', line2: '', city: '', stateCode: '', pincode: '', country: 'IN', phone: '', isDefault });
export const emptyContact = (isPrimary = false): ContactValues => ({ name: '', email: '', phone: '', designation: '', isPrimary });
export const emptyBankAccount = (isPrimary = false): BankAccountValues => ({ bankName: '', accountHolder: '', accountNumber: '', ifsc: '', branch: '', accountType: 'CURRENT', isPrimary });

export function emptyParty(): PartyFormValues {
  return { code: '', legalName: '', displayName: '', gstTreatment: 'REGISTERED', gstin: '', pan: '', paymentTermId: '', creditLimit: '', creditDays: '', email: '', phone: '', website: '', remarks: '', addresses: [emptyAddress('BILLING', true)], contacts: [], bankAccounts: [] };
}

/** Basic fields only (edit modal): addresses / contacts / bank accounts are edited on the detail tabs. */
export function partyToValues(p: Party): PartyFormValues {
  return {
    code: p.code,
    legalName: p.legalName,
    displayName: p.displayName,
    gstTreatment: p.gstTreatment,
    gstin: p.gstin ?? '',
    pan: p.pan ?? '',
    paymentTermId: p.paymentTermId ?? '',
    creditLimit: p.creditLimit === null ? '' : String(p.creditLimit),
    creditDays: p.creditDays === null ? '' : String(p.creditDays),
    email: p.email ?? '',
    phone: p.phone ?? '',
    website: p.website ?? '',
    remarks: p.remarks ?? '',
    addresses: [],
    contacts: [],
    bankAccounts: [],
  };
}

const text = (v: string) => v.trim();
const opt = (v: string) => (v.trim() === '' ? null : v.trim());
const num = (v: string) => (v.trim() === '' ? null : Number(v));

export const toAddressPayload = (a: AddressValues): AddressPayload => ({ kind: a.kind, attention: opt(a.attention), line1: text(a.line1), line2: opt(a.line2), city: text(a.city), state: stateName(a.stateCode), stateCode: a.stateCode, pincode: text(a.pincode), country: text(a.country) || 'IN', phone: opt(a.phone), isDefault: a.isDefault });
export const toContactPayload = (c: ContactValues): ContactPayload => ({ name: text(c.name), email: opt(c.email), phone: opt(c.phone), designation: opt(c.designation), isPrimary: c.isPrimary });
export const toBankAccountPayload = (b: BankAccountValues): BankAccountPayload => ({ bankName: text(b.bankName), accountHolder: text(b.accountHolder), accountNumber: text(b.accountNumber), ifsc: text(b.ifsc), branch: opt(b.branch), accountType: b.accountType, isPrimary: b.isPrimary });

function basic(v: PartyFormValues): Omit<PartyPayload, 'code' | 'addresses' | 'contacts' | 'bankAccounts'> {
  return {
    legalName: text(v.legalName),
    displayName: text(v.displayName),
    gstTreatment: v.gstTreatment,
    gstin: opt(v.gstin),
    pan: opt(v.pan),
    paymentTermId: v.paymentTermId || null,
    creditLimit: num(v.creditLimit),
    creditDays: num(v.creditDays),
    email: opt(v.email),
    phone: opt(v.phone),
    website: opt(v.website),
    remarks: opt(v.remarks),
  };
}

export function toPartyPayload(v: PartyFormValues): PartyPayload {
  return { code: opt(v.code), ...basic(v), addresses: v.addresses.map(toAddressPayload), contacts: v.contacts.map(toContactPayload), bankAccounts: v.bankAccounts.map(toBankAccountPayload) };
}

/** Only the changed basic fields (PATCH + If-Match). */
export function toPartyPatch(v: PartyFormValues, current: Party): PartyPatch {
  const next = basic(v) as Record<string, unknown>;
  const before = current as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(next)) if (JSON.stringify(next[key]) !== JSON.stringify(before[key] ?? null)) patch[key] = next[key];
  return patch as PartyPatch;
}
