import { Controller, useFieldArray, useFormContext, type FieldErrors } from 'react-hook-form';
import { Laptop, Plus, Trash2 } from 'lucide-react';
import type { TotalsResult } from '@b2b/shared';
import { Button, Field, IconButton, Input } from '../../../components/ui';
import { LaptopSpecsView } from '../../../components/LaptopSpecs';
import { formatMoney, formatQty } from '../../../lib/utils';
import { ProductPicker } from './pickers';
import { emptyLine, lineFromProduct, type PoFormValues, type PoLineFormValues } from './poForm.model';

/**
 * Editable PO lines, one card per laptop configuration: pick the exact configuration (its eight
 * specs are shown read-only from the master), then enter quantity, purchase rate, monthly rental,
 * tenure and an optional GST override. A configuration can be on one line only.
 */
export function PoLineItems({ totals }: { totals: TotalsResult }) {
  const { control, register, watch, setValue, getValues, formState: { errors } } = useFormContext<PoFormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: 'lines', keyName: '_key' });
  const lines = watch('lines');
  const rootError = (errors.lines as { message?: string } | undefined)?.message;

  return (
    <div className="space-y-3">
      {fields.map((f, i) => {
        const err = (errors.lines?.[i] ?? {}) as FieldErrors<PoLineFormValues>;
        const line = lines[i];
        const received = line?.receivedQty ?? 0;
        const locked = received > 0;
        const otherIds = lines.filter((l, k) => k !== i && l.itemId).map((l) => l.itemId);
        const id = (name: string) => `po-line-${i}-${name}`;
        return (
          <div key={f._key} className="rounded-xl border border-slate-200 bg-white">
            <div className="flex items-start gap-3 p-4 pb-3">
              <span className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 shrink-0">
                <Laptop className="w-4 h-4" /> {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <Controller
                  control={control}
                  name={`lines.${i}.itemId`}
                  render={({ field, fieldState }) => (
                    <ProductPicker
                      value={field.value}
                      selectedLabel={line?.itemName ? `${line.itemName}${line.itemSku ? ` (${line.itemSku})` : ''}` : undefined}
                      error={Boolean(fieldState.error)}
                      disabled={locked}
                      excludeIds={otherIds}
                      onChange={(id, product) => {
                        field.onChange(id);
                        if (product) {
                          const next = lineFromProduct(product, getValues(`lines.${i}`));
                          setValue(`lines.${i}.itemName`, next.itemName, { shouldDirty: true });
                          setValue(`lines.${i}.itemSku`, next.itemSku);
                          setValue(`lines.${i}.unitCode`, next.unitCode);
                          setValue(`lines.${i}.defaultTaxRate`, next.defaultTaxRate);
                          setValue(`lines.${i}.taxRate`, '');
                          setValue(`lines.${i}.isSerialized`, next.isSerialized);
                          setValue(`lines.${i}.specs`, next.specs);
                        }
                      }}
                    />
                  )}
                />
                {err.itemId?.message && <p className="text-xs text-red-600 mt-1">{err.itemId.message}</p>}
                {(err as { message?: string }).message && <p className="text-xs text-red-600 mt-1">{(err as { message?: string }).message}</p>}
                {locked && <p className="text-[11px] text-amber-700 mt-1">{formatQty(received)} already received; the laptop and rate cannot change</p>}
              </div>
              <IconButton icon={Trash2} label="Remove laptop" size="sm" disabled={fields.length === 1 || locked} onClick={() => remove(i)} className="mt-0.5 text-slate-400 hover:text-red-600" />
            </div>

            <div className="mx-4 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
              {line?.specs ? (
                <LaptopSpecsView specs={line.specs} variant="grid" />
              ) : (
                <p className="text-sm text-slate-500">{line?.itemId ? 'This item has no laptop specifications.' : 'Select a laptop to see its specifications.'}</p>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 p-4">
              <Field label="Quantity" required htmlFor={id('qty')} error={err.orderedQty?.message}>
                <Input id={id('qty')} sanitize="integer" className="text-right tabular" error={Boolean(err.orderedQty)} {...register(`lines.${i}.orderedQty`)} />
              </Field>
              <Field label="Rate" required htmlFor={id('rate')} error={err.unitPrice?.message}>
                <Input id={id('rate')} prefix="INR" sanitize="decimal" className="text-right tabular" error={Boolean(err.unitPrice)} disabled={locked} {...register(`lines.${i}.unitPrice`)} />
              </Field>
              <Field label="Monthly rental" required htmlFor={id('rental')} error={err.monthlyRentalAmount?.message}>
                <Input id={id('rental')} prefix="INR" sanitize="decimal" className="text-right tabular" error={Boolean(err.monthlyRentalAmount)} {...register(`lines.${i}.monthlyRentalAmount`)} />
              </Field>
              <Field label="Tenure" required htmlFor={id('tenure')} error={err.tenureMonths?.message}>
                <Input id={id('tenure')} sanitize="integer" suffix="months" className="text-right tabular" error={Boolean(err.tenureMonths)} {...register(`lines.${i}.tenureMonths`)} />
              </Field>
              <Field label="GST %" htmlFor={id('tax')} error={err.taxRate?.message} hint={line?.taxRate === '' && line?.defaultTaxRate ? 'Laptop default' : undefined}>
                <Input id={id('tax')} sanitize="decimal" placeholder={line?.defaultTaxRate || '0'} className="text-right tabular" error={Boolean(err.taxRate)} {...register(`lines.${i}.taxRate`)} />
              </Field>
              <Field label="Amount">
                <span className="h-9 leading-9 text-right font-semibold tabular text-slate-900">{formatMoney(totals.lines[i]?.amount ?? 0)}</span>
              </Field>
            </div>
          </div>
        );
      })}
      {rootError && <p className="text-sm text-red-600">{rootError}</p>}
      <Button variant="secondary" size="sm" icon={Plus} onClick={() => append(emptyLine())}>
        Add laptop
      </Button>
    </div>
  );
}
