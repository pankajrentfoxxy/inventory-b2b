import { useFormContext } from 'react-hook-form';
import type { TotalsResult } from '@b2b/shared';
import { Input, Select } from '../../../components/ui';
import { cn, formatMoney } from '../../../lib/utils';
import { sanitizeChange } from '../../../lib/validation';
import type { PoFormOptions } from '../types';
import type { PoFormValues } from './poForm.model';

/** Sub Total / Discount / TDS-TCS / Adjustment / Total panel (right-hand side under the item table). */
export function PoTotals({ options, totals, intraState, vendorState, deliveryState }: { options: PoFormOptions; totals: TotalsResult; intraState: boolean; vendorState: string | null; deliveryState: string | null }) {
  const { register, watch, setValue, formState: { errors } } = useFormContext<PoFormValues>();
  const discountField = register('discountValue');
  const adjustmentField = register('adjustment');
  const discountType = watch('discountType');
  const deductionType = watch('taxDeductionType');
  const deductionLabel = watch('taxDeductionLabel');
  const deductionRate = watch('taxDeductionRate');
  const presets = deductionType === 'TCS' ? options.tcsPresets : options.tdsPresets;
  const presetValue = presets.find((p) => p.label === deductionLabel && String(p.rate) === String(Number(deductionRate)))?.label ?? (deductionLabel ? '__custom' : '');

  const row = (label: React.ReactNode, value: React.ReactNode, opts: { strong?: boolean; muted?: boolean } = {}) => (
    <div className={cn('flex items-center justify-between gap-4 py-2', opts.strong && 'border-t border-slate-200 mt-1 pt-3')}>
      <div className={cn('text-sm', opts.strong ? 'font-semibold text-slate-900 text-base' : 'text-slate-700')}>{label}</div>
      <div className={cn('tabular text-right', opts.strong ? 'text-lg font-semibold text-slate-900' : opts.muted ? 'text-slate-500 text-sm' : 'text-slate-900 text-sm')}>{value}</div>
    </div>
  );

  return (
    <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
      {row('Sub Total', formatMoney(totals.subTotal))}

      <div className="flex items-center justify-between gap-4 py-2">
        <div className="flex items-center gap-2 flex-1">
          <span className="text-sm text-slate-700 w-24 shrink-0">Discount</span>
          <div className="flex items-stretch rounded-lg border border-slate-300 bg-white overflow-hidden max-w-[190px]">
            <input inputMode="decimal" aria-label="Discount value" className={cn('w-24 px-2 text-sm text-right tabular outline-none', errors.discountValue && 'text-red-600')} {...discountField} onChange={sanitizeChange('decimal', discountField.onChange)} />
            <select aria-label="Discount type" className="border-l border-slate-200 bg-slate-50 px-2 text-xs outline-none" {...register('discountType')}>
              <option value="PERCENT">%</option>
              <option value="AMOUNT">INR</option>
            </select>
          </div>
        </div>
        <span className="tabular text-sm text-slate-900">{totals.discountAmount > 0 ? `- ${formatMoney(totals.discountAmount)}` : formatMoney(0)}</span>
      </div>
      {errors.discountValue?.message && <p className="text-xs text-red-600 -mt-1 mb-1">{errors.discountValue.message}</p>}
      {discountType === 'PERCENT' && Number(watch('discountValue')) > 0 && <p className="text-[11px] text-slate-500 -mt-1 mb-1">Applied before tax, pro-rated across line items.</p>}

      {totals.taxBreakup.map((b) => row(<span>{b.label} {b.rate}%</span>, formatMoney(b.amount), { muted: true }))}
      {totals.taxBreakup.length === 0 && totals.taxTotal === 0 && row('Tax', formatMoney(0), { muted: true })}
      {(vendorState || deliveryState) && (
        <p className="text-[11px] text-slate-500 pb-1">
          {intraState ? 'Intra-state supply: CGST + SGST' : 'Inter-state supply: IGST'}
          {vendorState && deliveryState ? ` (vendor ${vendorState} to ${deliveryState})` : ''}
        </p>
      )}

      <div className="py-2 space-y-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-sm text-slate-700 flex-1">
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input type="radio" className="h-3.5 w-3.5 text-brand-600" checked={deductionType === 'TDS'} onChange={() => setValue('taxDeductionType', 'TDS', { shouldDirty: true })} /> TDS
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input type="radio" className="h-3.5 w-3.5 text-brand-600" checked={deductionType === 'TCS'} onChange={() => setValue('taxDeductionType', 'TCS', { shouldDirty: true })} /> TCS
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input type="radio" className="h-3.5 w-3.5 text-brand-600" checked={deductionType === 'NONE'} onChange={() => { setValue('taxDeductionType', 'NONE', { shouldDirty: true }); setValue('taxDeductionRate', '0'); setValue('taxDeductionLabel', ''); }} /> None
            </label>
          </div>
          <span className="tabular text-sm text-slate-900">{deductionType === 'NONE' ? formatMoney(0) : `${deductionType === 'TDS' ? '- ' : '+ '}${formatMoney(totals.taxDeductionAmount)}`}</span>
        </div>
        {deductionType !== 'NONE' && (
          <div className="grid grid-cols-[1fr_88px] gap-2">
            <Select
              aria-label={`${deductionType} tax`}
              placeholder="Select a Tax"
              value={presetValue}
              onChange={(e) => {
                const p = presets.find((x) => x.label === e.target.value);
                if (p) {
                  setValue('taxDeductionLabel', p.label, { shouldDirty: true });
                  setValue('taxDeductionRate', String(p.rate), { shouldDirty: true });
                } else if (e.target.value === '__custom') {
                  setValue('taxDeductionLabel', deductionLabel || `${deductionType} (custom)`, { shouldDirty: true });
                }
              }}
              options={[...presets.map((p) => ({ value: p.label, label: p.label })), { value: '__custom', label: 'Custom rate' }]}
              className="h-8 text-xs"
            />
            <Input sanitize="decimal" aria-label={`${deductionType} rate`} suffix="%" className="h-8 text-xs text-right tabular" error={Boolean(errors.taxDeductionRate)} {...register('taxDeductionRate')} />
            {presetValue === '__custom' && <Input aria-label="Deduction label" placeholder="Section / label" className="h-8 text-xs col-span-2" {...register('taxDeductionLabel')} />}
            {errors.taxDeductionRate?.message && <p className="text-xs text-red-600 col-span-2">{errors.taxDeductionRate.message}</p>}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-4 py-2">
        <div className="flex items-center gap-2 flex-1">
          <input aria-label="Adjustment label" className="w-28 h-8 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-brand-500" {...register('adjustmentLabel')} />
          <input inputMode="decimal" aria-label="Adjustment amount" className={cn('w-24 h-8 rounded-lg border bg-white px-2 text-sm text-right tabular outline-none focus:border-brand-500', errors.adjustment ? 'border-red-400' : 'border-slate-300')} {...adjustmentField} onChange={sanitizeChange('signedDecimal', adjustmentField.onChange)} />
        </div>
        <span className="tabular text-sm text-slate-900">{formatMoney(totals.adjustment)}</span>
      </div>
      {errors.adjustment?.message && <p className="text-xs text-red-600 -mt-1 mb-1">{errors.adjustment.message}</p>}

      {row('Total', formatMoney(totals.total), { strong: true })}
    </div>
  );
}
