import { useFormContext } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { Tags } from 'lucide-react';
import { EmptyState, Field, Select } from '../../../components/ui';
import { usePermission } from '../../../lib/auth';
import type { VendorFormOptions } from '../types';
import type { VendorFormValues } from './vendorForm.model';

export function VendorReportingTags({ options }: { options: VendorFormOptions }) {
  const { register, formState: { errors } } = useFormContext<VendorFormValues>();
  const { canManageSettings } = usePermission();

  if (options.reportingTags.length === 0) {
    return (
      <EmptyState
        icon={Tags}
        title="No reporting tags configured"
        hint="Reporting tags (Region, Department, Business Unit, Vendor Category) let you slice purchase reports by dimensions specific to your organization."
        action={canManageSettings ? <Link to="/settings/vendor-fields" className="text-sm font-medium text-brand-700 hover:underline">Configure reporting tags</Link> : undefined}
        className="py-10 border border-dashed border-slate-300 rounded-lg"
      />
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <p className="text-xs text-slate-500">Tags are optional. Choose the value that best describes this vendor for each dimension.</p>
      {options.reportingTags.map((tag, i) => (
        <Field key={tag.id} label={tag.name} inline error={errors.reportingTags?.[i]?.optionId?.message}>
          <Select placeholder="Not tagged" className="sm:max-w-xs" options={tag.options.map((o) => ({ value: o.id, label: o.name }))} {...register(`reportingTags.${i}.optionId`)} />
        </Field>
      ))}
    </div>
  );
}
