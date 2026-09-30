import { Controller, useFieldArray, type UseFormReturn } from 'react-hook-form';
import { Plus, Star, Trash2 } from 'lucide-react';
import { BANK_ACCOUNT_TYPE_LABELS, BANK_ACCOUNT_TYPES } from '@b2b/shared';
import { Badge, Button, Checkbox, EmptyState, Field, IconButton, Input, RadioPill, Select, Textarea } from '../../../components/ui';
import { cn } from '../../../lib/utils';
import { useSimpleMaster } from '../../master/hooks';
import { GSTIN_REQUIRED_TREATMENTS, GST_TREATMENTS, GST_TREATMENT_LABELS, type PartyType } from '../types';
import { STATE_OPTIONS, emptyAddress, emptyBankAccount, emptyContact, type PartyFormValues } from './partyForm.model';

type Form = UseFormReturn<PartyFormValues>;

/* ---- basic --------------------------------------------------------------------- */

export function PartyBasicFields({ form, type, mode }: { form: Form; type: PartyType; mode: 'create' | 'edit' }) {
  const { register, watch, formState: { errors } } = form;
  const paymentTerms = useSimpleMaster('payment-terms', false);
  const treatment = watch('gstTreatment');
  const gstinRequired = GSTIN_REQUIRED_TREATMENTS.includes(treatment);
  const noun = type === 'SUPPLIER' ? 'supplier' : 'customer';

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Field label="Legal name" required htmlFor="pf-legal" error={errors.legalName?.message} hint="Name on the GST registration / invoices">
        <Input id="pf-legal" autoFocus={mode === 'create'} sanitize="name" maxLength={200} error={Boolean(errors.legalName)} {...register('legalName')} />
      </Field>
      <Field label="Display name" required htmlFor="pf-display" error={errors.displayName?.message} hint="Shown in lists and pickers">
        <Input id="pf-display" sanitize="name" maxLength={150} error={Boolean(errors.displayName)} {...register('displayName')} />
      </Field>
      {mode === 'create' && (
        <Field label="Code" htmlFor="pf-code" error={errors.code?.message} hint={`Optional; generated from the display name when left empty. Unique per ${noun}.`}>
          <Input id="pf-code" sanitize="code" maxLength={40} className="font-mono" error={Boolean(errors.code)} {...register('code')} />
        </Field>
      )}
      <Field label="GST treatment" required htmlFor="pf-gst-treatment" error={errors.gstTreatment?.message}>
        <Select id="pf-gst-treatment" options={GST_TREATMENTS.map((t) => ({ value: t, label: GST_TREATMENT_LABELS[t] }))} error={Boolean(errors.gstTreatment)} {...register('gstTreatment')} />
      </Field>
      <Field label="GSTIN" required={gstinRequired} htmlFor="pf-gstin" error={errors.gstin?.message} hint="The state code (first two digits) must match the default billing address.">
        <Input id="pf-gstin" sanitize="gstin" className="font-mono" error={Boolean(errors.gstin)} {...register('gstin')} />
      </Field>
      <Field label="PAN" htmlFor="pf-pan" error={errors.pan?.message} hint="Must match characters 3-12 of the GSTIN when both are given.">
        <Input id="pf-pan" sanitize="pan" className="font-mono" error={Boolean(errors.pan)} {...register('pan')} />
      </Field>
      <Field label="Email" htmlFor="pf-email" error={errors.email?.message}>
        <Input id="pf-email" type="email" sanitize="email" maxLength={254} error={Boolean(errors.email)} {...register('email')} />
      </Field>
      <Field label="Phone" htmlFor="pf-phone" error={errors.phone?.message}>
        <Input id="pf-phone" sanitize="phone" className="tabular" error={Boolean(errors.phone)} {...register('phone')} />
      </Field>
      <Field label="Website" htmlFor="pf-web" error={errors.website?.message}>
        <Input id="pf-web" sanitize="url" maxLength={200} error={Boolean(errors.website)} {...register('website')} />
      </Field>
      <Field label="Payment terms" htmlFor="pf-terms" error={errors.paymentTermId?.message}>
        <Select id="pf-terms" placeholder={paymentTerms.isLoading ? 'Loading...' : 'None'} options={(paymentTerms.data ?? []).map((t) => ({ value: t.id, label: `${t.name} (${t.days} days)` }))} error={Boolean(errors.paymentTermId)} {...register('paymentTermId')} />
      </Field>
      <Field label="Credit limit" htmlFor="pf-credit" error={errors.creditLimit?.message}>
        <Input id="pf-credit" prefix="INR" sanitize="decimal" className="tabular" error={Boolean(errors.creditLimit)} {...register('creditLimit')} />
      </Field>
      <Field label="Credit days" htmlFor="pf-credit-days" error={errors.creditDays?.message}>
        <Input id="pf-credit-days" sanitize="integer" className="tabular" error={Boolean(errors.creditDays)} {...register('creditDays')} />
      </Field>
      <Field label="Remarks" htmlFor="pf-remarks" error={errors.remarks?.message} className="md:col-span-2">
        <Textarea id="pf-remarks" rows={3} maxLength={2000} error={Boolean(errors.remarks)} {...register('remarks')} />
      </Field>
    </div>
  );
}

/* ---- addresses ------------------------------------------------------------------ */

export function AddressFields({ form, index, hideKind }: { form: Form; index: number; hideKind?: boolean }) {
  const { register, control, formState: { errors } } = form;
  const e = errors.addresses?.[index];
  const id = (f: string) => `pf-addr-${index}-${f}`;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {!hideKind && (
        <Field label="Kind" error={e?.kind?.message}>
          <Controller control={control} name={`addresses.${index}.kind`} render={({ field }) => <RadioPill name="Address kind" value={field.value} onChange={field.onChange} options={[{ value: 'BILLING', label: 'Billing' }, { value: 'SHIPPING', label: 'Shipping' }]} />} />
        </Field>
      )}
      <Field label="Attention" htmlFor={id('attn')} error={e?.attention?.message}>
        <Input id={id('attn')} sanitize="singleLine" maxLength={100} error={Boolean(e?.attention)} {...register(`addresses.${index}.attention`)} />
      </Field>
      <Field label="Address line 1" required htmlFor={id('l1')} error={e?.line1?.message} className="md:col-span-2">
        <Input id={id('l1')} sanitize="singleLine" maxLength={200} error={Boolean(e?.line1)} {...register(`addresses.${index}.line1`)} />
      </Field>
      <Field label="Address line 2" htmlFor={id('l2')} error={e?.line2?.message} className="md:col-span-2">
        <Input id={id('l2')} sanitize="singleLine" maxLength={200} error={Boolean(e?.line2)} {...register(`addresses.${index}.line2`)} />
      </Field>
      <Field label="City" required htmlFor={id('city')} error={e?.city?.message}>
        <Input id={id('city')} sanitize="singleLine" maxLength={100} error={Boolean(e?.city)} {...register(`addresses.${index}.city`)} />
      </Field>
      <Field label="State" required htmlFor={id('state')} error={e?.stateCode?.message}>
        <Select id={id('state')} placeholder="Select a state" options={STATE_OPTIONS} error={Boolean(e?.stateCode)} {...register(`addresses.${index}.stateCode`)} />
      </Field>
      <Field label="PIN code" required htmlFor={id('pin')} error={e?.pincode?.message}>
        <Input id={id('pin')} sanitize="pincode" className="tabular" error={Boolean(e?.pincode)} {...register(`addresses.${index}.pincode`)} />
      </Field>
      <Field label="Country" htmlFor={id('country')} error={e?.country?.message} hint="Two-letter ISO code">
        <Input id={id('country')} sanitize="upper" maxLength={2} className="font-mono" error={Boolean(e?.country)} {...register(`addresses.${index}.country`)} />
      </Field>
      <Field label="Phone" htmlFor={id('phone')} error={e?.phone?.message}>
        <Input id={id('phone')} sanitize="phone" className="tabular" error={Boolean(e?.phone)} {...register(`addresses.${index}.phone`)} />
      </Field>
      <div className="flex items-end pb-1">
        <Checkbox label="Default for this kind" description="One default billing and one default shipping address" {...register(`addresses.${index}.isDefault`)} />
      </div>
    </div>
  );
}

export function AddressesSection({ form }: { form: Form }) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'addresses' });
  const kinds = form.watch('addresses');
  return (
    <div className="space-y-4">
      {fields.length === 0 && <EmptyState title="No addresses" hint="A default billing address is needed for GST validation and invoices." className="py-6" />}
      {fields.map((f, i) => (
        <div key={f.id} className="rounded-xl border border-slate-200 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-800 inline-flex items-center gap-2">
              <Badge tone={kinds?.[i]?.kind === 'SHIPPING' ? 'purple' : 'blue'}>{kinds?.[i]?.kind === 'SHIPPING' ? 'Shipping' : 'Billing'}</Badge>
              Address {i + 1}
              {kinds?.[i]?.isDefault && <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400" aria-label="Default" />}
            </p>
            <IconButton icon={Trash2} label="Remove address" size="sm" onClick={() => remove(i)} />
          </div>
          <AddressFields form={form} index={i} />
        </div>
      ))}
      <div className="flex gap-2">
        <Button type="button" variant="secondary" size="sm" icon={Plus} onClick={() => append(emptyAddress('BILLING', !kinds.some((a) => a.kind === 'BILLING')))}>
          Add billing address
        </Button>
        <Button type="button" variant="secondary" size="sm" icon={Plus} onClick={() => append(emptyAddress('SHIPPING', !kinds.some((a) => a.kind === 'SHIPPING')))}>
          Add shipping address
        </Button>
      </div>
    </div>
  );
}

/* ---- contacts --------------------------------------------------------------------- */

export function ContactFields({ form, index }: { form: Form; index: number }) {
  const { register, formState: { errors } } = form;
  const e = errors.contacts?.[index];
  const id = (f: string) => `pf-contact-${index}-${f}`;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Field label="Name" required htmlFor={id('name')} error={e?.name?.message}>
        <Input id={id('name')} sanitize="name" maxLength={100} error={Boolean(e?.name)} {...register(`contacts.${index}.name`)} />
      </Field>
      <Field label="Designation" htmlFor={id('desig')} error={e?.designation?.message}>
        <Input id={id('desig')} sanitize="singleLine" maxLength={100} error={Boolean(e?.designation)} {...register(`contacts.${index}.designation`)} />
      </Field>
      <Field label="Email" htmlFor={id('email')} error={e?.email?.message}>
        <Input id={id('email')} type="email" sanitize="email" maxLength={254} error={Boolean(e?.email)} {...register(`contacts.${index}.email`)} />
      </Field>
      <Field label="Phone" htmlFor={id('phone')} error={e?.phone?.message}>
        <Input id={id('phone')} sanitize="phone" className="tabular" error={Boolean(e?.phone)} {...register(`contacts.${index}.phone`)} />
      </Field>
      <div className="flex items-end pb-1 md:col-span-2">
        <Checkbox label="Primary contact" description="Used on documents and notifications" {...register(`contacts.${index}.isPrimary`)} />
      </div>
    </div>
  );
}

export function ContactsSection({ form }: { form: Form }) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'contacts' });
  const values = form.watch('contacts');
  const setPrimary = (index: number) => values.forEach((_c, i) => form.setValue(`contacts.${i}.isPrimary`, i === index));
  return (
    <div className="space-y-4">
      {fields.length === 0 && <EmptyState title="No contact persons" hint="Optional. The first contact becomes the primary one." className="py-6" />}
      {fields.map((f, i) => (
        <div key={f.id} className="rounded-xl border border-slate-200 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-800 inline-flex items-center gap-2">
              Contact {i + 1}
              {values?.[i]?.isPrimary ? <Badge tone="blue"><Star className="w-3 h-3" /> Primary</Badge> : <button type="button" onClick={() => setPrimary(i)} className={cn('text-xs text-brand-700 hover:underline')}>Make primary</button>}
            </p>
            <IconButton icon={Trash2} label="Remove contact" size="sm" onClick={() => remove(i)} />
          </div>
          <ContactFields form={form} index={i} />
        </div>
      ))}
      <Button type="button" variant="secondary" size="sm" icon={Plus} onClick={() => append(emptyContact(fields.length === 0))}>
        Add contact
      </Button>
    </div>
  );
}

/* ---- bank accounts ------------------------------------------------------------------ */

export function BankAccountFields({ form, index }: { form: Form; index: number }) {
  const { register, formState: { errors } } = form;
  const e = errors.bankAccounts?.[index];
  const id = (f: string) => `pf-bank-${index}-${f}`;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Field label="Bank name" required htmlFor={id('bank')} error={e?.bankName?.message}>
        <Input id={id('bank')} sanitize="name" maxLength={100} error={Boolean(e?.bankName)} {...register(`bankAccounts.${index}.bankName`)} />
      </Field>
      <Field label="Account holder" required htmlFor={id('holder')} error={e?.accountHolder?.message}>
        <Input id={id('holder')} sanitize="name" maxLength={150} error={Boolean(e?.accountHolder)} {...register(`bankAccounts.${index}.accountHolder`)} />
      </Field>
      <Field label="Account number" required htmlFor={id('acc')} error={e?.accountNumber?.message} hint="Stored encrypted; shown masked afterwards.">
        <Input id={id('acc')} sanitize="accountNumber" className="font-mono tabular" autoComplete="off" error={Boolean(e?.accountNumber)} {...register(`bankAccounts.${index}.accountNumber`)} />
      </Field>
      <Field label="IFSC" required htmlFor={id('ifsc')} error={e?.ifsc?.message}>
        <Input id={id('ifsc')} sanitize="ifsc" className="font-mono" error={Boolean(e?.ifsc)} {...register(`bankAccounts.${index}.ifsc`)} />
      </Field>
      <Field label="Branch" htmlFor={id('branch')} error={e?.branch?.message}>
        <Input id={id('branch')} sanitize="singleLine" maxLength={100} error={Boolean(e?.branch)} {...register(`bankAccounts.${index}.branch`)} />
      </Field>
      <Field label="Account type" required htmlFor={id('type')} error={e?.accountType?.message}>
        <Select id={id('type')} options={BANK_ACCOUNT_TYPES.map((t) => ({ value: t, label: BANK_ACCOUNT_TYPE_LABELS[t] }))} error={Boolean(e?.accountType)} {...register(`bankAccounts.${index}.accountType`)} />
      </Field>
      <div className="flex items-end pb-1 md:col-span-2">
        <Checkbox label="Primary account" description="Default account for payments" {...register(`bankAccounts.${index}.isPrimary`)} />
      </div>
    </div>
  );
}

export function BankAccountsSection({ form }: { form: Form }) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'bankAccounts' });
  const values = form.watch('bankAccounts');
  return (
    <div className="space-y-4">
      {fields.length === 0 && <EmptyState title="No bank accounts" hint="Optional. Account numbers are encrypted at rest and masked in every response." className="py-6" />}
      {fields.map((f, i) => (
        <div key={f.id} className="rounded-xl border border-slate-200 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-800 inline-flex items-center gap-2">
              Bank account {i + 1}
              {values?.[i]?.isPrimary && <Badge tone="blue"><Star className="w-3 h-3" /> Primary</Badge>}
            </p>
            <IconButton icon={Trash2} label="Remove bank account" size="sm" onClick={() => remove(i)} />
          </div>
          <BankAccountFields form={form} index={i} />
        </div>
      ))}
      <Button type="button" variant="secondary" size="sm" icon={Plus} onClick={() => append(emptyBankAccount(fields.length === 0))}>
        Add bank account
      </Button>
    </div>
  );
}
