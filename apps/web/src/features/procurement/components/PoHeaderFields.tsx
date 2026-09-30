import { Controller, useFormContext } from 'react-hook-form';
import { Field, Input, Select, Textarea } from '../../../components/ui';
import { usePaymentTerms, useScopedWarehouses } from '../hooks';
import { SupplierPicker, WarehouseSelect } from './pickers';
import type { PoFormValues } from './poForm.model';

/** Supplier, ship-to warehouse, dates, payment term, notes and terms. */
export function PoHeaderFields() {
  const { control, register, watch, setValue, formState: { errors } } = useFormContext<PoFormValues>();
  const terms = usePaymentTerms();
  const { byId } = useScopedWarehouses();
  const supplierName = watch('supplierName');
  const supplierGstin = watch('supplierGstin');
  const supplierState = watch('supplierStateCode');
  const shipToState = watch('shipToStateCode');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-4">
      <div className="space-y-4">
        <Field label="Vendor" required error={errors.supplierId?.message}>
          <Controller
            control={control}
            name="supplierId"
            render={({ field, fieldState }) => (
              <SupplierPicker
                value={field.value}
                selectedLabel={supplierName || undefined}
                error={Boolean(fieldState.error)}
                onChange={(id, s) => {
                  field.onChange(id);
                  setValue('supplierName', s?.displayName ?? '', { shouldDirty: true });
                  setValue('supplierGstin', s?.gstin ?? '', { shouldDirty: true });
                  setValue('supplierStateCode', s?.stateCode ?? '', { shouldDirty: true });
                  if (s?.paymentTermId && !watch('paymentTermId')) setValue('paymentTermId', s.paymentTermId, { shouldDirty: true });
                }}
              />
            )}
          />
          {supplierName && (
            <div className="mt-2 rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600 space-y-0.5">
              <p>
                <span className="text-slate-500">GSTIN:</span> {supplierGstin ? <span className="font-mono text-slate-900">{supplierGstin}</span> : <span className="text-slate-400">not provided</span>}
              </p>
              <p>
                <span className="text-slate-500">State:</span> {supplierState ? <span className="text-slate-900">{supplierState}</span> : <span className="text-slate-400">unknown (treated as intra-state)</span>}
                {supplierState && shipToState && <span className="ml-2 text-slate-500">{supplierState === shipToState ? 'Intra-state supply (CGST + SGST)' : 'Inter-state supply (IGST)'}</span>}
              </p>
            </div>
          )}
        </Field>

        <Field label="Ship to warehouse" required error={errors.shipToWarehouseId?.message} hint="Only warehouses in your scope are listed">
          <Controller
            control={control}
            name="shipToWarehouseId"
            render={({ field, fieldState }) => (
              <WarehouseSelect
                value={field.value}
                error={Boolean(fieldState.error)}
                onChange={(id, w) => {
                  field.onChange(id);
                  setValue('shipToStateCode', (w ?? byId(id))?.stateCode ?? '', { shouldDirty: true });
                }}
              />
            )}
          />
        </Field>

        <Field label="Payment term" error={errors.paymentTermId?.message}>
          <Select {...register('paymentTermId')} placeholder={terms.isLoading ? 'Loading...' : 'Vendor default'} options={(terms.data ?? []).map((t) => ({ value: t.id, label: `${t.name} (${t.days} days)` }))} error={Boolean(errors.paymentTermId)} />
        </Field>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Order date" required error={errors.orderDate?.message} htmlFor="po-orderDate">
            <Input id="po-orderDate" type="date" {...register('orderDate')} error={Boolean(errors.orderDate)} />
          </Field>
          <Field label="Expected date" error={errors.expectedDate?.message} htmlFor="po-expectedDate">
            <Input id="po-expectedDate" type="date" {...register('expectedDate')} error={Boolean(errors.expectedDate)} />
          </Field>
        </div>
        <Field label="Notes" error={errors.notes?.message} hint="Internal notes, up to 1000 characters">
          <Textarea rows={3} maxLength={1000} {...register('notes')} error={Boolean(errors.notes)} placeholder="Internal notes for the purchasing team" />
        </Field>
        <Field label="Terms and conditions" error={errors.terms?.message} hint="Printed on the order, up to 2000 characters">
          <Textarea rows={3} maxLength={2000} {...register('terms')} error={Boolean(errors.terms)} placeholder="Delivery, payment and warranty terms shown to the vendor" />
        </Field>
      </div>
    </div>
  );
}
