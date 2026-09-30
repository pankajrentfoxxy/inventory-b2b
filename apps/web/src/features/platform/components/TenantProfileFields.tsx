import type { UseFormReturn } from 'react-hook-form';
import { Field, FormSection, Input } from '../../../components/ui';
import type { CreateTenantPayload, Tenant, UpdateTenantPayload } from '../types';

export interface TenantFormValues {
  code: string;
  legalName: string;
  displayName: string;
  pan: string;
  gstin: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  registeredAddress: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    stateCode: string;
    pincode: string;
    country: string;
  };
}

export const EMPTY_TENANT_FORM: TenantFormValues = {
  code: '',
  legalName: '',
  displayName: '',
  pan: '',
  gstin: '',
  ownerName: '',
  ownerEmail: '',
  ownerPhone: '',
  registeredAddress: { line1: '', line2: '', city: '', state: '', stateCode: '', pincode: '', country: 'IN' },
};

export function tenantToFormValues(t: Tenant): TenantFormValues {
  const a = t.registeredAddress;
  return {
    code: t.code,
    legalName: t.legalName,
    displayName: t.displayName,
    pan: t.pan ?? '',
    gstin: t.gstin ?? '',
    ownerName: t.ownerName,
    ownerEmail: t.ownerEmail,
    ownerPhone: t.ownerPhone ?? '',
    registeredAddress: { line1: a?.line1 ?? '', line2: a?.line2 ?? '', city: a?.city ?? '', state: a?.state ?? '', stateCode: a?.stateCode ?? '', pincode: a?.pincode ?? '', country: a?.country ?? 'IN' },
  };
}

const opt = (v: string) => (v.trim() ? v.trim() : undefined);

/** Trims and drops empty optionals; the API's zod schema is the validator. */
export function formValuesToPayload(v: TenantFormValues): CreateTenantPayload {
  return {
    ...(opt(v.code) ? { code: v.code.trim() } : {}),
    legalName: v.legalName.trim(),
    displayName: v.displayName.trim(),
    ...(opt(v.pan) ? { pan: v.pan.trim() } : {}),
    ...(opt(v.gstin) ? { gstin: v.gstin.trim() } : {}),
    registeredAddress: {
      line1: v.registeredAddress.line1.trim(),
      ...(opt(v.registeredAddress.line2) ? { line2: v.registeredAddress.line2.trim() } : {}),
      city: v.registeredAddress.city.trim(),
      state: v.registeredAddress.state.trim(),
      stateCode: v.registeredAddress.stateCode.trim(),
      pincode: v.registeredAddress.pincode.trim(),
      country: v.registeredAddress.country.trim() || 'IN',
    },
    ownerName: v.ownerName.trim(),
    ownerEmail: v.ownerEmail.trim(),
    ...(opt(v.ownerPhone) ? { ownerPhone: v.ownerPhone.trim() } : {}),
  };
}

export function formValuesToPatch(v: TenantFormValues): UpdateTenantPayload {
  const { code: _code, ...rest } = formValuesToPayload(v);
  void _code;
  return rest;
}

/** Profile + owner + address fields shared by the create page and the edit modal. */
export function TenantProfileFields({ form, showCode, autoFocus }: { form: UseFormReturn<TenantFormValues>; showCode?: boolean; autoFocus?: boolean }) {
  const { register, formState: { errors } } = form;
  const addr = errors.registeredAddress;
  return (
    <div className="space-y-6">
      <FormSection title="Organisation" description="Legal identity as registered. GSTIN, when given, decides the state code.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Legal name" required htmlFor="t-legal" error={errors.legalName?.message}>
            <Input id="t-legal" autoFocus={autoFocus} sanitize="singleLine" maxLength={200} error={Boolean(errors.legalName)} {...register('legalName')} />
          </Field>
          <Field label="Display name" required htmlFor="t-display" error={errors.displayName?.message}>
            <Input id="t-display" sanitize="singleLine" maxLength={150} error={Boolean(errors.displayName)} {...register('displayName')} />
          </Field>
          {showCode && (
            <Field label="Code" htmlFor="t-code" hint="Optional. Generated from the display name when left blank. Used to confirm deactivation." error={errors.code?.message}>
              <Input id="t-code" sanitize="code" maxLength={40} className="font-mono uppercase" error={Boolean(errors.code)} {...register('code')} />
            </Field>
          )}
          <Field label="GSTIN" htmlFor="t-gstin" error={errors.gstin?.message}>
            <Input id="t-gstin" sanitize="gstin" maxLength={15} className="font-mono uppercase" error={Boolean(errors.gstin)} {...register('gstin')} />
          </Field>
          <Field label="PAN" htmlFor="t-pan" hint="PAN or GSTIN is required before approval." error={errors.pan?.message}>
            <Input id="t-pan" sanitize="pan" maxLength={10} className="font-mono uppercase" error={Boolean(errors.pan)} {...register('pan')} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Owner" description="The owner receives the activation invite and becomes the first member.">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Owner name" required htmlFor="t-owner" error={errors.ownerName?.message}>
            <Input id="t-owner" sanitize="singleLine" maxLength={150} error={Boolean(errors.ownerName)} {...register('ownerName')} />
          </Field>
          <Field label="Owner email" required htmlFor="t-owner-email" error={errors.ownerEmail?.message}>
            <Input id="t-owner-email" type="email" sanitize="email" maxLength={254} error={Boolean(errors.ownerEmail)} {...register('ownerEmail')} />
          </Field>
          <Field label="Owner phone" htmlFor="t-owner-phone" error={errors.ownerPhone?.message}>
            <Input id="t-owner-phone" sanitize="phone" maxLength={15} error={Boolean(errors.ownerPhone)} {...register('ownerPhone')} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Registered address">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Address line 1" required htmlFor="t-line1" error={addr?.line1?.message}>
            <Input id="t-line1" sanitize="singleLine" maxLength={200} error={Boolean(addr?.line1)} {...register('registeredAddress.line1')} />
          </Field>
          <Field label="Address line 2" htmlFor="t-line2" error={addr?.line2?.message}>
            <Input id="t-line2" sanitize="singleLine" maxLength={200} error={Boolean(addr?.line2)} {...register('registeredAddress.line2')} />
          </Field>
          <Field label="City" required htmlFor="t-city" error={addr?.city?.message}>
            <Input id="t-city" sanitize="singleLine" maxLength={100} error={Boolean(addr?.city)} {...register('registeredAddress.city')} />
          </Field>
          <Field label="State" required htmlFor="t-state" error={addr?.state?.message}>
            <Input id="t-state" sanitize="singleLine" maxLength={100} error={Boolean(addr?.state)} {...register('registeredAddress.state')} />
          </Field>
          <div className="grid grid-cols-3 gap-4 md:col-span-2">
            <Field label="State code" required htmlFor="t-state-code" hint="Two-digit GST state code" error={addr?.stateCode?.message}>
              <Input id="t-state-code" sanitize="digits" maxLength={2} className="tabular" error={Boolean(addr?.stateCode)} {...register('registeredAddress.stateCode')} />
            </Field>
            <Field label="Pincode" required htmlFor="t-pincode" error={addr?.pincode?.message}>
              <Input id="t-pincode" sanitize="pincode" maxLength={6} className="tabular" error={Boolean(addr?.pincode)} {...register('registeredAddress.pincode')} />
            </Field>
            <Field label="Country" required htmlFor="t-country" error={addr?.country?.message}>
              <Input id="t-country" sanitize="upper" maxLength={2} className="uppercase" error={Boolean(addr?.country)} {...register('registeredAddress.country')} />
            </Field>
          </div>
        </div>
      </FormSection>
    </div>
  );
}
