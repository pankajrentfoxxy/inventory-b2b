/**
 * Typing-time sanitizers. The web <Input sanitize="..."> primitive runs these on every keystroke so
 * invalid characters never appear in the box; the zod schemas re-validate on submit and the API
 * validates again. Keep each sanitizer idempotent and cheap.
 */
export type InputSanitizer =
  | 'digits'
  | 'integer'
  | 'decimal'
  | 'signedDecimal'
  | 'mobile'
  | 'phone'
  | 'pincode'
  | 'gstin'
  | 'pan'
  | 'ifsc'
  | 'hsn'
  | 'accountNumber'
  | 'upper'
  | 'code'
  | 'name'
  | 'email'
  | 'url'
  | 'singleLine';

const FIXED_LENGTH: Partial<Record<InputSanitizer, number>> = {
  mobile: 10,
  pincode: 6,
  gstin: 15,
  pan: 10,
  ifsc: 11,
  hsn: 8,
  accountNumber: 34,
};

function decimal(value: string, allowSign: boolean): string {
  let out = value.replace(allowSign ? /[^0-9.-]/g : /[^0-9.]/g, '');
  if (allowSign) {
    const negative = out.startsWith('-');
    out = out.replace(/-/g, '');
    if (negative) out = `-${out}`;
  }
  const firstDot = out.indexOf('.');
  if (firstDot >= 0) out = out.slice(0, firstDot + 1) + out.slice(firstDot + 1).replace(/\./g, '');
  return out;
}

export function sanitizeInput(kind: InputSanitizer, value: string): string {
  let out: string;
  switch (kind) {
    case 'digits':
    case 'integer':
    case 'mobile':
    case 'pincode':
    case 'hsn':
      out = value.replace(/\D/g, '');
      break;
    case 'decimal':
      out = decimal(value, false);
      break;
    case 'signedDecimal':
      out = decimal(value, true);
      break;
    case 'phone':
      out = value.replace(/[^0-9 ()./-]/g, '');
      break;
    case 'gstin':
    case 'pan':
    case 'ifsc':
    case 'accountNumber':
      out = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      break;
    case 'upper':
      out = value.toUpperCase().replace(/^\s+/, '');
      break;
    case 'code':
      out = value.toUpperCase().replace(/[^A-Z0-9_./-]/g, '');
      break;
    case 'name':
      out = value.replace(/[^\p{L}\p{M} .'-]/gu, '').replace(/^\s+/, '').replace(/\s{2,}/g, ' ');
      break;
    case 'email':
    case 'url':
      out = value.replace(/\s/g, '');
      break;
    case 'singleLine':
      out = value.replace(/[\r\n\t]/g, ' ').replace(/^\s+/, '').replace(/\s{2,}/g, ' ');
      break;
    default:
      out = value;
  }
  const max = FIXED_LENGTH[kind];
  return max ? out.slice(0, max) : out;
}
