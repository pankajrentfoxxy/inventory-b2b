/**
 * Purchase order arithmetic, shared by the API (source of truth, persisted) and the web form
 * (live preview). Indian GST rules: a transaction-level discount is pro-rated across lines
 * before tax; intra-state supplies split the rate into CGST + SGST, inter-state charges IGST.
 */
import type { DiscountType, TaxDeductionType } from './purchase.schema.js';

export interface TotalsLineInput {
  quantity: number;
  rate: number;
  /** Percent, e.g. 18 for GST18. 0 or null for untaxed lines. */
  taxRate: number | null;
}

export interface TotalsInput {
  lines: TotalsLineInput[];
  discountType: DiscountType;
  discountValue: number;
  taxDeductionType: TaxDeductionType;
  taxDeductionRate: number;
  adjustment: number;
  /** True when the vendor's source of supply equals the delivery state (CGST + SGST). */
  intraState: boolean;
}

export interface TotalsLineResult {
  amount: number;
  discountShare: number;
  taxableAmount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
}

export interface TaxBreakupRow {
  label: 'CGST' | 'SGST' | 'IGST';
  rate: number;
  amount: number;
}

export interface TotalsResult {
  lines: TotalsLineResult[];
  subTotal: number;
  discountAmount: number;
  taxableTotal: number;
  taxTotal: number;
  taxBreakup: TaxBreakupRow[];
  /** Positive number; subtracted for TDS, added for TCS. */
  taxDeductionAmount: number;
  adjustment: number;
  total: number;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computePurchaseOrderTotals(input: TotalsInput): TotalsResult {
  const rawLines = input.lines.map((l) => ({
    amount: round2((Number(l.quantity) || 0) * (Number(l.rate) || 0)),
    taxRate: Number(l.taxRate) || 0,
  }));
  const subTotal = round2(rawLines.reduce((s, l) => s + l.amount, 0));

  let discountAmount = 0;
  if (input.discountValue > 0 && subTotal > 0) {
    discountAmount = input.discountType === 'PERCENT' ? round2((subTotal * input.discountValue) / 100) : round2(Math.min(input.discountValue, subTotal));
  }

  // Pro-rate the discount by line amount; push rounding remainder onto the last non-zero line.
  const shares = rawLines.map((l) => (subTotal > 0 ? round2((discountAmount * l.amount) / subTotal) : 0));
  const shareSum = round2(shares.reduce((s, x) => s + x, 0));
  const drift = round2(discountAmount - shareSum);
  if (drift !== 0) {
    for (let i = shares.length - 1; i >= 0; i -= 1) {
      if (rawLines[i].amount > 0) {
        shares[i] = round2(shares[i] + drift);
        break;
      }
    }
  }

  const byRate = new Map<number, number>();
  const lines: TotalsLineResult[] = rawLines.map((l, i) => {
    const taxableAmount = round2(l.amount - shares[i]);
    const taxAmount = round2((taxableAmount * l.taxRate) / 100);
    if (l.taxRate > 0) byRate.set(l.taxRate, round2((byRate.get(l.taxRate) ?? 0) + taxAmount));
    return { amount: l.amount, discountShare: shares[i], taxableAmount, taxRate: l.taxRate, taxAmount, total: round2(taxableAmount + taxAmount) };
  });

  const taxableTotal = round2(lines.reduce((s, l) => s + l.taxableAmount, 0));
  const taxTotal = round2(lines.reduce((s, l) => s + l.taxAmount, 0));

  const taxBreakup: TaxBreakupRow[] = [];
  for (const [rate, amount] of [...byRate.entries()].sort((a, b) => a[0] - b[0])) {
    if (input.intraState) {
      const half = round2(amount / 2);
      taxBreakup.push({ label: 'CGST', rate: rate / 2, amount: half });
      taxBreakup.push({ label: 'SGST', rate: rate / 2, amount: round2(amount - half) });
    } else {
      taxBreakup.push({ label: 'IGST', rate, amount });
    }
  }

  const taxDeductionAmount = input.taxDeductionType === 'NONE' ? 0 : round2((taxableTotal * (Number(input.taxDeductionRate) || 0)) / 100);
  const signedDeduction = input.taxDeductionType === 'TDS' ? -taxDeductionAmount : input.taxDeductionType === 'TCS' ? taxDeductionAmount : 0;
  const adjustment = round2(Number(input.adjustment) || 0);
  const total = round2(taxableTotal + taxTotal + signedDeduction + adjustment);

  return { lines, subTotal, discountAmount, taxableTotal, taxTotal, taxBreakup, taxDeductionAmount, adjustment, total };
}

export function formatDocumentNumber(prefix: string, n: number, padding: number): string {
  return `${prefix}${String(n).padStart(padding, '0')}`;
}
