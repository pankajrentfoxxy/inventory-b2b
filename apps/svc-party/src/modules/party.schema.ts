import { z } from 'zod';
import { bankAccountNumberField, gstinField, ifscField, optionalEmail, optionalText, panField, phoneField, requiredBusinessName, requiredPersonName, requiredText, pincodeField } from '@b2b/shared';

export const GST_TREATMENTS = ['REGISTERED', 'UNREGISTERED', 'COMPOSITION', 'CONSUMER', 'OVERSEAS', 'SEZ'] as const;
export const GSTIN_REQUIRED_TREATMENTS = ['REGISTERED', 'COMPOSITION', 'SEZ'] as const;

export const addressSchema = z.object({
  kind: z.enum(['BILLING', 'SHIPPING']),
  attention: optionalText(100, {}, 'Attention'),
  line1: requiredText('Address line 1', 200),
  line2: optionalText(200, {}, 'Address line 2'),
  city: requiredText('City', 100),
  state: optionalText(100, {}, 'State'),
  stateCode: z.string().length(2, 'State code must be 2 digits'),
  pincode: pincodeField({ required: true }),
  country: z.string().length(2).default('IN'),
  phone: phoneField({ required: false }),
  isDefault: z.boolean().default(false),
});
export type AddressInput = z.output<typeof addressSchema>;

export const contactSchema = z.object({
  name: requiredPersonName('Name', { min: 2 }),
  email: optionalEmail({ lowercase: true }),
  phone: phoneField({ required: false }),
  designation: optionalText(100, {}, 'Designation'),
  isPrimary: z.boolean().default(false),
});

export const bankAccountSchema = z.object({
  bankName: requiredText('Bank name', 100),
  accountHolder: requiredText('Account holder', 150),
  accountNumber: bankAccountNumberField().transform((v) => v ?? ''),
  ifsc: ifscField().transform((v) => v ?? ''),
  branch: optionalText(100, {}, 'Branch'),
  accountType: z.enum(['SAVINGS', 'CURRENT', 'CASH_CREDIT', 'OVERDRAFT', 'OTHER']).default('CURRENT'),
  isPrimary: z.boolean().default(false),
});

export const partySchema = z.object({
  code: optionalText(40, { transform: 'upper' }, 'Code'),
  legalName: requiredBusinessName('Legal name', { min: 2, max: 200 }),
  displayName: requiredBusinessName('Display name', { min: 2, max: 150 }),
  gstTreatment: z.enum(GST_TREATMENTS).default('UNREGISTERED'),
  gstin: gstinField({ required: false }),
  pan: panField({ required: false }),
  paymentTermId: z.string().uuid().nullable().optional(),
  creditLimit: z.number().nonnegative().nullable().optional(),
  creditDays: z.number().int().nonnegative().nullable().optional(),
  email: optionalEmail({ lowercase: true }),
  phone: phoneField({ required: false }),
  website: optionalText(200, {}, 'Website'),
  remarks: optionalText(2000, { multiline: true }, 'Remarks'),
  customFields: z.record(z.unknown()).default({}),
  addresses: z.array(addressSchema).default([]),
  contacts: z.array(contactSchema).default([]),
  bankAccounts: z.array(bankAccountSchema).default([]),
});
export type PartyInput = z.output<typeof partySchema>;
export const partyPatchSchema = partySchema.omit({ code: true, addresses: true, contacts: true, bankAccounts: true }).partial();

export const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'BLOCKED']).optional(),
  gstTreatment: z.enum(GST_TREATMENTS).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export const reasonSchema = z.object({ reason: requiredText('Reason', 500, { min: 3 }) });
export const statusSchema = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) });
