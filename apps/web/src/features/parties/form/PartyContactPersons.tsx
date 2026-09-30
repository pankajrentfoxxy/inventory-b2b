import { useFieldArray, useFormContext, type FieldErrors } from 'react-hook-form';
import { Plus, Trash2, Users } from 'lucide-react';
import { Button, EmptyState, Field, Input, Select } from '../../../components/ui';
import { cn } from '../../../lib/utils';
import { PARTY_META, type PartyFormOptions, type PartyType } from '../types';
import { emptyContact, type ContactFormValues, type PartyFormValues } from './partyForm.model';

export function PartyContactPersons({ type, options }: { type: PartyType; options: PartyFormOptions }) {
  const noun = PARTY_META[type].singular.toLowerCase();
  const { control, register, watch, setValue, formState: { errors } } = useFormContext<PartyFormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: 'contacts', keyName: '_key' });
  const contacts = watch('contacts');
  const rootError = (errors.contacts as { message?: string } | undefined)?.message;

  const setPrimary = (index: number) => {
    contacts.forEach((_, i) => setValue(`contacts.${i}.isPrimary`, i === index, { shouldDirty: true }));
  };

  const removeAt = (index: number) => {
    const wasPrimary = contacts[index]?.isPrimary;
    remove(index);
    if (wasPrimary && contacts.length > 1) {
      setTimeout(() => setValue('contacts.0.isPrimary', true, { shouldDirty: true }), 0);
    }
  };

  return (
    <div className="space-y-4">
      {rootError && <p className="text-sm text-red-600">{rootError}</p>}
      {fields.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No contact persons"
          hint={type === 'SUPPLIER' ? 'Add the people you deal with at this vendor: sales, accounts, logistics.' : `Add the people you deal with at this ${noun}: purchasing, accounts, receiving.`}
          action={<Button variant="secondary" size="sm" icon={Plus} onClick={() => append(emptyContact(true))}>Add Contact Person</Button>}
          className="py-10 border border-dashed border-slate-300 rounded-lg"
        />
      ) : (
        <div className="space-y-3">
          {fields.map((f, i) => {
            const err = (errors.contacts?.[i] ?? {}) as FieldErrors<ContactFormValues>;
            const base = `contacts.${i}` as const;
            const isPrimary = contacts[i]?.isPrimary;
            return (
              <div key={f._key} className={cn('rounded-lg border p-4', isPrimary ? 'border-brand-300 bg-brand-50/30' : 'border-slate-200')}>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                    <input type="radio" name="primaryContact" className="h-4 w-4 text-brand-600" checked={Boolean(isPrimary)} onChange={() => setPrimary(i)} />
                    Primary contact
                  </label>
                  <Button variant="ghost" size="xs" icon={Trash2} onClick={() => removeAt(i)}>
                    Remove
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                  <Field label="Name" required error={err.firstName?.message ?? err.lastName?.message} className="md:col-span-2">
                    <div className="grid grid-cols-[100px_1fr_1fr] gap-2">
                      <Select aria-label="Salutation" placeholder="Title" options={options.salutations.map((s) => ({ value: s, label: s }))} {...register(`${base}.salutation`)} />
                      <Input placeholder="First name" aria-label="First name" sanitize="name" maxLength={100} error={Boolean(err.firstName)} {...register(`${base}.firstName`)} />
                      <Input placeholder="Last name" aria-label="Last name" sanitize="name" maxLength={100} error={Boolean(err.lastName)} {...register(`${base}.lastName`)} />
                    </div>
                  </Field>
                  <Field label="Email" error={err.email?.message}>
                    <Input type="email" sanitize="email" maxLength={254} error={Boolean(err.email)} {...register(`${base}.email`)} />
                  </Field>
                  <Field label="Work Phone" error={err.workPhone?.message}>
                    <Input sanitize="phone" maxLength={20} error={Boolean(err.workPhone)} {...register(`${base}.workPhone`)} />
                  </Field>
                  <Field label="Mobile" error={err.mobile?.message}>
                    <Input sanitize="mobile" placeholder="10-digit mobile" error={Boolean(err.mobile)} {...register(`${base}.mobile`)} />
                  </Field>
                  <Field label="Designation" error={err.designation?.message}>
                    <Input {...register(`${base}.designation`)} />
                  </Field>
                  <Field label="Department" error={err.department?.message}>
                    <Input {...register(`${base}.department`)} />
                  </Field>
                </div>
              </div>
            );
          })}
          <Button variant="secondary" size="sm" icon={Plus} onClick={() => append(emptyContact(false))}>
            Add Contact Person
          </Button>
        </div>
      )}
    </div>
  );
}
