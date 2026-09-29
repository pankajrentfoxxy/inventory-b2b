import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { ITEM_UNITS, itemSchema, type ItemPayload } from '@b2b/shared';
import { Button, Checkbox, Combobox, Field, Input, Modal, RadioPill, SearchSelect, Select, Textarea } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { applyServerErrors, applyZodIssues, summarizeErrors } from '../../../lib/validation';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useVendors } from '../../vendors/hooks';
import { usePurchaseOrderFormOptions } from '../../purchase-orders/hooks';
import { useCreateItem, useUpdateItem } from '../hooks';
import type { Item } from '../types';

interface ItemFormValues {
  name: string;
  sku: string;
  type: 'GOODS' | 'SERVICE';
  unit: string;
  description: string;
  hsnCode: string;
  purchaseRate: string;
  sellingRate: string;
  taxId: string;
  preferredVendorId: string;
  preferredVendorName: string;
  trackInventory: boolean;
  reorderLevel: string;
}

function toValues(item?: Item | null, defaultTaxId = ''): ItemFormValues {
  return {
    name: item?.name ?? '',
    sku: item?.sku ?? '',
    type: item?.type ?? 'GOODS',
    unit: item?.unit ?? 'pcs',
    description: item?.description ?? '',
    hsnCode: item?.hsnCode ?? '',
    purchaseRate: item?.purchaseRate === null || item?.purchaseRate === undefined ? '' : String(item.purchaseRate),
    sellingRate: item?.sellingRate === null || item?.sellingRate === undefined ? '' : String(item.sellingRate),
    taxId: item?.taxId ?? defaultTaxId,
    preferredVendorId: item?.preferredVendorId ?? '',
    preferredVendorName: item?.preferredVendor?.displayName ?? '',
    trackInventory: item?.trackInventory ?? true,
    reorderLevel: item?.reorderLevel === null || item?.reorderLevel === undefined ? '' : String(item.reorderLevel),
  };
}

/** Create / edit an item. Used from the Items list and inline from the PO line picker. */
export function ItemFormModal({ open, onClose, item, onSaved, initialName }: { open: boolean; onClose: () => void; item?: Item | null; onSaved?: (item: Item) => void; initialName?: string }) {
  const options = usePurchaseOrderFormOptions(open);
  const create = useCreateItem();
  const update = useUpdateItem();
  const defaultTaxId = options.data?.taxes.find((t) => t.isDefault)?.id ?? '';
  const defaults = useMemo(() => ({ ...toValues(item, defaultTaxId), ...(initialName && !item ? { name: initialName } : {}) }), [item, defaultTaxId, initialName]);
  const form = useForm<ItemFormValues>({ defaultValues: defaults });
  const { register, control, handleSubmit, reset, setError, watch, formState: { errors, isDirty } } = form;

  useEffect(() => {
    if (open) reset(defaults);
  }, [open, defaults, reset]);

  const [vendorTerm, setVendorTerm] = useState('');
  const debouncedVendor = useDebouncedValue(vendorTerm, 250);
  const vendors = useVendors({ page: 1, limit: 15, search: debouncedVendor, status: 'ACTIVE', sortBy: 'displayName', sortOrder: 'asc', gstTreatmentId: '', sourceOfSupplyId: '', vendorType: '', tagOptionId: '' });
  const type = watch('type');

  const submit = handleSubmit(async (v) => {
    const parsed = itemSchema.safeParse({
      name: v.name,
      sku: v.sku,
      type: v.type,
      unit: v.unit,
      description: v.description,
      hsnCode: v.hsnCode,
      purchaseRate: v.purchaseRate,
      sellingRate: v.sellingRate,
      taxId: v.taxId,
      preferredVendorId: v.preferredVendorId,
      trackInventory: v.type === 'GOODS' ? v.trackInventory : false,
      reorderLevel: v.reorderLevel,
      isActive: item?.isActive ?? true,
    });
    if (!parsed.success) {
      applyZodIssues(setError, parsed.error);
      return;
    }
    try {
      const payload: ItemPayload = parsed.data;
      const saved = item ? await update.mutateAsync({ id: item.id, payload }) : await create.mutateAsync(payload);
      toast.success(item ? `${saved.name} updated` : `${saved.name} created`);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      const e = toApiError(err);
      toast.error(summarizeErrors(applyServerErrors(setError, e), e.message));
    }
  });

  const saving = create.isPending || update.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item ? `Edit ${item.name}` : 'New Item'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={saving}>
            {item ? 'Save Changes' : 'Save Item'}
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate className="space-y-4">
        <Field label="Type" inline>
          <Controller control={control} name="type" render={({ field }) => <RadioPill name="Item type" value={field.value} onChange={field.onChange} options={[{ value: 'GOODS', label: 'Goods' }, { value: 'SERVICE', label: 'Service' }]} />} />
        </Field>
        <Field label="Name" required inline htmlFor="item-name" error={errors.name?.message}>
          <Input id="item-name" autoFocus sanitize="singleLine" maxLength={200} error={Boolean(errors.name)} {...register('name')} />
        </Field>
        <Field label="SKU" inline htmlFor="item-sku" error={errors.sku?.message} hint="Stock keeping unit. Must be unique in your organization.">
          <Input id="item-sku" sanitize="code" maxLength={60} className="sm:max-w-xs uppercase" error={Boolean(errors.sku)} {...register('sku')} />
        </Field>
        <Field label="Unit" required inline error={errors.unit?.message}>
          <Controller control={control} name="unit" render={({ field }) => <Combobox value={field.value} onChange={field.onChange} onBlur={field.onBlur} options={[...ITEM_UNITS]} placeholder="pcs" className="sm:max-w-xs" error={Boolean(errors.unit)} />} />
        </Field>
        <Field label={type === 'SERVICE' ? 'SAC' : 'HSN Code'} inline htmlFor="item-hsn" error={errors.hsnCode?.message}>
          <Input id="item-hsn" sanitize="hsn" className="sm:max-w-xs font-mono tabular" error={Boolean(errors.hsnCode)} {...register('hsnCode')} />
        </Field>
        <Field label="Tax" inline htmlFor="item-tax" error={errors.taxId?.message}>
          <Select id="item-tax" placeholder="No tax" className="sm:max-w-xs" options={(options.data?.taxes ?? []).map((t) => ({ value: t.id, label: `${t.name} [${t.rate}%]` }))} {...register('taxId')} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Purchase Rate" htmlFor="item-purchase" error={errors.purchaseRate?.message}>
            <Input id="item-purchase" prefix="INR" sanitize="decimal" className="tabular" error={Boolean(errors.purchaseRate)} {...register('purchaseRate')} />
          </Field>
          <Field label="Selling Rate" htmlFor="item-selling" error={errors.sellingRate?.message}>
            <Input id="item-selling" prefix="INR" sanitize="decimal" className="tabular" error={Boolean(errors.sellingRate)} {...register('sellingRate')} />
          </Field>
        </div>
        <Field label="Preferred Vendor" inline error={errors.preferredVendorId?.message}>
          <Controller
            control={control}
            name="preferredVendorId"
            render={({ field }) => (
              <SearchSelect
                value={field.value}
                selectedLabel={watch('preferredVendorName')}
                onChange={(v, o) => {
                  field.onChange(v);
                  form.setValue('preferredVendorName', o?.label ?? '');
                }}
                onSearch={setVendorTerm}
                loading={vendors.isFetching}
                allowClear
                placeholder="Select a vendor"
                options={(vendors.data?.data ?? []).map((v) => ({ value: v.id, label: v.displayName, description: v.companyName ?? undefined }))}
              />
            )}
          />
        </Field>
        {type === 'GOODS' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
            <Checkbox label="Track inventory for this item" description="Stock levels will be maintained once the Inventory module goes live." {...register('trackInventory')} />
            <Field label="Reorder Level" htmlFor="item-reorder" error={errors.reorderLevel?.message}>
              <Input id="item-reorder" sanitize="decimal" className="tabular" error={Boolean(errors.reorderLevel)} {...register('reorderLevel')} />
            </Field>
          </div>
        )}
        <Field label="Description" inline htmlFor="item-desc" error={errors.description?.message}>
          <Textarea id="item-desc" rows={3} placeholder="Shown on purchase orders by default" {...register('description')} />
        </Field>
        {isDirty && <p className="text-xs text-slate-400 text-right">Unsaved changes</p>}
      </form>
    </Modal>
  );
}
