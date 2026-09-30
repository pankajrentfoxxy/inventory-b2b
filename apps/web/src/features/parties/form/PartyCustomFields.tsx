import { Controller, useFormContext } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { Settings2 } from 'lucide-react';
import { Checkbox, EmptyState, Field, Input, Select } from '../../../components/ui';
import { useAuth } from '../../../lib/auth';
import { PARTY_META, type PartyFormOptions, type PartyType } from '../types';
import type { PartyFormValues } from './partyForm.model';

export function PartyCustomFields({ type, options }: { type: PartyType; options: PartyFormOptions }) {
  const noun = PARTY_META[type].singular.toLowerCase();
  const { control, formState: { errors } } = useFormContext<PartyFormValues>();
  const { hasPermission } = useAuth();

  if (options.customFields.length === 0) {
    return (
      <EmptyState
        icon={Settings2}
        title="No custom fields configured"
        hint={`Custom fields let your organization capture extra ${noun} information (text, numbers, dates, dropdowns, yes/no) without code changes.`}
        action={hasPermission('master.manage') ? <Link to="/masters/other" className="text-sm font-medium text-brand-700 hover:underline">Configure custom fields</Link> : undefined}
        className="py-10 border border-dashed border-slate-300 rounded-lg"
      />
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {options.customFields.map((def, i) => {
        const error = errors.customFields?.[i]?.value?.message;
        return (
          <Controller
            key={def.id}
            control={control}
            name={`customFields.${i}.value`}
            render={({ field }) => (
              <Field label={def.label} required={def.isRequired} inline error={error}>
                {def.fieldType === 'TEXT' && <Input value={(field.value as string | null) ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)} onBlur={field.onBlur} error={Boolean(error)} />}
                {def.fieldType === 'NUMBER' && <Input type="number" step="any" inputMode="decimal" className="sm:max-w-xs tabular" value={field.value === null || field.value === undefined ? '' : String(field.value)} onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))} onBlur={field.onBlur} error={Boolean(error)} />}
                {def.fieldType === 'DATE' && <Input type="date" className="sm:max-w-xs" value={(field.value as string | null) ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)} onBlur={field.onBlur} error={Boolean(error)} />}
                {def.fieldType === 'DROPDOWN' && <Select placeholder="Select" className="sm:max-w-xs" value={(field.value as string | null) ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)} onBlur={field.onBlur} options={def.options.map((o) => ({ value: o, label: o }))} error={Boolean(error)} />}
                {def.fieldType === 'BOOLEAN' && <Checkbox label="Yes" checked={Boolean(field.value)} onChange={(e) => field.onChange(e.target.checked)} onBlur={field.onBlur} />}
              </Field>
            )}
          />
        );
      })}
    </div>
  );
}
