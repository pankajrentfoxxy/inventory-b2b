/**
 * Reusable zod field builders. Every schema in this package (vendors, items, purchase orders,
 * settings, auth) composes these instead of declaring its own string / number / regex rules, so
 * the API (validateBody / validateQuery) and the web forms (zodResolver) behave identically.
 *
 * Conventions
 * - Text builders accept string | null | undefined (form inputs send ''), trim and collapse spaces,
 *   and return null for optional blanks so the database never stores ''.
 * - Number builders accept number | string ("1,20,000.50") and return a JS number.
 * - Messages come from ./messages.ts via the rule functions in ./rules.ts.
 */
import { z, type RefinementCtx } from 'zod';
import { DEFAULT_DIAL_CODE } from '../constants.js';
import { CODE_REGEX, collapseInlineSpaces, collapseSpaces, isBlank, normalizePhoneInput, normalizeUrl, parseDecimalInput } from '../validators.js';
import { MESSAGES } from './messages.js';
import {
  validateBankAccountNumber,
  validateBusinessName,
  validateDate,
  validateDateRange,
  validateDialCode,
  validateEmail,
  validateGstin,
  validateHsn,
  validateIfsc,
  validateMobile,
  validateNumber,
  validatePan,
  validatePersonName,
  validatePhone,
  validatePincode,
  validateTdsSection,
  validateText,
  validateUdyam,
  validateUrl,
  normalizeSearch,
  type NumberRuleOptions,
  type TextRuleOptions,
} from './rules.js';

const nullableString = z.union([z.string(), z.null(), z.undefined()]);
const numberInput = z.union([z.number(), z.string(), z.null(), z.undefined()]);

function issue(ctx: RefinementCtx, message: string, path?: (string | number)[]) {
  ctx.addIssue({ code: z.ZodIssueCode.custom, message, ...(path ? { path } : {}) });
}

function asText(v: string | null | undefined, multiline = false): string {
  if (typeof v !== 'string') return '';
  return multiline ? collapseInlineSpaces(v) : collapseSpaces(v);
}

/* ---- text ----------------------------------------------------------------- */

export interface TextFieldOptions extends Omit<TextRuleOptions, 'required' | 'label'> {
  /** Keep line breaks (remarks, notes, terms). Spaces are still collapsed within a line. */
  multiline?: boolean;
  transform?: 'upper' | 'lower';
}

function applyCase(v: string, transform?: 'upper' | 'lower') {
  return transform === 'upper' ? v.toUpperCase() : transform === 'lower' ? v.toLowerCase() : v;
}

/** Optional single-line text: trimmed, collapsed, '' -> null, max length enforced. */
export function optionalText(max: number, opts: TextFieldOptions = {}, label = 'This field') {
  return nullableString
    .transform((v) => applyCase(asText(v, opts.multiline), opts.transform))
    .transform((v) => (v === '' ? null : v))
    .superRefine((v, ctx) => {
      if (v === null) return;
      const problem = validateText(v, { label, max, min: opts.min, pattern: opts.pattern, patternMessage: opts.patternMessage });
      if (problem) issue(ctx, problem);
    });
}

/** Required text: blank / whitespace-only rejected with "<label> is required". */
export function requiredText(label: string, max: number, opts: TextFieldOptions & { min?: number } = {}) {
  return nullableString
    .transform((v) => applyCase(asText(v, opts.multiline), opts.transform))
    .superRefine((v, ctx) => {
      const problem = validateText(v, { label, required: true, max, min: opts.min ?? 1, pattern: opts.pattern, patternMessage: opts.patternMessage });
      if (problem) issue(ctx, problem);
    });
}

/** Multi-line notes / remarks / terms. */
export const optionalNotes = (max: number, label = 'Notes') => optionalText(max, { multiline: true }, label);
export const requiredNotes = (label: string, max: number) => requiredText(label, max, { multiline: true });

/** Optional person name (last name, optional first name): letters and name punctuation only. */
export function optionalPersonName(label: string, max = 100) {
  return nullableString
    .transform((v) => asText(v))
    .transform((v) => (v === '' ? null : v))
    .superRefine((v, ctx) => {
      if (v === null) return;
      const problem = validatePersonName(v, { label, max });
      if (problem) issue(ctx, problem);
    });
}

/** Required person name (contact person, employee, account owner). */
export function requiredPersonName(label: string, opts: { max?: number; min?: number } = {}) {
  return nullableString
    .transform((v) => asText(v))
    .superRefine((v, ctx) => {
      const problem = validatePersonName(v, { label, required: true, max: opts.max ?? 100, min: opts.min });
      if (problem) issue(ctx, problem);
    });
}

/** Optional company / vendor / bank name: letters, digits and trade punctuation. */
export function optionalBusinessName(label: string, max = 200) {
  return nullableString
    .transform((v) => asText(v))
    .transform((v) => (v === '' ? null : v))
    .superRefine((v, ctx) => {
      if (v === null) return;
      const problem = validateBusinessName(v, { label, max });
      if (problem) issue(ctx, problem);
    });
}

/** Required company / display / bank name. */
export function requiredBusinessName(label: string, opts: { max?: number; min?: number } = {}) {
  return nullableString
    .transform((v) => asText(v))
    .superRefine((v, ctx) => {
      const problem = validateBusinessName(v, { label, required: true, max: opts.max ?? 200, min: opts.min });
      if (problem) issue(ctx, problem);
    });
}

/** Upper-case machine codes (GST treatment code, SKU-like identifiers). */
export const requiredCode = (label: string, max: number, opts: { min?: number } = {}) =>
  requiredText(label, max, { transform: 'upper', min: opts.min, pattern: CODE_REGEX, patternMessage: MESSAGES.code });
export const optionalCode = (label: string, max: number, opts: { min?: number } = {}) =>
  optionalText(max, { transform: 'upper', min: opts.min, pattern: CODE_REGEX, patternMessage: MESSAGES.code }, label);

/* ---- contact -------------------------------------------------------------- */

export function optionalEmail(opts: { lowercase?: boolean } = {}) {
  return nullableString
    .transform((v) => (typeof v === 'string' ? v.trim() : ''))
    .transform((v) => (opts.lowercase ? v.toLowerCase() : v))
    .transform((v) => (v === '' ? null : v))
    .superRefine((v, ctx) => {
      if (v === null) return;
      const problem = validateEmail(v);
      if (problem) issue(ctx, problem);
    });
}

export function requiredEmail(opts: { lowercase?: boolean } = {}) {
  return nullableString
    .transform((v) => (typeof v === 'string' ? v.trim() : ''))
    .transform((v) => (opts.lowercase ? v.toLowerCase() : v))
    .superRefine((v, ctx) => {
      const problem = validateEmail(v, true);
      if (problem) issue(ctx, problem);
    });
}

/**
 * Indian mobile number. Separators typed between digit groups are removed; the stored value is
 * exactly 10 digits. Use phoneField for landlines and non-Indian numbers.
 */
export function mobileField(opts: { required?: boolean } = {}) {
  return nullableString
    .transform((v) => (typeof v === 'string' ? v.trim() : ''))
    .superRefine((v, ctx) => {
      const problem = validateMobile(v, opts.required);
      if (problem) issue(ctx, problem);
    })
    .transform((v) => (v === '' ? null : (normalizePhoneInput(v) ?? v)));
}

/** Landline / international phone: stored as 6-15 digits. */
export function phoneField(opts: { required?: boolean } = {}) {
  return nullableString
    .transform((v) => (typeof v === 'string' ? v.trim() : ''))
    .superRefine((v, ctx) => {
      const problem = validatePhone(v, opts.required);
      if (problem) issue(ctx, problem);
    })
    .transform((v) => (v === '' ? null : (normalizePhoneInput(v) ?? v)));
}

/**
 * Phone number that sits next to a dial-code select. The field itself only trims and caps the
 * length; refineMobileForDialCode applies the strict Indian rule for +91 and the lenient phone
 * rule otherwise, so the message always matches the selected country. Separators are stripped
 * from the stored value, as in mobileField / phoneField.
 */
export function dialCodePhoneField() {
  return nullableString
    .transform((v) => (typeof v === 'string' ? v.trim() : ''))
    .superRefine((v, ctx) => {
      if (v.length > 20) issue(ctx, MESSAGES.tooLong('Phone number', 20));
    })
    .transform((v) => (v === '' ? null : (normalizePhoneInput(v) ?? v)));
}

/** "+91"-style dialling code; blank falls back to the given default. */
export function dialCodeField(defaultCode: string = DEFAULT_DIAL_CODE) {
  return nullableString
    .transform((v) => (typeof v === 'string' ? v.trim() : ''))
    .superRefine((v, ctx) => {
      const problem = validateDialCode(v);
      if (problem) issue(ctx, problem);
    })
    .transform((v) => (v === '' ? defaultCode : v));
}

/**
 * Object-level rule for dialCodePhoneField: an Indian (+91) mobile must be a valid 10-digit
 * number; any other dial code falls back to the lenient 6-15 digit phone rule.
 */
export function refineMobileForDialCode(ctx: RefinementCtx, dialCode: string | null | undefined, mobile: string | null | undefined, path: (string | number)[] = ['mobile']) {
  if (!mobile) return;
  const problem = (dialCode ?? DEFAULT_DIAL_CODE) === '+91' ? validateMobile(mobile) : validatePhone(mobile);
  if (problem) issue(ctx, problem, path);
}

/** Object-level rule for a work phone next to a dial code: lenient digits rule with a phone message. */
export function refinePhoneForDialCode(ctx: RefinementCtx, phone: string | null | undefined, path: (string | number)[] = ['workPhone']) {
  if (!phone) return;
  const problem = validatePhone(phone);
  if (problem) issue(ctx, problem, path);
}

/* ---- Indian identifiers --------------------------------------------------- */

export function gstinField(opts: { required?: boolean } = {}) {
  return nullableString
    .transform((v) => (typeof v === 'string' ? v.trim().toUpperCase() : ''))
    .transform((v) => (v === '' && !opts.required ? null : v))
    .superRefine((v, ctx) => {
      if (v === null) return;
      const problem = validateGstin(v, opts.required);
      if (problem) issue(ctx, problem);
    });
}

export function panField(opts: { required?: boolean } = {}) {
  return nullableString
    .transform((v) => (typeof v === 'string' ? v.trim().toUpperCase() : ''))
    .transform((v) => (v === '' && !opts.required ? null : v))
    .superRefine((v, ctx) => {
      if (v === null) return;
      const problem = validatePan(v, opts.required);
      if (problem) issue(ctx, problem);
    });
}

/** IFSC is required whenever a bank account row exists. */
export function ifscField() {
  return nullableString
    .transform((v) => (typeof v === 'string' ? v.trim().toUpperCase() : ''))
    .superRefine((v, ctx) => {
      const problem = validateIfsc(v, true);
      if (problem) issue(ctx, problem);
    });
}

/** Udyam (MSME) registration number, stored upper-case. Pair with a "required when MSME" refinement. */
export function udyamField() {
  return nullableString
    .transform((v) => (typeof v === 'string' ? v.trim().toUpperCase() : ''))
    .transform((v) => (v === '' ? null : v))
    .superRefine((v, ctx) => {
      if (v === null) return;
      const problem = validateUdyam(v);
      if (problem) issue(ctx, problem);
    });
}

/** Income-tax TDS section (194C, 194J, ...), stored upper-case without spaces. */
export function tdsSectionField() {
  return nullableString
    .transform((v) => (typeof v === 'string' ? v.replace(/\s+/g, '').toUpperCase() : ''))
    .transform((v) => (v === '' ? null : v))
    .superRefine((v, ctx) => {
      if (v === null) return;
      const problem = validateTdsSection(v);
      if (problem) issue(ctx, problem);
    });
}

/** Bank account number: spaces removed; required unless the row keeps its stored (encrypted) number. */
export function bankAccountNumberField() {
  return nullableString
    .transform((v) => (typeof v === 'string' ? v.replace(/\s+/g, '') : ''))
    .transform((v) => (v === '' ? null : v))
    .superRefine((v, ctx) => {
      if (v === null) return;
      const problem = validateBankAccountNumber(v);
      if (problem) issue(ctx, problem);
    });
}

/** Indian PIN: exactly 6 digits, not starting with 0. */
export function pincodeField(opts: { required?: boolean } = {}) {
  return nullableString
    .transform((v) => (typeof v === 'string' ? v.trim() : ''))
    .transform((v) => (v === '' && !opts.required ? null : v))
    .superRefine((v, ctx) => {
      if (v === null) return;
      const problem = validatePincode(v, opts.required);
      if (problem) issue(ctx, problem);
    });
}

/** Free-form postal code for any country; pair with refineIndianPostalCode at object level. */
export const postalCodeField = () => optionalText(20, {}, 'Postal code');

export function refineIndianPostalCode(ctx: RefinementCtx, countryCode: string | null | undefined, postalCode: string | null | undefined, path: (string | number)[] = ['postalCode']) {
  if (countryCode !== 'IN' || !postalCode) return;
  const problem = validatePincode(postalCode);
  if (problem) issue(ctx, problem, path);
}

export function hsnField(opts: { required?: boolean } = {}) {
  return nullableString
    .transform((v) => (typeof v === 'string' ? v.trim() : ''))
    .transform((v) => (v === '' && !opts.required ? null : v))
    .superRefine((v, ctx) => {
      if (v === null) return;
      const problem = validateHsn(v, opts.required);
      if (problem) issue(ctx, problem);
    });
}

/* ---- numbers -------------------------------------------------------------- */

export interface NumberFieldOptions extends Omit<NumberRuleOptions, 'label' | 'required'> {
  /** Used when the input is blank. Without it a blank value is an error. */
  default?: number;
}

/** Required number (or defaulted). Output: number. */
export function numberField(label: string, opts: NumberFieldOptions = {}) {
  const { default: fallback, ...rule } = opts;
  return numberInput
    .superRefine((v, ctx) => {
      if (isBlank(v) && fallback !== undefined) return;
      const problem = validateNumber(v, { ...rule, label, required: true });
      if (problem) issue(ctx, problem);
    })
    .transform((v) => (isBlank(v) ? (fallback ?? 0) : parseDecimalInput(v)));
}

/** Optional number. Output: number | null. */
export function optionalNumberField(label: string, opts: Omit<NumberFieldOptions, 'default'> = {}) {
  return numberInput
    .superRefine((v, ctx) => {
      const problem = validateNumber(v, { ...opts, label, required: false });
      if (problem) issue(ctx, problem);
    })
    .transform((v) => (isBlank(v) ? null : parseDecimalInput(v)));
}

/** Money: 2 decimals, zero allowed, negative only when allowNegative. */
export const amountField = (label: string, opts: NumberFieldOptions = {}) => numberField(label, { decimals: 2, ...opts });
export const optionalAmountField = (label: string, opts: Omit<NumberFieldOptions, 'default'> = {}) => optionalNumberField(label, { decimals: 2, ...opts });

/** Quantity: strictly positive, up to 3 decimals. */
export const quantityField = (label = 'Quantity', opts: NumberFieldOptions = {}) => numberField(label, { decimals: 3, allowZero: false, ...opts });
/** Quantity that may be zero (e.g. "nothing received for this line"). */
export const nonNegativeQuantityField = (label = 'Quantity', opts: NumberFieldOptions = {}) => numberField(label, { decimals: 3, allowZero: true, ...opts });

/** 0-100 with 2 decimals. */
export const percentageField = (label: string, opts: NumberFieldOptions = {}) => numberField(label, { decimals: 2, min: 0, max: 100, ...opts });

/** Whole numbers. */
export const integerField = (label: string, opts: NumberFieldOptions = {}) => numberField(label, { ...opts, decimals: 0 });
export const optionalIntegerField = (label: string, opts: Omit<NumberFieldOptions, 'default'> = {}) => optionalNumberField(label, { ...opts, decimals: 0 });

/* ---- dates ---------------------------------------------------------------- */

/** Required YYYY-MM-DD, checked against the calendar. */
export function dateField(label: string) {
  return nullableString
    .transform((v) => (typeof v === 'string' ? v.trim() : ''))
    .superRefine((v, ctx) => {
      const problem = validateDate(v, label, true);
      if (problem) issue(ctx, problem);
    });
}

export function optionalDateField(label: string) {
  return nullableString
    .transform((v) => (typeof v === 'string' ? v.trim() : ''))
    .transform((v) => (v === '' ? null : v))
    .superRefine((v, ctx) => {
      if (v === null) return;
      const problem = validateDate(v, label);
      if (problem) issue(ctx, problem);
    });
}

/** Object-level rule: end date may not precede start date. Attaches the issue to the end path. */
export function refineDateOrder(ctx: RefinementCtx, start: string | null | undefined, end: string | null | undefined, endPath: (string | number)[], startLabel: string, endLabel: string) {
  const problem = validateDateRange(start, end, startLabel, endLabel);
  if (problem) issue(ctx, problem, endPath);
}

/* ---- ids, urls, enums ----------------------------------------------------- */

export const uuidField = (label: string) => z.string({ required_error: MESSAGES.uuid(label), invalid_type_error: MESSAGES.uuid(label) }).uuid(MESSAGES.uuid(label));

export const optionalUuid = z.union([z.string().uuid(), z.literal(''), z.null(), z.undefined()]).transform((v) => (v ? v : null));

/** Optional enum where '' / null mean "not set". */
export function optionalEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z.union([z.enum(values), z.literal(''), z.null(), z.undefined()]).transform((v) => (v ? (v as T[number]) : null));
}

/** Website / API URL, http(s) only. "vendor.com" is accepted and stored as https://vendor.com. */
export function urlField(opts: { required?: boolean } = {}) {
  return nullableString
    .transform((v) => (typeof v === 'string' ? v.trim() : ''))
    .transform((v) => (v === '' && !opts.required ? null : v))
    .superRefine((v, ctx) => {
      if (v === null) return;
      const problem = validateUrl(v, opts.required);
      if (problem) issue(ctx, problem);
    })
    .transform((v) => (v === null ? null : (normalizeUrl(v) ?? v)));
}

/* ---- list queries ------------------------------------------------------------ */

export const LIST_DEFAULT_LIMIT = 25;
export const LIST_MAX_LIMIT = 100;

/** Search box text: trimmed, collapsed, capped. Never fails; junk is simply clipped. */
export const searchField = () => z.union([z.string(), z.undefined(), z.null()]).transform((v) => normalizeSearch(v ?? ''));

export const paginationFields = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(LIST_MAX_LIMIT).default(LIST_DEFAULT_LIMIT),
};
export const paginationQuerySchema = z.object(paginationFields);
export type PaginationQuery = z.output<typeof paginationQuerySchema>;

export const sortOrderField = (fallback: 'asc' | 'desc' = 'asc') => z.enum(['asc', 'desc']).default(fallback);

/** Optional date range for list filters; adds the order check to the `to` path. */
export function refineDateRangeQuery(ctx: RefinementCtx, from: string | null, to: string | null, toPath = 'dateTo') {
  refineDateOrder(ctx, from, to, [toPath], 'From date', 'To date');
}
