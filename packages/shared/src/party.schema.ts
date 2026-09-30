/**
 * Party (vendor / customer) form for the platform services (svc-party). It mirrors the legacy vendor
 * form field for field (vendor.schema.ts): same basic info, other details, addresses, contact
 * persons, bank details, custom fields and remarks, and the same cross-field rules. Differences:
 *  - GST treatment and source of supply are platform values (an enum and a GST state code), not
 *    legacy master ids;
 *  - no reporting tags (the platform has no tag master);
 *  - vendor-only fields (vendor type, MSME, TDS) are ignored for customers by the service.
 */
import { z } from 'zod';
import { DEFAULT_VENDOR_LANGUAGE, INDIAN_STATES, VENDOR_TYPES } from './constants.js';
import {
  dialCodeField,
  dialCodePhoneField,
  gstinField,
  optionalAmountField,
  optionalBusinessName,
  optionalEmail,
  optionalEnum,
  optionalNotes,
  optionalPersonName,
  optionalText,
  optionalUuid,
  panField,
  refineMobileForDialCode,
  refinePhoneForDialCode,
  requiredBusinessName,
  urlField,
} from './validation/fields.js';
import { isBlankAddress, vendorAddressSchema, vendorBankAccountSchema, vendorContactSchema, vendorCustomFieldValueSchema } from './vendor.schema.js';

export const PARTY_GST_TREATMENTS = ['REGISTERED', 'COMPOSITION', 'UNREGISTERED', 'CONSUMER', 'OVERSEAS', 'SEZ'] as const;
export type PartyGstTreatment = (typeof PARTY_GST_TREATMENTS)[number];
export const PARTY_GSTIN_REQUIRED_TREATMENTS: readonly PartyGstTreatment[] = ['REGISTERED', 'COMPOSITION', 'SEZ'];
export const PARTY_GST_TREATMENT_LABELS: Record<PartyGstTreatment, string> = {
  REGISTERED: 'Registered Business - Regular',
  COMPOSITION: 'Registered Business - Composition',
  UNREGISTERED: 'Unregistered Business',
  CONSUMER: 'Consumer',
  OVERSEAS: 'Overseas',
  SEZ: 'Special Economic Zone',
};
/** Legacy GST treatment master codes (and the GST lookup suggestion) mapped to the platform values. */
export const LEGACY_GST_TREATMENT_TO_PARTY: Record<string, PartyGstTreatment> = {
  REGISTERED_BUSINESS_REGULAR: 'REGISTERED',
  REGISTERED_BUSINESS_COMPOSITION: 'COMPOSITION',
  UNREGISTERED_BUSINESS: 'UNREGISTERED',
  CONSUMER: 'CONSUMER',
  OVERSEAS: 'OVERSEAS',
  SPECIAL_ECONOMIC_ZONE: 'SEZ',
  SEZ_DEVELOPER: 'SEZ',
};
export const PARTY_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'] as const;

const sourceOfSupplyField = z
  .string({ required_error: 'Select the source of supply' })
  .trim()
  .refine((v) => INDIAN_STATES.some((s) => s.code === v), 'Select the source of supply');

export const partyFormBaseSchema = z.object({
  salutation: vendorContactSchema.shape.salutation,
  firstName: optionalPersonName('First name'),
  lastName: optionalPersonName('Last name'),
  companyName: optionalBusinessName('Company name', 200),
  displayName: requiredBusinessName('Display name', { max: 150 }),
  email: optionalEmail({ lowercase: true }),
  workPhoneCountryCode: dialCodeField(),
  workPhone: dialCodePhoneField(),
  mobileCountryCode: dialCodeField(),
  mobile: dialCodePhoneField(),
  language: z.string().trim().min(2).max(10).default(DEFAULT_VENDOR_LANGUAGE),
  website: urlField(),

  gstTreatment: z.enum(PARTY_GST_TREATMENTS, { errorMap: () => ({ message: 'Select the GST treatment' }) }),
  sourceOfSupply: sourceOfSupplyField,
  gstin: gstinField(),
  pan: panField(),
  paymentTermId: optionalUuid,
  currencyCode: z.string().trim().length(3).toUpperCase().default('INR'),
  vendorType: optionalEnum(VENDOR_TYPES),
  msmeRegistered: z.boolean().default(false),
  msmeNumber: optionalText(30, { transform: 'upper' }, 'MSME number'),
  tdsApplicable: z.boolean().default(false),
  tdsSectionCode: optionalText(20, { transform: 'upper' }, 'TDS section'),
  tcsApplicable: z.boolean().default(false),
  openingBalance: optionalAmountField('Opening balance', { allowNegative: true }),
  remarks: optionalNotes(5000, 'Remarks'),

  addresses: z.array(vendorAddressSchema).default([]),
  contacts: z.array(vendorContactSchema).default([]),
  bankAccounts: z.array(vendorBankAccountSchema).default([]),
  customFields: z.array(vendorCustomFieldValueSchema).default([]),
});

function refineParty(v: z.output<typeof partyFormBaseSchema>, ctx: z.RefinementCtx) {
  refineMobileForDialCode(ctx, v.mobileCountryCode, v.mobile);
  refinePhoneForDialCode(ctx, v.workPhone);
  if (PARTY_GSTIN_REQUIRED_TREATMENTS.includes(v.gstTreatment) && !v.gstin) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['gstin'], message: 'GSTIN is required for this GST treatment' });
  }
  if (v.gstin && v.sourceOfSupply && v.gstin.slice(0, 2) !== v.sourceOfSupply) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceOfSupply'], message: 'Source of supply must match the state in the GSTIN' });
  }
  if (v.contacts.filter((c) => c.isPrimary).length > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['contacts'], message: 'Only one contact person can be marked as primary' });
  }
  if (v.bankAccounts.filter((b) => b.isPrimary).length > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bankAccounts'], message: 'Only one bank account can be marked as primary' });
  }
  if (v.pan && v.gstin && v.gstin.slice(2, 12) !== v.pan) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pan'], message: 'PAN does not match the PAN embedded in the GSTIN' });
  }
  if (v.msmeRegistered && !v.msmeNumber) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['msmeNumber'], message: 'Enter the MSME / Udyam registration number' });
  }
  if (v.tdsApplicable && !v.tdsSectionCode) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tdsSectionCode'], message: 'Enter the TDS section, e.g. 194C' });
  }
}

export const partyFormSchema = partyFormBaseSchema.superRefine(refineParty);
export type PartyFormInput = z.input<typeof partyFormBaseSchema>;
export type PartyFormPayload = z.output<typeof partyFormBaseSchema>;
export { isBlankAddress as isBlankPartyAddress };
