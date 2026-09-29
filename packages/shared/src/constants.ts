/** Master lists shared by API validation and the web forms. Org-specific masters
 *  (GST treatment, source of supply, payment terms, custom fields, tags) live in the DB. */

export const SALUTATIONS = ['Mr.', 'Mrs.', 'Ms.', 'Miss', 'Dr.'] as const;
export type Salutation = (typeof SALUTATIONS)[number];

export const VENDOR_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ta', label: 'Tamil' },
  { code: 'te', label: 'Telugu' },
  { code: 'kn', label: 'Kannada' },
  { code: 'mr', label: 'Marathi' },
  { code: 'gu', label: 'Gujarati' },
  { code: 'bn', label: 'Bengali' },
] as const;
export const DEFAULT_VENDOR_LANGUAGE = 'en';

export const VENDOR_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export const ADDRESS_TYPES = ['BILLING', 'SHIPPING'] as const;
export type AddressType = (typeof ADDRESS_TYPES)[number];

export const BANK_ACCOUNT_TYPES = ['SAVINGS', 'CURRENT', 'CASH_CREDIT', 'OVERDRAFT', 'OTHER'] as const;
export type BankAccountType = (typeof BANK_ACCOUNT_TYPES)[number];
export const BANK_ACCOUNT_TYPE_LABELS: Record<BankAccountType, string> = {
  SAVINGS: 'Savings',
  CURRENT: 'Current',
  CASH_CREDIT: 'Cash Credit',
  OVERDRAFT: 'Overdraft',
  OTHER: 'Other',
};

export const CUSTOM_FIELD_TYPES = ['TEXT', 'NUMBER', 'DATE', 'DROPDOWN', 'BOOLEAN'] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const VENDOR_TYPES = ['SUPPLIER', 'MANUFACTURER', 'SERVICE_PROVIDER', 'CONTRACTOR', 'OTHER'] as const;
export type VendorType = (typeof VENDOR_TYPES)[number];
export const VENDOR_TYPE_LABELS: Record<VendorType, string> = {
  SUPPLIER: 'Supplier',
  MANUFACTURER: 'Manufacturer',
  SERVICE_PROVIDER: 'Service Provider',
  CONTRACTOR: 'Contractor',
  OTHER: 'Other',
};

export const VENDOR_SORT_FIELDS = [
  'displayName',
  'companyName',
  'email',
  'gstin',
  'status',
  'createdAt',
  'updatedAt',
] as const;
export type VendorSortField = (typeof VENDOR_SORT_FIELDS)[number];

export const VENDOR_LIST_MAX_LIMIT = 100;
export const VENDOR_LIST_DEFAULT_LIMIT = 25;

export const COUNTRIES = [
  { code: 'IN', name: 'India', dialCode: '+91' },
  { code: 'AE', name: 'United Arab Emirates', dialCode: '+971' },
  { code: 'AU', name: 'Australia', dialCode: '+61' },
  { code: 'BD', name: 'Bangladesh', dialCode: '+880' },
  { code: 'CA', name: 'Canada', dialCode: '+1' },
  { code: 'CN', name: 'China', dialCode: '+86' },
  { code: 'DE', name: 'Germany', dialCode: '+49' },
  { code: 'FR', name: 'France', dialCode: '+33' },
  { code: 'GB', name: 'United Kingdom', dialCode: '+44' },
  { code: 'HK', name: 'Hong Kong', dialCode: '+852' },
  { code: 'JP', name: 'Japan', dialCode: '+81' },
  { code: 'LK', name: 'Sri Lanka', dialCode: '+94' },
  { code: 'MY', name: 'Malaysia', dialCode: '+60' },
  { code: 'NP', name: 'Nepal', dialCode: '+977' },
  { code: 'SA', name: 'Saudi Arabia', dialCode: '+966' },
  { code: 'SG', name: 'Singapore', dialCode: '+65' },
  { code: 'TH', name: 'Thailand', dialCode: '+66' },
  { code: 'US', name: 'United States', dialCode: '+1' },
  { code: 'VN', name: 'Vietnam', dialCode: '+84' },
] as const;
export const DEFAULT_COUNTRY_CODE = 'IN';
export const DEFAULT_DIAL_CODE = '+91';

/** Indian states / UTs with GST state codes. Seeded into each organization's Source of Supply master. */
export const INDIAN_STATES = [
  { code: '01', short: 'JK', name: 'Jammu and Kashmir' },
  { code: '02', short: 'HP', name: 'Himachal Pradesh' },
  { code: '03', short: 'PB', name: 'Punjab' },
  { code: '04', short: 'CH', name: 'Chandigarh' },
  { code: '05', short: 'UK', name: 'Uttarakhand' },
  { code: '06', short: 'HR', name: 'Haryana' },
  { code: '07', short: 'DL', name: 'Delhi' },
  { code: '08', short: 'RJ', name: 'Rajasthan' },
  { code: '09', short: 'UP', name: 'Uttar Pradesh' },
  { code: '10', short: 'BR', name: 'Bihar' },
  { code: '11', short: 'SK', name: 'Sikkim' },
  { code: '12', short: 'AR', name: 'Arunachal Pradesh' },
  { code: '13', short: 'NL', name: 'Nagaland' },
  { code: '14', short: 'MN', name: 'Manipur' },
  { code: '15', short: 'MZ', name: 'Mizoram' },
  { code: '16', short: 'TR', name: 'Tripura' },
  { code: '17', short: 'ML', name: 'Meghalaya' },
  { code: '18', short: 'AS', name: 'Assam' },
  { code: '19', short: 'WB', name: 'West Bengal' },
  { code: '20', short: 'JH', name: 'Jharkhand' },
  { code: '21', short: 'OD', name: 'Odisha' },
  { code: '22', short: 'CG', name: 'Chhattisgarh' },
  { code: '23', short: 'MP', name: 'Madhya Pradesh' },
  { code: '24', short: 'GJ', name: 'Gujarat' },
  { code: '26', short: 'DD', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '27', short: 'MH', name: 'Maharashtra' },
  { code: '29', short: 'KA', name: 'Karnataka' },
  { code: '30', short: 'GA', name: 'Goa' },
  { code: '31', short: 'LD', name: 'Lakshadweep' },
  { code: '32', short: 'KL', name: 'Kerala' },
  { code: '33', short: 'TN', name: 'Tamil Nadu' },
  { code: '34', short: 'PY', name: 'Puducherry' },
  { code: '35', short: 'AN', name: 'Andaman and Nicobar Islands' },
  { code: '36', short: 'TS', name: 'Telangana' },
  { code: '37', short: 'AP', name: 'Andhra Pradesh' },
  { code: '38', short: 'LA', name: 'Ladakh' },
  { code: '97', short: 'OT', name: 'Other Territory' },
] as const;

/** Default GST treatment master seeded per organization (mirrors Indian GST vendor categories). */
export const DEFAULT_GST_TREATMENTS = [
  { code: 'REGISTERED_BUSINESS_REGULAR', name: 'Registered Business - Regular', description: 'Business that is registered under GST', requiresGstin: true, sortOrder: 1 },
  { code: 'REGISTERED_BUSINESS_COMPOSITION', name: 'Registered Business - Composition', description: 'Business registered under the Composition Scheme', requiresGstin: true, sortOrder: 2 },
  { code: 'UNREGISTERED_BUSINESS', name: 'Unregistered Business', description: 'Business that has not been registered under GST', requiresGstin: false, sortOrder: 3 },
  { code: 'OVERSEAS', name: 'Overseas', description: 'Vendor located outside India', requiresGstin: false, sortOrder: 4 },
  { code: 'SPECIAL_ECONOMIC_ZONE', name: 'Special Economic Zone', description: 'Business located in an SEZ', requiresGstin: true, sortOrder: 5 },
  { code: 'DEEMED_EXPORT', name: 'Deemed Export', description: 'Supplies treated as exports under GST', requiresGstin: true, sortOrder: 6 },
  { code: 'TAX_DEDUCTOR', name: 'Tax Deductor', description: 'Government / notified entity deducting TDS under GST', requiresGstin: true, sortOrder: 7 },
  { code: 'SEZ_DEVELOPER', name: 'SEZ Developer', description: 'Developer of a Special Economic Zone', requiresGstin: true, sortOrder: 8 },
] as const;

export const DEFAULT_PAYMENT_TERMS = [
  { name: 'Due on Receipt', days: 0, isDefault: true },
  { name: 'Net 15', days: 15, isDefault: false },
  { name: 'Net 30', days: 30, isDefault: false },
  { name: 'Net 45', days: 45, isDefault: false },
  { name: 'Net 60', days: 60, isDefault: false },
] as const;

export const DEFAULT_CURRENCIES = [
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'AED' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
] as const;

export const DEFAULT_REPORTING_TAGS = [
  { name: 'Region', options: ['North', 'South', 'East', 'West'] },
  { name: 'Department', options: ['Procurement', 'Operations', 'Finance', 'IT'] },
  { name: 'Business Unit', options: ['Rental', 'Refurbished Sales'] },
  { name: 'Vendor Category', options: ['OEM', 'Distributor', 'Local Supplier', 'Service'] },
] as const;

/** Vendor audit-log actions. Stored as strings so new actions never need a migration. */
export const VENDOR_ACTIVITY_ACTIONS = [
  'VENDOR_CREATED',
  'VENDOR_UPDATED',
  'VENDOR_STATUS_CHANGED',
  'VENDOR_DELETED',
  'CONTACT_ADDED',
  'CONTACT_UPDATED',
  'CONTACT_REMOVED',
  'ADDRESS_ADDED',
  'ADDRESS_UPDATED',
  'ADDRESS_REMOVED',
  'BANK_ACCOUNT_ADDED',
  'BANK_ACCOUNT_UPDATED',
  'BANK_ACCOUNT_REMOVED',
  'BANK_ACCOUNT_REVEALED',
  'CUSTOM_FIELDS_UPDATED',
  'REPORTING_TAGS_UPDATED',
  'NOTE_ADDED',
  'NOTE_REMOVED',
  'DOCUMENT_UPLOADED',
  'DOCUMENT_REMOVED',
] as const;
export type VendorActivityAction = (typeof VENDOR_ACTIVITY_ACTIONS)[number];
