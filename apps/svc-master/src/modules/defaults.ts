/** Per-tenant defaults seeded on activation (phase-03 3.3 onboarding order). */
export const DEFAULT_UNITS = [
  { code: 'PCS', name: 'Pieces', decimals: 0, uqc: 'PCS' },
  { code: 'NOS', name: 'Numbers', decimals: 0, uqc: 'NOS' },
  { code: 'SET', name: 'Set', decimals: 0, uqc: 'SET' },
  { code: 'BOX', name: 'Box', decimals: 0, uqc: 'BOX' },
  { code: 'KG', name: 'Kilogram', decimals: 3, uqc: 'KGS' },
  { code: 'LTR', name: 'Litre', decimals: 3, uqc: 'LTR' },
  { code: 'MTR', name: 'Metre', decimals: 2, uqc: 'MTR' },
  { code: 'HRS', name: 'Hours', decimals: 2, uqc: 'OTH' },
];

/** Verify the slabs with the tenant's CA before go-live (phase-03 note). */
export const DEFAULT_TAX_RATES = [
  { name: 'GST 0%', gstRate: 0 },
  { name: 'GST 5%', gstRate: 5 },
  { name: 'GST 12%', gstRate: 12 },
  { name: 'GST 18%', gstRate: 18 },
  { name: 'GST 28%', gstRate: 28 },
];

export const DEFAULT_PAYMENT_TERMS = [
  { name: 'Due on Receipt', days: 0, isDefault: true },
  { name: 'Net 15', days: 15 },
  { name: 'Net 30', days: 30 },
  { name: 'Net 45', days: 45 },
  { name: 'Net 60', days: 60 },
];

export const DEFAULT_GRADES = [
  { code: 'NEW', name: 'New', sortOrder: 0, sellable: true },
  { code: 'A+', name: 'Grade A+', sortOrder: 1, sellable: true },
  { code: 'A', name: 'Grade A', sortOrder: 2, sellable: true },
  { code: 'B', name: 'Grade B', sortOrder: 3, sellable: true },
  { code: 'C', name: 'Grade C', sortOrder: 4, sellable: true },
  { code: 'SCRAP', name: 'Scrap', sortOrder: 9, sellable: false },
];

/** Document types that number locally in their owning service (README 5.3). */
export const DOC_TYPES = ['PO', 'GRN', 'QC', 'ADJ', 'TRF', 'SO', 'DC', 'SHP', 'RMA', 'INV', 'BILL', 'CN', 'DN', 'PAY'] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const DEFAULT_NUMBERING: Record<DocType, { prefixTemplate: string; padding: number }> = {
  PO: { prefixTemplate: 'PO/{FY}/', padding: 4 },
  GRN: { prefixTemplate: 'GRN/{FY}/', padding: 4 },
  QC: { prefixTemplate: 'QC/{FY}/', padding: 4 },
  ADJ: { prefixTemplate: 'ADJ/{FY}/', padding: 4 },
  TRF: { prefixTemplate: 'TRF/{FY}/', padding: 4 },
  SO: { prefixTemplate: 'SO/{FY}/', padding: 4 },
  DC: { prefixTemplate: 'DC/{FY}/', padding: 4 },
  SHP: { prefixTemplate: 'SHP/{FY}/', padding: 4 },
  RMA: { prefixTemplate: 'RMA/{FY}/', padding: 4 },
  INV: { prefixTemplate: 'INV/{FY}/', padding: 4 },
  BILL: { prefixTemplate: 'BILL/{FY}/', padding: 4 },
  CN: { prefixTemplate: 'CN/{FY}/', padding: 4 },
  DN: { prefixTemplate: 'DN/{FY}/', padding: 4 },
  PAY: { prefixTemplate: 'PAY/{FY}/', padding: 4 },
};

/** Indian financial year label for a date, e.g. 2026-05-01 -> "26-27". */
export function financialYear(date: Date, startMonth = 4): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const start = m >= startMonth ? y : y - 1;
  return `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
}
