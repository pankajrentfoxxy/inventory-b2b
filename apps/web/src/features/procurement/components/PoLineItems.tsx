import { Controller, useFieldArray, useFormContext, type FieldErrors } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import type { TotalsResult } from '@b2b/shared';
import { Button, IconButton, Input } from '../../../components/ui';
import { formatMoney, formatQty } from '../../../lib/utils';
import { LineSpecs } from './LineSpecs';
import { ProductPicker } from './pickers';
import { emptyLine, lineFromProduct, type PoFormValues, type PoLineFormValues } from './poForm.model';

/** Editable PO lines: laptop (SKU) typeahead with read-only specs, quantity, unit price, tax rate override and amount preview. */
export function PoLineItems({ totals }: { totals: TotalsResult }) {
  const { control, register, watch, setValue, getValues, formState: { errors } } = useFormContext<PoFormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: 'lines', keyName: '_key' });
  const lines = watch('lines');
  const rootError = (errors.lines as { message?: string } | undefined)?.message;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto -mx-5 px-5">
        <table className="w-full min-w-[840px] text-sm border-collapse">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-slate-500 border-y border-slate-200 bg-slate-50/60">
              <th className="text-left font-semibold px-3 py-2.5 w-[40%]">Laptop (SKU)</th>
              <th className="text-right font-semibold px-3 py-2.5 w-[13%]">Quantity</th>
              <th className="text-right font-semibold px-3 py-2.5 w-[15%]">Unit price</th>
              <th className="text-right font-semibold px-3 py-2.5 w-[12%]">GST %</th>
              <th className="text-right font-semibold px-3 py-2.5 w-[15%]">Amount</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {fields.map((f, i) => {
              const err = (errors.lines?.[i] ?? {}) as FieldErrors<PoLineFormValues>;
              const line = lines[i];
              const received = line?.receivedQty ?? 0;
              const locked = received > 0;
              return (
                <tr key={f._key} className="align-top">
                  <td className="px-3 py-2.5">
                    <Controller
                      control={control}
                      name={`lines.${i}.itemId`}
                      render={({ field, fieldState }) => (
                        <ProductPicker
                          value={field.value}
                          selectedLabel={line?.itemName ? `${line.itemSku ? `${line.itemSku} - ` : ''}${line.itemName}` : undefined}
                          error={Boolean(fieldState.error)}
                          disabled={locked}
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
                    <LineSpecs specs={line?.specs} className="mt-1.5" />
                    <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-500">
                      {line?.unitCode && <span>Unit {line.unitCode}</span>}
                      {line?.isSerialized && <span>Serialized</span>}
                      {locked && <span className="text-amber-700">{formatQty(received)} already received</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <Input sanitize="decimal" aria-label="Quantity" className="text-right tabular" error={Boolean(err.orderedQty)} {...register(`lines.${i}.orderedQty`)} />
                    {err.orderedQty?.message && <p className="text-xs text-red-600 mt-1">{err.orderedQty.message}</p>}
                  </td>
                  <td className="px-3 py-2.5">
                    <Input sanitize="decimal" aria-label="Unit price" className="text-right tabular" error={Boolean(err.unitPrice)} disabled={locked} {...register(`lines.${i}.unitPrice`)} />
                    {err.unitPrice?.message && <p className="text-xs text-red-600 mt-1">{err.unitPrice.message}</p>}
                  </td>
                  <td className="px-3 py-2.5">
                    <Input sanitize="decimal" aria-label="Tax rate" placeholder={line?.defaultTaxRate || '0'} className="text-right tabular" error={Boolean(err.taxRate)} {...register(`lines.${i}.taxRate`)} />
                    {err.taxRate?.message ? <p className="text-xs text-red-600 mt-1">{err.taxRate.message}</p> : line?.taxRate === '' && line?.defaultTaxRate ? <p className="text-[11px] text-slate-400 mt-1">product default</p> : null}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="inline-block h-9 leading-9 font-medium tabular text-slate-900">{formatMoney(totals.lines[i]?.amount ?? 0)}</span>
                  </td>
                  <td className="px-1 py-2.5">
                    <IconButton icon={Trash2} label="Remove line" size="sm" disabled={fields.length === 1 || locked} onClick={() => remove(i)} className="text-slate-400 hover:text-red-600" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rootError && <p className="text-sm text-red-600">{rootError}</p>}
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" icon={Plus} onClick={() => append(emptyLine())}>
          Add line
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={Plus}
          onClick={() => {
            for (let k = 0; k < 3; k += 1) append(emptyLine());
          }}
        >
          Add 3 lines
        </Button>
      </div>
    </div>
  );
}
