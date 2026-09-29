import { useFormContext } from 'react-hook-form';
import { Field, Textarea } from '../../../components/ui';
import type { VendorFormValues } from './vendorForm.model';

export function VendorRemarks() {
  const { register, watch, formState: { errors } } = useFormContext<VendorFormValues>();
  const value = watch('remarks') ?? '';
  return (
    <div className="max-w-3xl">
      <Field label="Remarks (for internal use)" htmlFor="remarks" error={errors.remarks?.message}>
        <Textarea id="remarks" rows={6} maxLength={5000} placeholder="Payment preferences, quality notes, escalation contacts..." error={Boolean(errors.remarks)} {...register('remarks')} />
        <p className="text-[11px] text-slate-400 mt-1 text-right tabular">{value.length}/5000</p>
      </Field>
    </div>
  );
}
