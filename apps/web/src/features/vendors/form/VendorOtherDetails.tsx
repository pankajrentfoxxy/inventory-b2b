import { useFormContext } from 'react-hook-form';
import { Checkbox, Field, FormSection, Input, Select } from '../../../components/ui';
import type { VendorFormOptions } from '../types';
import type { VendorFormValues } from './vendorForm.model';

export function VendorOtherDetails({ options }: { options: VendorFormOptions }) {
  const { register, watch, formState: { errors } } = useFormContext<VendorFormValues>();
  const gstTreatmentId = watch('gstTreatmentId');
  const treatment = options.gstTreatments.find((g) => g.id === gstTreatmentId);
  const msme = watch('msmeRegistered');
  const tds = watch('tdsApplicable');
  const currency = options.currencies.find((c) => c.code === watch('currencyCode'));

  return (
    <div className="space-y-5 max-w-3xl">
      <FormSection>
        <Field label="GST Treatment" required inline htmlFor="gstTreatmentId" error={errors.gstTreatmentId?.message}>
          <Select id="gstTreatmentId" placeholder="Select a GST treatment" error={Boolean(errors.gstTreatmentId)} options={options.gstTreatments.map((g) => ({ value: g.id, label: g.name }))} {...register('gstTreatmentId')} />
          {treatment?.description && <p className="text-xs text-slate-500 mt-1">{treatment.description}</p>}
        </Field>

        <Field label="Source of Supply" required inline htmlFor="sourceOfSupplyId" error={errors.sourceOfSupplyId?.message} hint="The state the vendor supplies from; determines CGST/SGST vs IGST.">
          <Select id="sourceOfSupplyId" placeholder="Select a state" error={Boolean(errors.sourceOfSupplyId)} options={options.sourcesOfSupply.map((s) => ({ value: s.id, label: `[${s.shortCode ?? s.code}] ${s.name}` }))} {...register('sourceOfSupplyId')} />
        </Field>

        <Field label="GSTIN" required={treatment?.requiresGstin} inline htmlFor="gstin" error={errors.gstin?.message} hint="15-character GST identification number">
          <Input id="gstin" sanitize="gstin" placeholder="e.g. 27AAPFU0939F1ZV" className="uppercase font-mono tabular" error={Boolean(errors.gstin)} {...register('gstin')} />
        </Field>

        <Field label="PAN" inline htmlFor="pan" error={errors.pan?.message}>
          <Input id="pan" sanitize="pan" placeholder="e.g. AAPFU0939F" className="uppercase font-mono tabular sm:max-w-xs" error={Boolean(errors.pan)} {...register('pan')} />
        </Field>

        <Field label="MSME Registered" inline error={errors.msmeNumber?.message}>
          <div className="space-y-2">
            <Checkbox label="This vendor is a registered MSME (Udyam)" {...register('msmeRegistered')} />
            {msme && <Input placeholder="Udyam registration number, e.g. UDYAM-MH-12-1234567" sanitize="upper" maxLength={30} className="uppercase sm:max-w-sm" error={Boolean(errors.msmeNumber)} {...register('msmeNumber')} />}
          </div>
        </Field>

        <Field label="Payment Terms" inline htmlFor="paymentTermId" error={errors.paymentTermId?.message}>
          <Select id="paymentTermId" placeholder="Not set" options={options.paymentTerms.map((p) => ({ value: p.id, label: p.days > 0 ? `${p.name} (${p.days} days)` : p.name }))} className="sm:max-w-xs" {...register('paymentTermId')} />
        </Field>

        <Field label="Currency" inline htmlFor="currencyCode" error={errors.currencyCode?.message}>
          <Select id="currencyCode" options={options.currencies.map((c) => ({ value: c.code, label: `${c.code} - ${c.name}` }))} className="sm:max-w-xs" {...register('currencyCode')} />
        </Field>

        <Field label="Opening Balance" inline htmlFor="openingBalance" error={errors.openingBalance?.message} hint="Amount payable to this vendor as of the migration date">
          <div className="sm:max-w-xs">
            <Input id="openingBalance" sanitize="signedDecimal" prefix={currency?.symbol ?? currency?.code ?? ''} className="tabular" error={Boolean(errors.openingBalance)} {...register('openingBalance')} />
          </div>
        </Field>

        <Field label="Vendor Type" inline htmlFor="vendorType" error={errors.vendorType?.message}>
          <Select id="vendorType" placeholder="Not specified" options={options.vendorTypes} className="sm:max-w-xs" {...register('vendorType')} />
        </Field>

        <Field label="Website" inline htmlFor="website" error={errors.website?.message}>
          <Input id="website" placeholder="https://vendor.example.com" sanitize="url" maxLength={255} error={Boolean(errors.website)} {...register('website')} />
        </Field>
      </FormSection>

      <FormSection title="Tax Deduction / Collection" description="Configuration for TDS and TCS on purchases. Section-level rates are configured when Bills go live.">
        <Field label="TDS" inline error={errors.tdsSectionCode?.message}>
          <div className="space-y-2">
            <Checkbox label="TDS applicable on payments to this vendor" {...register('tdsApplicable')} />
            {tds && <Input placeholder="TDS section, e.g. 194C, 194J" sanitize="upper" maxLength={20} className="uppercase sm:max-w-xs" error={Boolean(errors.tdsSectionCode)} {...register('tdsSectionCode')} />}
          </div>
        </Field>
        <Field label="TCS" inline>
          <Checkbox label="Vendor collects TCS on sales to us" {...register('tcsApplicable')} />
        </Field>
      </FormSection>
    </div>
  );
}
