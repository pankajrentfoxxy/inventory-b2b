import { useFieldArray, useFormContext, type FieldErrors } from 'react-hook-form';
import { Plus, Star, Trash2 } from 'lucide-react';
import { Button, Checkbox, Field, Input, Select } from '../../../components/ui';
import { cn } from '../../../lib/utils';
import type { VendorFormOptions } from '../types';
import { emptyAddress, type AddressFormValues, type VendorFormValues } from './vendorForm.model';

function AddressFields({ index, options, disabled }: { index: number; options: VendorFormOptions; disabled?: boolean }) {
  const { register, watch, setValue, formState: { errors } } = useFormContext<VendorFormValues>();
  const err = (errors.addresses?.[index] ?? {}) as FieldErrors<AddressFormValues>;
  const country = watch(`addresses.${index}.countryCode`);
  const base = `addresses.${index}` as const;

  return (
    <div className={cn('space-y-3', disabled && 'opacity-60 pointer-events-none')}>
      <Field label="Attention" htmlFor={`${base}.attention`} error={err.attention?.message}>
        <Input id={`${base}.attention`} {...register(`${base}.attention`)} />
      </Field>
      <Field label="Country / Region" htmlFor={`${base}.countryCode`} error={err.countryCode?.message}>
        <Select id={`${base}.countryCode`} options={options.countries.map((c) => ({ value: c.code, label: c.name }))} {...register(`${base}.countryCode`)} />
      </Field>
      <Field label="Address" error={err.addressLine1?.message ?? err.addressLine2?.message}>
        <div className="space-y-2">
          <Input placeholder="Street 1" aria-label="Address line 1" error={Boolean(err.addressLine1)} {...register(`${base}.addressLine1`)} />
          <Input placeholder="Street 2" aria-label="Address line 2" error={Boolean(err.addressLine2)} {...register(`${base}.addressLine2`)} />
        </div>
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="City" htmlFor={`${base}.city`} error={err.city?.message}>
          <Input id={`${base}.city`} {...register(`${base}.city`)} />
        </Field>
        <Field label="State" htmlFor={`${base}.state`} error={err.state?.message}>
          {country === 'IN' ? (
            <Select
              id={`${base}.state`}
              placeholder="Select state"
              value={watch(`${base}.stateCode`)}
              onChange={(e) => {
                const st = options.indianStates.find((s) => s.code === e.target.value);
                setValue(`${base}.stateCode`, st?.code ?? '', { shouldDirty: true });
                setValue(`${base}.state`, st?.name ?? '', { shouldDirty: true });
              }}
              options={options.indianStates.map((s) => ({ value: s.code, label: s.name }))}
            />
          ) : (
            <Input id={`${base}.state`} {...register(`${base}.state`)} />
          )}
        </Field>
        <Field label={country === 'IN' ? 'PIN Code' : 'Postal Code'} htmlFor={`${base}.postalCode`} error={err.postalCode?.message}>
          <Input id={`${base}.postalCode`} sanitize={country === 'IN' ? 'pincode' : 'singleLine'} maxLength={country === 'IN' ? 6 : 20} error={Boolean(err.postalCode)} {...register(`${base}.postalCode`)} />
        </Field>
        <Field label="Phone" htmlFor={`${base}.phone`} error={err.phone?.message}>
          <Input id={`${base}.phone`} sanitize="phone" maxLength={20} error={Boolean(err.phone)} {...register(`${base}.phone`)} />
        </Field>
      </div>
      <Field label="Fax" htmlFor={`${base}.fax`} error={err.fax?.message}>
        <Input id={`${base}.fax`} sanitize="phone" maxLength={20} className="sm:max-w-xs" error={Boolean(err.fax)} {...register(`${base}.fax`)} />
      </Field>
    </div>
  );
}

function AddressColumn({ type, title, options, disabled, extraHeader }: { type: 'BILLING' | 'SHIPPING'; title: string; options: VendorFormOptions; disabled?: boolean; extraHeader?: React.ReactNode }) {
  const { control, watch, setValue } = useFormContext<VendorFormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: 'addresses', keyName: '_key' });
  const all = watch('addresses');
  const indexes = fields.map((f, i) => ({ f, i })).filter(({ i }) => all[i]?.type === type);

  const setPrimary = (index: number) => {
    all.forEach((a, i) => {
      if (a.type === type) setValue(`addresses.${i}.isPrimary`, i === index, { shouldDirty: true });
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {extraHeader}
      </div>
      {indexes.map(({ f, i }, n) => (
        <div key={f._key} className="rounded-lg border border-slate-200 p-4 space-y-3">
          {indexes.length > 1 && (
            <div className="flex items-center justify-between">
              <button type="button" onClick={() => setPrimary(i)} className={cn('inline-flex items-center gap-1 text-xs font-medium', all[i]?.isPrimary ? 'text-amber-600' : 'text-slate-500 hover:text-slate-800')} aria-pressed={all[i]?.isPrimary}>
                <Star className={cn('w-3.5 h-3.5', all[i]?.isPrimary && 'fill-amber-400')} />
                {all[i]?.isPrimary ? 'Primary address' : 'Set as primary'}
              </button>
              <Button variant="ghost" size="xs" icon={Trash2} onClick={() => remove(i)} disabled={disabled}>
                Remove
              </Button>
            </div>
          )}
          <AddressFields index={i} options={options} disabled={disabled} />
          {n === indexes.length - 1 && !disabled && (
            <Button variant="ghost" size="sm" icon={Plus} onClick={() => append(emptyAddress(type, indexes.length === 0))}>
              Add another {title.toLowerCase()}
            </Button>
          )}
        </div>
      ))}
      {indexes.length === 0 && (
        <Button variant="secondary" size="sm" icon={Plus} onClick={() => append(emptyAddress(type, true))}>
          Add {title.toLowerCase()}
        </Button>
      )}
    </div>
  );
}

export function VendorAddressForm({ options }: { options: VendorFormOptions }) {
  const { register, watch } = useFormContext<VendorFormValues>();
  const same = watch('shippingSameAsBilling');
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <AddressColumn type="BILLING" title="Billing Address" options={options} />
      <AddressColumn type="SHIPPING" title="Shipping Address" options={options} disabled={same} extraHeader={<Checkbox label="Same as billing address" {...register('shippingSameAsBilling')} />} />
    </div>
  );
}
