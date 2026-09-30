import { Controller, useFormContext } from 'react-hook-form';
import { Combobox, Field, FormSection, Input, Select } from '../../../components/ui';
import { PARTY_META, type PartyFormOptions, type PartyType } from '../types';
import type { PartyFormValues } from './partyForm.model';

/** Suggested display names in Zoho's order: "Mr. First Last", "First Last", "Last, First", company. */
export function displayNameSuggestions(v: { salutation?: string; firstName?: string; lastName?: string; companyName?: string }) {
  const first = (v.firstName ?? '').trim();
  const last = (v.lastName ?? '').trim();
  const sal = (v.salutation ?? '').trim();
  const company = (v.companyName ?? '').trim();
  const full = [first, last].filter(Boolean).join(' ');
  const candidates = [
    sal && full ? `${sal} ${full}` : '',
    full,
    first && last ? `${last}, ${first}` : '',
    company,
  ];
  return Array.from(new Set(candidates.filter(Boolean)));
}

/** Primary contact + basic information (the always-visible top of the form). */
export function PartyBasicInfo({ type, options }: { type: PartyType; options: PartyFormOptions }) {
  const meta = PARTY_META[type];
  const noun = meta.singular.toLowerCase();
  const { register, control, formState: { errors }, watch } = useFormContext<PartyFormValues>();
  const dialCodes = Array.from(new Set(options.countries.map((c) => c.dialCode))).map((d) => ({ value: d, label: d }));
  const [salutation, firstName, lastName, companyName, mobileDial] = watch(['salutation', 'firstName', 'lastName', 'companyName', 'mobileCountryCode']);
  const suggestions = displayNameSuggestions({ salutation, firstName, lastName, companyName });

  return (
    <div className="space-y-5 max-w-3xl">
      <FormSection>
        <Field label="Primary Contact" inline>
          <div className="grid grid-cols-[110px_1fr_1fr] gap-2">
            <Select aria-label="Salutation" placeholder="Salutation" options={options.salutations.map((s) => ({ value: s, label: s }))} {...register('salutation')} />
            <Input placeholder="First Name" aria-label="First name" sanitize="name" maxLength={100} error={Boolean(errors.firstName)} {...register('firstName')} />
            <Input placeholder="Last Name" aria-label="Last name" sanitize="name" maxLength={100} error={Boolean(errors.lastName)} {...register('lastName')} />
          </div>
          {(errors.firstName || errors.lastName) && <p className="text-xs text-red-600 mt-1">{errors.firstName?.message ?? errors.lastName?.message}</p>}
        </Field>

        <Field label="Company Name" inline htmlFor="companyName" error={errors.companyName?.message}>
          <Input id="companyName" sanitize="singleLine" maxLength={200} error={Boolean(errors.companyName)} {...register('companyName')} />
        </Field>

        <Field label="Display Name" required inline htmlFor="displayName" error={errors.displayName?.message} hint={`How this ${noun} appears in lists and transactions. Must be unique within your organization.`}>
          <Controller
            control={control}
            name="displayName"
            render={({ field }) => (
              <Combobox id="displayName" value={field.value} onChange={field.onChange} onBlur={field.onBlur} options={suggestions} placeholder="Select or type to add" error={Boolean(errors.displayName)} />
            )}
          />
        </Field>

        <Field label="Email Address" inline htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" sanitize="email" maxLength={254} autoComplete="off" error={Boolean(errors.email)} {...register('email')} />
        </Field>

        <Field label="Phone" inline error={errors.workPhone?.message ?? errors.mobile?.message ?? errors.workPhoneCountryCode?.message ?? errors.mobileCountryCode?.message}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="grid grid-cols-[84px_1fr] gap-1.5">
              <Select aria-label="Work phone country code" options={dialCodes} {...register('workPhoneCountryCode')} />
              <Input placeholder="Work Phone" aria-label="Work phone" sanitize="phone" maxLength={20} error={Boolean(errors.workPhone)} {...register('workPhone')} />
            </div>
            <div className="grid grid-cols-[84px_1fr] gap-1.5">
              <Select aria-label="Mobile country code" options={dialCodes} {...register('mobileCountryCode')} />
              <Input placeholder={mobileDial === '+91' ? '10-digit mobile' : 'Mobile'} aria-label="Mobile" sanitize={mobileDial === '+91' ? 'mobile' : 'phone'} maxLength={mobileDial === '+91' ? 10 : 20} error={Boolean(errors.mobile)} {...register('mobile')} />
            </div>
          </div>
        </Field>

        <Field label={`${meta.singular} Language`} inline htmlFor="language" error={errors.language?.message}>
          <Select id="language" options={options.languages.map((l) => ({ value: l.code, label: l.label }))} className="sm:max-w-xs" {...register('language')} />
        </Field>
      </FormSection>
    </div>
  );
}
