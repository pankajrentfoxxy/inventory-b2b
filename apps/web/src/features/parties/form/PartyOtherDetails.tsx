import { useFormContext } from 'react-hook-form';
import { Checkbox, Field, FormSection, Input, Select } from '../../../components/ui';
import { PARTY_META, type PartyFormOptions, type PartyType } from '../types';
import type { PartyFormValues } from './partyForm.model';

/**
 * GST, commercial terms and tax deduction. Vendor type, MSME and TDS apply to vendors only (the
 * service ignores them for customers); TCS applies to both.
 */
export function PartyOtherDetails({ type, options }: { type: PartyType; options: PartyFormOptions }) {
  const meta = PARTY_META[type];
  const noun = meta.singular.toLowerCase();
  const isVendor = type === 'SUPPLIER';
  const { register, watch, formState: { errors } } = useFormContext<PartyFormValues>();
  const gstTreatment = watch('gstTreatment');
  const treatment = options.gstTreatments.find((g) => g.value === gstTreatment);
  const msme = watch('msmeRegistered');
  const tds = watch('tdsApplicable');
  const currency = options.currencies.find((c) => c.code === watch('currencyCode'));

  return (
    <div className="space-y-5 max-w-3xl">
      <FormSection>
        <Field label="GST Treatment" required inline htmlFor="gstTreatment" error={errors.gstTreatment?.message}>
          <Select id="gstTreatment" placeholder="Select a GST treatment" error={Boolean(errors.gstTreatment)} options={options.gstTreatments.map((g) => ({ value: g.value, label: g.label }))} {...register('gstTreatment')} />
        </Field>

        <Field
          label={isVendor ? 'Source of Supply' : 'Place of Supply'}
          required
          inline
          htmlFor="sourceOfSupply"
          error={errors.sourceOfSupply?.message}
          hint={isVendor ? 'The state the vendor supplies from; determines CGST/SGST vs IGST.' : 'The state the customer is supplied in; determines CGST/SGST vs IGST.'}
        >
          <Select id="sourceOfSupply" placeholder="Select a state" error={Boolean(errors.sourceOfSupply)} options={options.sourcesOfSupply.map((s) => ({ value: s.code, label: `[${s.code}] ${s.name}` }))} {...register('sourceOfSupply')} />
        </Field>

        <Field label="GSTIN" required={treatment?.requiresGstin} inline htmlFor="gstin" error={errors.gstin?.message} hint="15-character GST identification number">
          <Input id="gstin" sanitize="gstin" placeholder="e.g. 27AAPFU0939F1ZV" className="uppercase font-mono tabular" error={Boolean(errors.gstin)} {...register('gstin')} />
        </Field>

        <Field label="PAN" inline htmlFor="pan" error={errors.pan?.message}>
          <Input id="pan" sanitize="pan" placeholder="e.g. AAPFU0939F" className="uppercase font-mono tabular sm:max-w-xs" error={Boolean(errors.pan)} {...register('pan')} />
        </Field>

        {isVendor && (
          <Field label="MSME Registered" inline error={errors.msmeNumber?.message}>
            <div className="space-y-2">
              <Checkbox label="This vendor is a registered MSME (Udyam)" {...register('msmeRegistered')} />
              {msme && <Input placeholder="Udyam registration number, e.g. UDYAM-MH-12-1234567" sanitize="upper" maxLength={30} className="uppercase sm:max-w-sm" error={Boolean(errors.msmeNumber)} {...register('msmeNumber')} />}
            </div>
          </Field>
        )}

        <Field label="Payment Terms" inline htmlFor="paymentTermId" error={errors.paymentTermId?.message}>
          <Select id="paymentTermId" placeholder="Not set" options={options.paymentTerms.map((p) => ({ value: p.id, label: p.days > 0 ? `${p.name} (${p.days} days)` : p.name }))} className="sm:max-w-xs" {...register('paymentTermId')} />
        </Field>

        <Field label="Currency" inline htmlFor="currencyCode" error={errors.currencyCode?.message}>
          <Select id="currencyCode" options={options.currencies.map((c) => ({ value: c.code, label: `${c.code} - ${c.name}` }))} className="sm:max-w-xs" {...register('currencyCode')} />
        </Field>

        <Field label="Opening Balance" inline htmlFor="openingBalance" error={errors.openingBalance?.message} hint={isVendor ? 'Amount payable to this vendor as of the migration date' : 'Amount receivable from this customer as of the migration date'}>
          <div className="sm:max-w-xs">
            <Input id="openingBalance" sanitize="signedDecimal" prefix={currency?.symbol ?? currency?.code ?? ''} className="tabular" error={Boolean(errors.openingBalance)} {...register('openingBalance')} />
          </div>
        </Field>

        {isVendor && (
          <Field label="Vendor Type" inline htmlFor="vendorType" error={errors.vendorType?.message}>
            <Select id="vendorType" placeholder="Not specified" options={options.vendorTypes} className="sm:max-w-xs" {...register('vendorType')} />
          </Field>
        )}

        <Field label="Website" inline htmlFor="website" error={errors.website?.message}>
          <Input id="website" placeholder={`https://${noun}.example.com`} sanitize="url" maxLength={255} error={Boolean(errors.website)} {...register('website')} />
        </Field>
      </FormSection>

      {isVendor ? (
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
      ) : (
        <FormSection title="Tax Collection" description="Configuration for TCS on sales. Rates are configured when Invoices go live.">
          <Field label="TCS" inline>
            <Checkbox label="TCS is collected on sales to this customer" {...register('tcsApplicable')} />
          </Field>
        </FormSection>
      )}
    </div>
  );
}
