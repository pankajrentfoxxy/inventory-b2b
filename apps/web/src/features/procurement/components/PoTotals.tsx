import type { ReactNode } from 'react';
import type { TotalsResult } from '@b2b/shared';
import { cn, formatMoney } from '../../../lib/utils';
import type { TaxBreakupRow } from '../types';

function Row({ label, value, strong, muted }: { label: ReactNode; value: ReactNode; strong?: boolean; muted?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between gap-4 py-1.5', strong && 'border-t border-slate-200 mt-1 pt-3')}>
      <div className={cn('text-sm', strong ? 'font-semibold text-slate-900 text-base' : muted ? 'text-slate-500' : 'text-slate-700')}>{label}</div>
      <div className={cn('tabular text-right', strong ? 'text-lg font-semibold text-slate-900' : muted ? 'text-slate-500 text-sm' : 'text-slate-900 text-sm')}>{value}</div>
    </div>
  );
}

/**
 * Totals panel. In the editor it shows the live preview from computePurchaseOrderTotals with the
 * discount controls slotted in; on the detail page it shows the persisted figures from the API.
 */
export function PoTotals({ totals, intraState, discountControl, note, currency = 'INR' }: { totals: Pick<TotalsResult, 'subTotal' | 'discountAmount' | 'taxTotal' | 'total'> & { taxBreakup: TaxBreakupRow[] }; intraState: boolean; discountControl?: ReactNode; note?: ReactNode; currency?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
      <Row label="Subtotal" value={formatMoney(totals.subTotal, currency)} />
      {discountControl ? (
        <div className="flex items-center justify-between gap-4 py-1.5">
          <div className="flex items-center gap-2 flex-1">
            <span className="text-sm text-slate-700 shrink-0">Discount</span>
            {discountControl}
          </div>
          <span className="tabular text-sm text-slate-900">{totals.discountAmount > 0 ? `- ${formatMoney(totals.discountAmount, currency)}` : formatMoney(0, currency)}</span>
        </div>
      ) : (
        <Row label="Discount" value={totals.discountAmount > 0 ? `- ${formatMoney(totals.discountAmount, currency)}` : formatMoney(0, currency)} />
      )}
      {totals.taxBreakup.map((b, i) => (
        <Row key={`${b.label}-${b.rate}-${i}`} label={`${b.label} ${b.rate}%`} value={formatMoney(b.amount, currency)} muted />
      ))}
      {totals.taxBreakup.length === 0 && <Row label="Tax" value={formatMoney(totals.taxTotal, currency)} muted />}
      <p className="text-[11px] text-slate-500 pb-1">{intraState ? 'Intra-state supply: CGST + SGST' : 'Inter-state supply: IGST'}</p>
      <Row label="Total" value={formatMoney(totals.total, currency)} strong />
      {note && <p className="text-[11px] text-slate-500 mt-2">{note}</p>}
    </div>
  );
}
