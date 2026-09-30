import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Button, Card, CardBody, CardHeader, DescriptionList, Field, Input, Select } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { applyServerErrors, summarizeErrors } from '../../../lib/validation';
import { useUpdateTenantSettings } from '../hooks';
import type { TenantSettings } from '../types';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface SettingsFormValues {
  timezone: string;
  fyStartMonth: string;
  baseCurrency: string;
}

const toValues = (s: TenantSettings | null): SettingsFormValues => ({ timezone: s?.timezone ?? 'Asia/Kolkata', fyStartMonth: String(s?.fyStartMonth ?? 4), baseCurrency: s?.baseCurrency ?? 'INR' });

/** PUT /v1/platform/vendors/:id/settings (timezone, financial year start, base currency). Read-only without platform.tenant.edit. */
export function TenantSettingsCard({ tenantId, settings, canEdit }: { tenantId: string; settings: TenantSettings | null; canEdit: boolean }) {
  const update = useUpdateTenantSettings();
  const { register, handleSubmit, reset, setError, formState: { errors, isDirty } } = useForm<SettingsFormValues>({ defaultValues: toValues(settings) });

  useEffect(() => {
    reset(toValues(settings));
  }, [settings, reset]);

  const submit = handleSubmit(async (v) => {
    try {
      await update.mutateAsync({ id: tenantId, payload: { timezone: v.timezone.trim(), fyStartMonth: Number(v.fyStartMonth), baseCurrency: v.baseCurrency.trim().toUpperCase() } });
      toast.success('Settings saved');
    } catch (err) {
      const e = toApiError(err);
      toast.error(summarizeErrors(applyServerErrors(setError, e), e.message));
    }
  });

  if (!canEdit) {
    return (
      <Card>
        <CardHeader title="Settings" description="Regional defaults applied to every document of this tenant." />
        <CardBody>
          <DescriptionList
            columns={3}
            items={[
              { label: 'Timezone', value: settings?.timezone },
              { label: 'Financial year starts', value: settings ? MONTHS[settings.fyStartMonth - 1] : null },
              { label: 'Base currency', value: settings?.baseCurrency, mono: true },
            ]}
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Settings"
        description="Regional defaults applied to every document of this tenant."
        actions={
          <Button size="sm" onClick={() => void submit()} loading={update.isPending} disabled={!isDirty}>
            Save settings
          </Button>
        }
      />
      <CardBody>
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Timezone" required htmlFor="s-tz" hint="IANA name, e.g. Asia/Kolkata" error={errors.timezone?.message}>
            <Input id="s-tz" sanitize="singleLine" maxLength={60} error={Boolean(errors.timezone)} {...register('timezone')} />
          </Field>
          <Field label="Financial year starts" required htmlFor="s-fy" error={errors.fyStartMonth?.message}>
            <Select id="s-fy" options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} error={Boolean(errors.fyStartMonth)} {...register('fyStartMonth')} />
          </Field>
          <Field label="Base currency" required htmlFor="s-ccy" hint="ISO 4217 code" error={errors.baseCurrency?.message}>
            <Input id="s-ccy" sanitize="upper" maxLength={3} className="font-mono uppercase" error={Boolean(errors.baseCurrency)} {...register('baseCurrency')} />
          </Field>
        </form>
      </CardBody>
    </Card>
  );
}
