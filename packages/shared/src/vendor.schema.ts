import { z } from 'zod';
import {
  ADDRESS_TYPES,
  BANK_ACCOUNT_TYPES,
  CUSTOM_FIELD_TYPES,
  DEFAULT_COUNTRY_CODE,
  DEFAULT_VENDOR_LANGUAGE,
  SALUTATIONS,
  VENDOR_LIST_DEFAULT_LIMIT,
  VENDOR_LIST_MAX_LIMIT,
  VENDOR_SORT_FIELDS,
  VENDOR_STATUSES,
  VENDOR_TYPES,
} from './constants.js';
import {
  bankAccountNumberField,
  dialCodePhoneField,
  dialCodeField,
  gstinField,
  ifscField,
  integerField,
  mobileField,
  optionalAmountField,
  optionalEmail,
  optionalEnum,
  optionalNotes,
  optionalText,
  optionalBusinessName,
  optionalPersonName,
  optionalUuid,
  panField,
  phoneField,
  postalCodeField,
  refineIndianPostalCode,
  refineMobileForDialCode,
  refinePhoneForDialCode,
  requiredBusinessName,
  requiredCode,
  requiredPersonName,
  requiredText,
  searchField,
  sortOrderField,
  urlField,
  uuidField,
} from './validation/fields.js';
import { MESSAGES } from './validation/messages.js';

/* ---- shared building blocks -------------------------------------------- */

export const gstinInput = gstinField();
export const panInput = panField();

const salutationField = optionalEnum(SALUTATIONS);
const countryField = z.string().trim().length(2, 'Select a country').toUpperCase().default(DEFAULT_COUNTRY_CODE);

/* ---- nested entities -------------------------------------------------- */

export const vendorAddressSchema = z
  .object({
    id: optionalUuid,
    type: z.enum(ADDRESS_TYPES),
    attention: optionalText(120, {}, 'Attention'),
    countryCode: countryField,
    addressLine1: optionalText(255, {}, 'Address line 1'),
    addressLine2: optionalText(255, {}, 'Address line 2'),
    city: optionalText(120, {}, 'City'),
    state: optionalText(120, {}, 'State'),
    stateCode: optionalText(5, {}, 'State code'),
    postalCode: postalCodeField(),
    phone: phoneField(),
    fax: phoneField(),
    isPrimary: z.boolean().default(false),
  })
  .superRefine((addr, ctx) => refineIndianPostalCode(ctx, addr.countryCode, addr.postalCode));
export type VendorAddressInput = z.input<typeof vendorAddressSchema>;
export type VendorAddressPayload = z.output<typeof vendorAddressSchema>;

/** True when the address has no user-entered content. Such rows are dropped, not saved. */
export function isBlankAddress(a: Partial<VendorAddressPayload>): boolean {
  return (
    !a.attention &&
    !a.addressLine1 &&
    !a.addressLine2 &&
    !a.city &&
    !a.state &&
    !a.postalCode &&
    !a.phone &&
    !a.fax
  );
}

export const vendorContactSchema = z.object({
  id: optionalUuid,
  salutation: salutationField,
  firstName: requiredPersonName('First name'),
  lastName: optionalPersonName('Last name'),
  email: optionalEmail({ lowercase: true }),
  workPhone: phoneField(),
  mobile: mobileField(),
  designation: optionalText(100, {}, 'Designation'),
  department: optionalText(100, {}, 'Department'),
  isPrimary: z.boolean().default(false),
});
export type VendorContactInput = z.input<typeof vendorContactSchema>;
export type VendorContactPayload = z.output<typeof vendorContactSchema>;

export const vendorBankAccountSchema = z
  .object({
    id: optionalUuid,
    bankName: requiredBusinessName('Bank name', { max: 150 }),
    accountHolderName: requiredBusinessName('Account holder name', { max: 150 }),
    /** Required for new rows; may be omitted on update to keep the stored (encrypted) number. */
    accountNumber: bankAccountNumberField(),
    ifsc: ifscField(),
    branch: optionalText(150, {}, 'Branch'),
    accountType: z.enum(BANK_ACCOUNT_TYPES).default('CURRENT'),
    isPrimary: z.boolean().default(false),
  })
  .superRefine((acct, ctx) => {
    if (!acct.id && !acct.accountNumber) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['accountNumber'], message: MESSAGES.required('Account number') });
    }
  });
export type VendorBankAccountInput = z.input<typeof vendorBankAccountSchema>;
export type VendorBankAccountPayload = z.output<typeof vendorBankAccountSchema>;

export const vendorCustomFieldValueSchema = z.object({
  fieldId: z.string().uuid(),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
});
export type VendorCustomFieldValuePayload = z.output<typeof vendorCustomFieldValueSchema>;

export const vendorReportingTagValueSchema = z.object({
  tagId: z.string().uuid(),
  optionId: optionalUuid,
});
export type VendorReportingTagValuePayload = z.output<typeof vendorReportingTagValueSchema>;

/* ---- vendor ----------------------------------------------------------- */

export const vendorBaseSchema = z.object({
  salutation: salutationField,
  firstName: optionalPersonName('First name'),
  lastName: optionalPersonName('Last name'),
  companyName: optionalBusinessName('Company name', 200),
  displayName: requiredBusinessName('Display name', { max: 200 }),
  email: optionalEmail({ lowercase: true }),
  workPhoneCountryCode: dialCodeField(),
  workPhone: dialCodePhoneField(),
  mobileCountryCode: dialCodeField(),
  mobile: dialCodePhoneField(),
  language: z.string().trim().min(2).max(10).default(DEFAULT_VENDOR_LANGUAGE),
  website: urlField(),

  gstTreatmentId: uuidField('GST treatment'),
  sourceOfSupplyId: uuidField('source of supply'),
  gstin: gstinInput,
  pan: panInput,
  paymentTermId: optionalUuid,
  currencyCode: z.string().trim().length(3).toUpperCase().default('INR'),
  vendorType: optionalEnum(VENDOR_TYPES),
  msmeRegistered: z.boolean().default(false),
  msmeNumber: optionalText(30, { transform: 'upper' }, 'MSME number'),
  tdsApplicable: z.boolean().default(false),
  tdsSectionCode: optionalText(20, { transform: 'upper' }, 'TDS section'),
  tcsApplicable: z.boolean().default(false),
  /** Free-form extension point for future TDS/TCS/e-invoicing settings. */
  taxConfig: z.record(z.unknown()).default({}),
  openingBalance: optionalAmountField('Opening balance', { allowNegative: true }),
  remarks: optionalNotes(5000, 'Remarks'),

  addresses: z.array(vendorAddressSchema).default([]),
  contacts: z.array(vendorContactSchema).default([]),
  bankAccounts: z.array(vendorBankAccountSchema).default([]),
  customFields: z.array(vendorCustomFieldValueSchema).default([]),
  reportingTags: z.array(vendorReportingTagValueSchema).default([]),
});

function refineVendor(v: z.output<typeof vendorBaseSchema>, ctx: z.RefinementCtx) {
  refineMobileForDialCode(ctx, v.mobileCountryCode, v.mobile);
  refinePhoneForDialCode(ctx, v.workPhone);
  if (v.contacts.filter((c) => c.isPrimary).length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['contacts'],
      message: 'Only one contact person can be marked as primary',
    });
  }
  if (v.bankAccounts.filter((b) => b.isPrimary).length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['bankAccounts'],
      message: 'Only one bank account can be marked as primary',
    });
  }
  if (v.pan && v.gstin && v.gstin.slice(2, 12) !== v.pan) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pan'],
      message: 'PAN does not match the PAN embedded in the GSTIN',
    });
  }
  if (v.msmeRegistered && !v.msmeNumber) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['msmeNumber'],
      message: 'Enter the MSME / Udyam registration number',
    });
  }
  if (v.tdsApplicable && !v.tdsSectionCode) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tdsSectionCode'], message: 'Enter the TDS section, e.g. 194C' });
  }
}

export const vendorCreateSchema = vendorBaseSchema.superRefine(refineVendor);
export const vendorUpdateSchema = vendorBaseSchema.superRefine(refineVendor);
export type VendorFormInput = z.input<typeof vendorBaseSchema>;
export type VendorPayload = z.output<typeof vendorBaseSchema>;

export const vendorStatusSchema = z.object({
  status: z.enum(VENDOR_STATUSES),
  reason: optionalNotes(500, 'Reason'),
});

export const vendorListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(VENDOR_LIST_MAX_LIMIT).default(VENDOR_LIST_DEFAULT_LIMIT),
  search: searchField(),
  status: z
    .union([z.enum(VENDOR_STATUSES), z.literal('ALL'), z.literal('')])
    .optional()
    .default('ALL'),
  gstTreatmentId: optionalUuid,
  sourceOfSupplyId: optionalUuid,
  vendorType: z.union([z.enum(VENDOR_TYPES), z.literal('')]).optional().default(''),
  tagOptionId: optionalUuid,
  sortBy: z.enum(VENDOR_SORT_FIELDS).default('displayName'),
  sortOrder: sortOrderField('asc'),
});
export type VendorListQuery = z.output<typeof vendorListQuerySchema>;

export const vendorNoteSchema = z.object({
  body: requiredText('Note', 5000, { multiline: true }),
});

/* ---- masters ---------------------------------------------------------- */

export const CUSTOM_FIELD_ENTITIES = ['VENDOR', 'PURCHASE_ORDER'] as const;
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];

export const customFieldDefinitionSchema = z
  .object({
    entityType: z.enum(CUSTOM_FIELD_ENTITIES).default('VENDOR'),
    label: requiredText('Label', 100),
    fieldType: z.enum(CUSTOM_FIELD_TYPES),
    options: z.array(requiredText('Option', 100)).default([]),
    isRequired: z.boolean().default(false),
    isActive: z.boolean().default(true),
    sortOrder: integerField('Sort order', { min: 0, default: 0 }),
  })
  .superRefine((f, ctx) => {
    if (f.fieldType === 'DROPDOWN' && f.options.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'Dropdown fields need at least one option',
      });
    }
  });

export const reportingTagSchema = z.object({
  name: requiredText('Tag name', 100),
  options: z.array(requiredText('Option', 100)).default([]),
  isActive: z.boolean().default(true),
});

export const gstTreatmentSchema = z.object({
  code: requiredCode('Code', 50, { min: 2 }),
  name: requiredText('Name', 100),
  description: optionalText(255, {}, 'Description'),
  requiresGstin: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: integerField('Sort order', { min: 0, default: 0 }),
});

export const paymentTermSchema = z.object({
  name: requiredText('Name', 100),
  days: integerField('Days', { min: 0, max: 365 }),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
