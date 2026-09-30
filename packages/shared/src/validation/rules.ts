/**
 * Plain validation functions: each returns an error message or null. They power the zod builders
 * in ./fields.ts and can be called directly for imperative checks (filters, uploads, quick UI hints).
 */
import {
  BANK_ACCOUNT_REGEX,
  BUSINESS_NAME_REGEX,
  DIAL_CODE_REGEX,
  HSN_REGEX,
  MOBILE_IN_REGEX,
  PERSON_NAME_REGEX,
  collapseSpaces,
  decimalPlaces,
  isBlank,
  isDateOnOrBefore,
  isValidDateString,
  isValidEmail,
  isValidGstin,
  isValidIfsc,
  isValidPan,
  isValidPhone,
  isValidPincodeIn,
  isValidTdsSection,
  isValidUdyam,
  isValidUrl,
  normalizePhoneInput,
  parseDecimalInput,
} from '../validators.js';
import { MESSAGES } from './messages.js';

export type ValidationResult = string | null;

export interface TextRuleOptions {
  label?: string;
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: RegExp;
  patternMessage?: string;
}

export interface NumberRuleOptions {
  label?: string;
  required?: boolean;
  min?: number;
  max?: number;
  /** Allow values below zero. Default false. */
  allowNegative?: boolean;
  /** Allow exactly zero. Default true. */
  allowZero?: boolean;
  /** Maximum fractional digits. 0 means integers only. Default 2. */
  decimals?: number;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

/* ---- required / text ---------------------------------------------------- */

export function validateRequired(value: unknown, label = 'This field'): ValidationResult {
  return isBlank(value) ? MESSAGES.required(label) : null;
}

export function validateText(value: unknown, opts: TextRuleOptions = {}): ValidationResult {
  const label = opts.label ?? 'This field';
  const v = collapseSpaces(text(value));
  if (v === '') return opts.required ? MESSAGES.required(label) : null;
  if (opts.min !== undefined && v.length < opts.min) return MESSAGES.tooShort(label, opts.min);
  if (opts.max !== undefined && v.length > opts.max) return MESSAGES.tooLong(label, opts.max);
  if (opts.pattern && !opts.pattern.test(v)) return opts.patternMessage ?? MESSAGES.invalidCharacters(label);
  return null;
}

/** Person names: Customer Name, Contact Person, Employee Name, first / last name. */
export function validatePersonName(value: unknown, opts: TextRuleOptions = {}): ValidationResult {
  const label = opts.label ?? 'Name';
  return validateText(value, { max: 100, ...opts, label, pattern: PERSON_NAME_REGEX, patternMessage: MESSAGES.personName(label) });
}

/** Company / vendor / display names may include digits and trade punctuation. */
export function validateBusinessName(value: unknown, opts: TextRuleOptions = {}): ValidationResult {
  const label = opts.label ?? 'Name';
  return validateText(value, { max: 200, ...opts, label, pattern: BUSINESS_NAME_REGEX, patternMessage: MESSAGES.businessName(label) });
}

/* ---- contact ------------------------------------------------------------ */

export function validateEmail(value: unknown, required = false): ValidationResult {
  const v = text(value).trim();
  if (v === '') return required ? MESSAGES.required('Email') : null;
  if (v.length > 254) return MESSAGES.tooLong('Email', 254);
  return isValidEmail(v) ? null : MESSAGES.email;
}

/**
 * Indian mobile: exactly 10 digits starting 6-9. Separators typed between digit groups are
 * ignored; any other character (letters, symbols) fails.
 */
export function validateMobile(value: unknown, required = false): ValidationResult {
  const raw = text(value).trim();
  if (raw === '') return required ? MESSAGES.required('Mobile number') : null;
  const digits = normalizePhoneInput(raw);
  if (digits === null || digits.length !== 10) return MESSAGES.mobile;
  return MOBILE_IN_REGEX.test(digits) ? null : MESSAGES.mobileStart;
}

/** Landline / international phone: 6-15 digits, separators allowed while typing. */
export function validatePhone(value: unknown, required = false): ValidationResult {
  const raw = text(value).trim();
  if (raw === '') return required ? MESSAGES.required('Phone number') : null;
  return isValidPhone(raw) ? null : MESSAGES.phone;
}

export function validateDialCode(value: unknown): ValidationResult {
  const raw = text(value).trim();
  if (raw === '') return null;
  return DIAL_CODE_REGEX.test(raw) ? null : MESSAGES.dialCode;
}

/* ---- Indian identifiers ------------------------------------------------- */

export function validatePincode(value: unknown, required = false): ValidationResult {
  const raw = text(value).trim();
  if (raw === '') return required ? MESSAGES.required('PIN code') : null;
  return isValidPincodeIn(raw) ? null : MESSAGES.pincode;
}

export function validateGstin(value: unknown, required = false): ValidationResult {
  const raw = text(value).trim();
  if (raw === '') return required ? MESSAGES.required('GSTIN') : null;
  return isValidGstin(raw) ? null : MESSAGES.gstin;
}

export function validatePan(value: unknown, required = false): ValidationResult {
  const raw = text(value).trim();
  if (raw === '') return required ? MESSAGES.required('PAN') : null;
  return isValidPan(raw) ? null : MESSAGES.pan;
}

export function validateIfsc(value: unknown, required = true): ValidationResult {
  const raw = text(value).trim();
  if (raw === '') return required ? MESSAGES.required('IFSC') : null;
  return isValidIfsc(raw) ? null : MESSAGES.ifsc;
}

export function validateUdyam(value: unknown, required = false): ValidationResult {
  const raw = text(value).trim();
  if (raw === '') return required ? MESSAGES.required('Udyam number') : null;
  return isValidUdyam(raw) ? null : MESSAGES.udyam;
}

export function validateTdsSection(value: unknown, required = false): ValidationResult {
  const raw = text(value).trim();
  if (raw === '') return required ? MESSAGES.required('TDS section') : null;
  return isValidTdsSection(raw) ? null : MESSAGES.tdsSection;
}

export function validateBankAccountNumber(value: unknown, required = true): ValidationResult {
  const raw = text(value).replace(/\s+/g, '');
  if (raw === '') return required ? MESSAGES.required('Account number') : null;
  return BANK_ACCOUNT_REGEX.test(raw) ? null : MESSAGES.bankAccount;
}

export function validateHsn(value: unknown, required = false): ValidationResult {
  const raw = text(value).trim();
  if (raw === '') return required ? MESSAGES.required('HSN/SAC') : null;
  return HSN_REGEX.test(raw) ? null : MESSAGES.hsn;
}

/* ---- numbers ------------------------------------------------------------ */

export function validateNumber(value: unknown, opts: NumberRuleOptions = {}): ValidationResult {
  const label = opts.label ?? 'Value';
  const decimals = opts.decimals ?? 2;
  if (isBlank(value)) return opts.required ? MESSAGES.required(label) : null;
  const n = parseDecimalInput(value);
  if (!Number.isFinite(n)) return MESSAGES.number(label);
  if (decimals === 0 && !Number.isInteger(n)) return MESSAGES.integer(label);
  if (decimals > 0 && decimalPlaces(typeof value === 'string' ? value.replace(/,/g, '') : n) > decimals) return MESSAGES.decimals(label, decimals);
  if (!opts.allowNegative && n < 0) return MESSAGES.negative(label);
  if (opts.allowZero === false && n === 0) return MESSAGES.positive(label);
  if (opts.min !== undefined && n < opts.min) return MESSAGES.min(label, opts.min);
  if (opts.max !== undefined && n > opts.max) return MESSAGES.max(label, opts.max);
  return null;
}

/** Money: non-negative unless allowNegative, max 2 decimals, zero allowed. */
export function validateAmount(value: unknown, opts: NumberRuleOptions = {}): ValidationResult {
  return validateNumber(value, { label: 'Amount', decimals: 2, ...opts });
}

/** Quantity: strictly positive by default, up to 3 decimals. */
export function validateQuantity(value: unknown, opts: NumberRuleOptions = {}): ValidationResult {
  return validateNumber(value, { label: 'Quantity', decimals: 3, allowZero: false, required: true, ...opts });
}

/** Stock levels: zero allowed, never negative. */
export function validateStock(value: unknown, opts: NumberRuleOptions = {}): ValidationResult {
  return validateNumber(value, { label: 'Stock', decimals: 3, allowZero: true, ...opts });
}

export function validatePercentage(value: unknown, opts: NumberRuleOptions = {}): ValidationResult {
  const label = opts.label ?? 'Percentage';
  const result = validateNumber(value, { label, decimals: 2, min: 0, max: 100, ...opts });
  if (result && (result === MESSAGES.min(label, opts.min ?? 0) || result === MESSAGES.max(label, opts.max ?? 100))) {
    return opts.min === undefined && opts.max === undefined ? MESSAGES.percentage(label) : result;
  }
  return result;
}

export function validateInteger(value: unknown, opts: NumberRuleOptions = {}): ValidationResult {
  return validateNumber(value, { label: 'Value', ...opts, decimals: 0 });
}

/* ---- dates -------------------------------------------------------------- */

export function validateDate(value: unknown, label = 'Date', required = false): ValidationResult {
  const raw = text(value).trim();
  if (raw === '') return required ? MESSAGES.required(label) : null;
  return isValidDateString(raw) ? null : MESSAGES.date(label);
}

/** Both dates optional; only complains when both are present and out of order. */
export function validateDateRange(start: unknown, end: unknown, startLabel = 'Start date', endLabel = 'End date'): ValidationResult {
  const s = text(start).trim();
  const e = text(end).trim();
  if (!s || !e) return null;
  if (!isValidDateString(s)) return MESSAGES.date(startLabel);
  if (!isValidDateString(e)) return MESSAGES.date(endLabel);
  return isDateOnOrBefore(s, e) ? null : MESSAGES.dateOrder(startLabel, endLabel);
}

/* ---- misc --------------------------------------------------------------- */

export function validateUrl(value: unknown, required = false): ValidationResult {
  const raw = text(value).trim();
  if (raw === '') return required ? MESSAGES.required('Website') : null;
  if (raw.length > 255) return MESSAGES.tooLong('Website', 255);
  return isValidUrl(raw) ? null : MESSAGES.url;
}

export const SEARCH_MAX_LENGTH = 200;

/** Trims, collapses spaces and caps length so list endpoints never receive junk. */
export function normalizeSearch(value: unknown): string {
  return collapseSpaces(text(value)).slice(0, SEARCH_MAX_LENGTH);
}

export function validateSearch(value: unknown): ValidationResult {
  return text(value).trim().length > SEARCH_MAX_LENGTH ? MESSAGES.search : null;
}
