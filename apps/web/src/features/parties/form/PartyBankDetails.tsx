import { useState } from 'react';
import { useFieldArray, useFormContext, type FieldErrors } from 'react-hook-form';
import { Landmark, Plus, Trash2 } from 'lucide-react';
import { Button, EmptyState, Field, Input, Select } from '../../../components/ui';
import { cn } from '../../../lib/utils';
import { PARTY_META, type PartyFormOptions, type PartyType } from '../types';
import { emptyBankAccount, type BankFormValues, type PartyFormValues } from './partyForm.model';

export function PartyBankDetails({ type, options }: { type: PartyType; options: PartyFormOptions }) {
  const noun = PARTY_META[type].singular.toLowerCase();
  const { control, register, watch, setValue, formState: { errors } } = useFormContext<PartyFormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: 'bankAccounts', keyName: '_key' });
  const accounts = watch('bankAccounts');
  const [changing, setChanging] = useState<Record<number, boolean>>({});
  const rootError = (errors.bankAccounts as { message?: string } | undefined)?.message;

  const setPrimary = (index: number) => accounts.forEach((_, i) => setValue(`bankAccounts.${i}.isPrimary`, i === index, { shouldDirty: true }));

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">Account numbers are encrypted at rest and shown masked. Only users who can manage {PARTY_META[type].plural.toLowerCase()} can reveal them. Leave the number unchanged to keep the stored one.</p>
      {rootError && <p className="text-sm text-red-600">{rootError}</p>}
      {fields.length === 0 ? (
        <EmptyState icon={Landmark} title="No bank accounts" hint={type === 'SUPPLIER' ? 'Add the account you pay this vendor into. It is used when recording payments.' : `Add the account this ${noun} pays from or receives refunds into. It is used when recording payments.`} action={<Button variant="secondary" size="sm" icon={Plus} onClick={() => append(emptyBankAccount(true))}>Add Bank Account</Button>} className="py-10 border border-dashed border-slate-300 rounded-lg" />
      ) : (
        <div className="space-y-3">
          {fields.map((f, i) => {
            const err = (errors.bankAccounts?.[i] ?? {}) as FieldErrors<BankFormValues>;
            const base = `bankAccounts.${i}` as const;
            const existing = Boolean(accounts[i]?.id);
            const showNumberInput = !existing || changing[i];
            return (
              <div key={f._key} className={cn('rounded-lg border p-4', accounts[i]?.isPrimary ? 'border-brand-300 bg-brand-50/30' : 'border-slate-200')}>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                    <input type="radio" name="primaryBank" className="h-4 w-4 text-brand-600" checked={Boolean(accounts[i]?.isPrimary)} onChange={() => setPrimary(i)} />
                    Primary account
                  </label>
                  <Button variant="ghost" size="xs" icon={Trash2} onClick={() => remove(i)}>
                    Remove
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label="Bank Name" required error={err.bankName?.message}>
                    <Input sanitize="singleLine" maxLength={150} error={Boolean(err.bankName)} {...register(`${base}.bankName`)} />
                  </Field>
                  <Field label="Account Holder Name" required error={err.accountHolderName?.message}>
                    <Input sanitize="singleLine" maxLength={150} error={Boolean(err.accountHolderName)} {...register(`${base}.accountHolderName`)} />
                  </Field>
                  <Field label="Account Number" required={!existing} error={err.accountNumber?.message}>
                    {showNumberInput ? (
                      <Input sanitize="accountNumber" autoComplete="off" className="font-mono tabular" placeholder={existing ? 'Enter the new account number' : ''} error={Boolean(err.accountNumber)} {...register(`${base}.accountNumber`)} />
                    ) : (
                      <div className="flex items-center gap-2 h-9">
                        <span className="font-mono tabular text-sm text-slate-700">{accounts[i]?.accountNumberMasked}</span>
                        <Button variant="ghost" size="xs" onClick={() => setChanging((c) => ({ ...c, [i]: true }))}>
                          Change
                        </Button>
                      </div>
                    )}
                  </Field>
                  <Field label="IFSC" required error={err.ifsc?.message}>
                    <Input sanitize="ifsc" className="uppercase font-mono tabular" placeholder="e.g. HDFC0001234" error={Boolean(err.ifsc)} {...register(`${base}.ifsc`)} />
                  </Field>
                  <Field label="Branch" error={err.branch?.message}>
                    <Input {...register(`${base}.branch`)} />
                  </Field>
                  <Field label="Account Type" error={err.accountType?.message}>
                    <Select options={options.bankAccountTypes} {...register(`${base}.accountType`)} />
                  </Field>
                </div>
              </div>
            );
          })}
          <Button variant="secondary" size="sm" icon={Plus} onClick={() => append(emptyBankAccount(false))}>
            Add Bank Account
          </Button>
        </div>
      )}
    </div>
  );
}
