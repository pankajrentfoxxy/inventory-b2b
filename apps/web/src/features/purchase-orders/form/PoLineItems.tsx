import { useState } from 'react';
import { Controller, useFieldArray, useFormContext, type FieldErrors } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { Button, IconButton, Input, SearchSelect, Select } from '../../../components/ui';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { usePermission } from '../../../lib/auth';
import { cn, formatMoney, formatQty } from '../../../lib/utils';
import { useItemSearch } from '../../items/hooks';
import type { Item } from '../../items/types';
import { ItemFormModal } from '../../items/components/ItemFormModal';
import type { PoFormOptions } from '../types';
import { emptyLine, type PoFormValues, type PoLineFormValues } from './poForm.model';

function ItemPicker({ index, options, onPicked }: { index: number; options: PoFormOptions; onPicked: (item: Item) => void }) {
  const { control, watch } = useFormContext<PoFormValues>();
  const { canCreateItem } = usePermission();
  const [term, setTerm] = useState('');
  const debounced = useDebouncedValue(term, 250);
  const items = useItemSearch(debounced);
  const [newItem, setNewItem] = useState<{ open: boolean; name: string }>({ open: false, name: '' });
  const label = watch(`lines.${index}.itemName`);
  const sku = watch(`lines.${index}.itemSku`);
  void options;

  return (
    <>
      <Controller
        control={control}
        name={`lines.${index}.itemId`}
        render={({ field, fieldState }) => (
          <SearchSelect
            value={field.value}
            selectedLabel={[label, sku ? `(${sku})` : ''].filter(Boolean).join(' ')}
            onChange={(v, o) => {
              field.onChange(v);
              const picked = items.data?.data.find((i) => i.id === v);
              if (picked) onPicked(picked);
              void o;
            }}
            onSearch={setTerm}
            loading={items.isFetching}
            placeholder="Type or click to select an item."
            error={Boolean(fieldState.error)}
            options={(items.data?.data ?? []).map((i) => ({ value: i.id, label: i.name, description: [i.sku, i.purchaseRate !== null ? `Rate ${formatMoney(i.purchaseRate)}` : null, i.tax ? i.tax.name : null].filter(Boolean).join(' - ') || undefined }))}
            emptyText={term ? `No items match "${term}"` : 'No active items yet'}
            footer={
              canCreateItem
                ? (close) => (
                    <button
                      type="button"
                      onClick={() => {
                        close();
                        setNewItem({ open: true, name: term });
                      }}
                      className="flex items-center gap-1.5 px-2 py-1.5 text-sm text-brand-700 hover:underline"
                    >
                      <Plus className="w-4 h-4" /> Add New Item
                    </button>
                  )
                : undefined
            }
          />
        )}
      />
      <ItemFormModal open={newItem.open} initialName={newItem.name} onClose={() => setNewItem({ open: false, name: '' })} onSaved={(item) => onPicked(item)} />
    </>
  );
}

export function PoLineItems({ options, totals }: { options: PoFormOptions; totals: { lines: { amount: number }[] } }) {
  const { control, register, watch, setValue, formState: { errors } } = useFormContext<PoFormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: 'lines', keyName: '_key' });
  const lines = watch('lines');
  const rootError = (errors.lines as { message?: string } | undefined)?.message;
  const defaultTax = options.taxes.find((t) => t.isDefault)?.id ?? '';

  const pick = (index: number, item: Item) => {
    setValue(`lines.${index}.itemId`, item.id, { shouldDirty: true, shouldValidate: true });
    setValue(`lines.${index}.itemName`, item.name);
    setValue(`lines.${index}.itemSku`, item.sku ?? '');
    setValue(`lines.${index}.unit`, item.unit, { shouldDirty: true });
    if (item.purchaseRate !== null) setValue(`lines.${index}.rate`, String(item.purchaseRate), { shouldDirty: true });
    setValue(`lines.${index}.taxId`, item.taxId ?? defaultTax, { shouldDirty: true });
    if (!lines[index]?.description) setValue(`lines.${index}.description`, item.description ?? '', { shouldDirty: true });
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto -mx-5 px-5">
        <table className="w-full min-w-[820px] text-sm border-collapse">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-slate-500 border-y border-slate-200 bg-slate-50/60">
              <th className="text-left font-semibold px-3 py-2.5 w-[38%]">Item Details</th>
              <th className="text-right font-semibold px-3 py-2.5 w-[12%]">Quantity</th>
              <th className="text-right font-semibold px-3 py-2.5 w-[14%]">Rate</th>
              <th className="text-left font-semibold px-3 py-2.5 w-[16%]">Tax</th>
              <th className="text-right font-semibold px-3 py-2.5 w-[14%]">Amount</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {fields.map((f, i) => {
              const err = (errors.lines?.[i] ?? {}) as FieldErrors<PoLineFormValues>;
              const received = lines[i]?.receivedQuantity ?? 0;
              return (
                <tr key={f._key} className="align-top">
                  <td className="px-3 py-2.5">
                    <ItemPicker index={i} options={options} onPicked={(item) => pick(i, item)} />
                    {err.itemId?.message && <p className="text-xs text-red-600 mt-1">{err.itemId.message}</p>}
                    <textarea rows={1} placeholder="Description" aria-label="Line description" className="mt-1.5 w-full rounded-md border border-transparent hover:border-slate-200 focus:border-brand-500 bg-transparent px-2 py-1 text-xs text-slate-700 placeholder:text-slate-400 outline-none resize-y" {...register(`lines.${i}.description`)} />
                    {received > 0 && <p className="text-[11px] text-amber-700 mt-0.5">{formatQty(received)} already received</p>}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <Input sanitize="decimal" aria-label="Quantity" className="text-right tabular" error={Boolean(err.quantity)} {...register(`lines.${i}.quantity`)} />
                      <Input aria-label="Unit" placeholder="unit" className="w-16 px-2 text-xs" {...register(`lines.${i}.unit`)} />
                    </div>
                    {err.quantity?.message && <p className="text-xs text-red-600 mt-1">{err.quantity.message}</p>}
                  </td>
                  <td className="px-3 py-2.5">
                    <Input sanitize="decimal" aria-label="Rate" className="text-right tabular" error={Boolean(err.rate)} {...register(`lines.${i}.rate`)} />
                    {err.rate?.message && <p className="text-xs text-red-600 mt-1">{err.rate.message}</p>}
                  </td>
                  <td className="px-3 py-2.5">
                    <Select aria-label="Tax" placeholder="Select a Tax" options={options.taxes.map((t) => ({ value: t.id, label: `${t.name} [${t.rate}%]` }))} error={Boolean(err.taxId)} {...register(`lines.${i}.taxId`)} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className={cn('inline-block h-9 leading-9 font-medium tabular text-slate-900')}>{formatMoney(totals.lines[i]?.amount ?? 0).replace(/^[^\d-]+/, '')}</span>
                  </td>
                  <td className="px-1 py-2.5">
                    <IconButton icon={Trash2} label="Remove line" size="sm" disabled={fields.length === 1 || received > 0} onClick={() => remove(i)} className="text-slate-400 hover:text-red-600" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rootError && <p className="text-sm text-red-600">{rootError}</p>}
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" icon={Plus} onClick={() => append(emptyLine(defaultTax))}>
          Add New Row
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={Plus}
          onClick={() => {
            for (let k = 0; k < 3; k += 1) append(emptyLine(defaultTax));
          }}
        >
          Add 3 Rows
        </Button>
      </div>
    </div>
  );
}
