/**
 * Indian B2B identifiers + contact formats. Dependency-free so API and web apply identical rules.
 *
 * This file owns every regex in the application. Nothing outside packages/shared may declare a
 * validation regex; import from here (or use the zod builders in ./validation/fields.ts).
 */

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const PINCODE_IN_REGEX = /^[1-9][0-9]{5}$/;
/** Indian mobile: exactly 10 digits, first digit 6-9. */
export const MOBILE_IN_REGEX = /^[6-9][0-9]{9}$/;
export const DIAL_CODE_REGEX = /^\+[1-9][0-9]{0,3}$/;
/** Digits with optional spaces, dashes, dots or parentheses (landlines, international). */
export const PHONE_REGEX = /^[0-9 ()./-]{6,20}$/;
/** Characters that may separate digit groups in a typed phone number. They are stripped, never stored. */
export const PHONE_SEPARATOR_REGEX = /[\s().-]/g;
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const BANK_ACCOUNT_REGEX = /^[0-9A-Za-z]{6,34}$/;
export const HSN_REGEX = /^[0-9]{4,8}$/;
/** Udyam (MSME) registration number: UDYAM-<state>-<2 digits>-<7 digits>. */
export const UDYAM_REGEX = /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/;
/** Income-tax TDS section: 192 to 196 with an optional letter suffix (194C, 194IA, 194LBA). */
export const TDS_SECTION_REGEX = /^19[2-6][A-Z]{0,3}$/;
/** Person names: letters (any script), spaces, dot, apostrophe, hyphen. No digits. */
export const PERSON_NAME_REGEX = /^[\p{L}][\p{L}\p{M} .'-]*$/u;
/** Company / display names: letters, digits and common punctuation used in trade names. */
export const BUSINESS_NAME_REGEX = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} .,'&()/#+-]*$/u;
/** Upper-case code identifiers such as GST treatment codes or SKUs. */
export const CODE_REGEX = /^[A-Z0-9][A-Z0-9_./-]*$/;
export const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const DECIMAL_STRING_REGEX = /^-?(\d+|\d*\.\d+)$/;
export const URL_PROTOCOLS = ['http:', 'https:'] as const;

const GSTIN_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Verifies the mod-36 check character in the 15th position of a GSTIN. */
export function gstinChecksumValid(gstin: string): boolean {
  if (gstin.length !== 15) return false;
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const value = GSTIN_ALPHABET.indexOf(gstin[i]);
    if (value < 0) return false;
    const factor = i % 2 === 0 ? 1 : 2;
    const product = value * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }
  const check = (36 - (sum % 36)) % 36;
  return GSTIN_ALPHABET[check] === gstin[14];
}

export function isValidGstin(input: string): boolean {
  const value = input.trim().toUpperCase();
  return GSTIN_REGEX.test(value) && gstinChecksumValid(value);
}

export function isValidPan(input: string): boolean {
  return PAN_REGEX.test(input.trim().toUpperCase());
}

/** GSTIN characters 3-12 are the PAN of the registered entity. */
export function panFromGstin(gstin: string): string | null {
  const value = gstin.trim().toUpperCase();
  return GSTIN_REGEX.test(value) ? value.slice(2, 12) : null;
}

/** GSTIN characters 1-2 are the GST state code. */
export function stateCodeFromGstin(gstin: string): string | null {
  const value = gstin.trim().toUpperCase();
  return GSTIN_REGEX.test(value) ? value.slice(0, 2) : null;
}

export function isValidIfsc(input: string): boolean {
  return IFSC_REGEX.test(input.trim().toUpperCase());
}

export function isValidUdyam(input: string): boolean {
  return UDYAM_REGEX.test(input.trim().toUpperCase());
}

export function isValidTdsSection(input: string): boolean {
  return TDS_SECTION_REGEX.test(input.trim().toUpperCase());
}

export function isValidPincodeIn(input: string): boolean {
  return PINCODE_IN_REGEX.test(input.trim());
}

export function isValidEmail(input: string): boolean {
  return EMAIL_REGEX.test(input.trim());
}

/** Lenient phone rule for landlines / international numbers: 6-15 digits after separators are removed. */
export function isValidPhone(input: string): boolean {
  const trimmed = input.trim();
  if (!PHONE_REGEX.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 6 && digits.length <= 15;
}

/** Strict Indian mobile rule. Separators (spaces, dashes, brackets) are tolerated; letters are not. */
export function isValidMobileIn(input: string): boolean {
  const normalized = normalizePhoneInput(input);
  return normalized !== null && MOBILE_IN_REGEX.test(normalized);
}

/**
 * Removes accepted separators from a typed phone number. Returns null when anything other than
 * digits remains (letters, symbols), so callers can distinguish "messy but fine" from "invalid".
 */
export function normalizePhoneInput(input: string): string | null {
  const stripped = input.trim().replace(PHONE_SEPARATOR_REGEX, '');
  return /^\d*$/.test(stripped) ? stripped : null;
}

export function digitsOnly(input: string): string {
  return input.replace(/\D/g, '');
}

/** Collapses runs of whitespace into one space and trims. Single-line text fields only. */
export function collapseSpaces(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/** Trims and collapses runs of spaces/tabs but keeps line breaks. For remarks, notes, terms. */
export function collapseInlineSpaces(input: string): string {
  return input
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .trim();
}

export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Strict calendar check for YYYY-MM-DD (Date.parse accepts 2024-02-30; this does not). */
export function isValidDateString(input: string): boolean {
  if (!DATE_ONLY_REGEX.test(input)) return false;
  const [y, m, d] = input.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Compares two YYYY-MM-DD strings; ISO date strings sort lexically. */
export function isDateOnOrBefore(start: string, end: string): boolean {
  return start <= end;
}

/**
 * Normalises a website / API URL. A bare host such as "vendor.com" gets "https://" prepended.
 * Returns null when the value is not a URL or uses an unsupported protocol.
 */
export function normalizeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (!(URL_PROTOCOLS as readonly string[]).includes(url.protocol)) return null;
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname) && url.hostname !== 'localhost') return null;
    return url.toString().replace(/\/$/, raw.endsWith('/') ? '/' : '');
  } catch {
    return null;
  }
}

export function isValidUrl(input: string): boolean {
  return normalizeUrl(input) !== null;
}

/** Counts fractional digits of a finite number as typed ("12.50" -> 2). */
export function decimalPlaces(value: number | string): number {
  const text = typeof value === 'number' ? String(value) : value.trim();
  if (/e/i.test(text)) {
    const [mantissa, exp] = text.toLowerCase().split('e');
    const places = (mantissa.split('.')[1] ?? '').length - Number(exp);
    return Math.max(0, places);
  }
  return (text.split('.')[1] ?? '').length;
}

/** Parses a user-typed amount ("1,20,000.50") into a number; NaN when not numeric. */
export function parseDecimalInput(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return Number.NaN;
  const cleaned = value.replace(/,/g, '').trim();
  if (cleaned === '' || !DECIMAL_STRING_REGEX.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}

export function maskAccountNumber(accountNumberOrLast4: string): string {
  const last4 = accountNumberOrLast4.slice(-4);
  return `XXXXXX${last4}`;
}
