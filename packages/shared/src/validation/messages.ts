/**
 * Every user-facing validation message. Forms, the API and tests read from here so wording is
 * identical everywhere and can be changed in one place.
 */
export const MESSAGES = {
  required: (label: string) => `${label} is required`,
  tooShort: (label: string, min: number) => `${label} must be at least ${min} characters`,
  tooLong: (label: string, max: number) => `${label} must be at most ${max} characters`,
  invalidCharacters: (label: string) => `${label} contains characters that are not allowed`,
  personName: (label: string) => `${label} can only contain letters, spaces, dots, apostrophes and hyphens`,
  businessName: (label: string) => `${label} contains characters that are not allowed`,

  mobile: 'Mobile number must contain exactly 10 digits',
  mobileStart: 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9',
  phone: 'Enter a valid phone number (6 to 15 digits)',
  dialCode: 'Country code must look like +91',
  email: 'Please enter a valid email address',
  pincode: 'PIN code must be exactly 6 digits and cannot start with 0',
  postalCode: 'Postal code is too long',
  gstin: 'GSTIN must be 15 characters like 27AAPFU0939F1ZV with a valid check digit',
  pan: 'PAN must be 10 characters in the format AAAAA9999A',
  ifsc: 'IFSC must be 11 characters like HDFC0001234',
  bankAccount: 'Account number must be 6 to 34 letters or digits',
  udyam: 'Udyam number must look like UDYAM-MH-12-1234567',
  tdsSection: 'TDS section must look like 194C or 194IA',
  hsn: 'HSN/SAC must be 4 to 8 digits',
  url: 'Enter a valid website address starting with http:// or https://',
  code: 'Use upper-case letters, digits, dot, underscore, slash or hyphen',
  uuid: (label: string) => `Select a valid ${label}`,

  number: (label: string) => `${label} must be a number`,
  integer: (label: string) => `${label} must be a whole number`,
  negative: (label: string) => `${label} cannot be negative`,
  positive: (label: string) => `${label} must be greater than 0`,
  min: (label: string, min: number) => `${label} must be at least ${min}`,
  max: (label: string, max: number) => `${label} cannot exceed ${max}`,
  decimals: (label: string, places: number) => `${label} can have at most ${places} decimal place${places === 1 ? '' : 's'}`,
  percentage: (label: string) => `${label} must be between 0 and 100`,

  date: (label: string) => `${label} must be a valid date (YYYY-MM-DD)`,
  dateOrder: (startLabel: string, endLabel: string) => `${endLabel} cannot be before ${startLabel}`,

  fileType: (allowed: string) => `Unsupported file type. Allowed: ${allowed}`,
  fileSize: (maxMb: number) => `File is too large. Maximum size is ${maxMb} MB`,
  fileRequired: 'Choose a file to upload',
  fileNameTooLong: 'File name is too long',

  search: 'Search text is too long',
  fixHighlighted: 'Please fix the highlighted fields',
  validationFailed: 'Validation failed',
} as const;
