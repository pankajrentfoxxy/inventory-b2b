import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { INDIAN_STATES } from '@b2b/shared';
import { Button, Checkbox, Field, FormSection, Input, Modal, Select } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { applyServerErrors, summarizeErrors } from '../../../lib/validation';
import { useCreateWarehouse, usePatchWarehouse } from '../hooks';
import type { Warehouse, WarehousePayload } from '../types';

interface WarehouseFormValues {
  code: string;
  name: string;
  line1: string;
  line2: string;
  city: string;
  stateCode: string;
  pincode: string;
  country: string;
  gstin: string;
  isDefault: boolean;
}

export const STATE_OPTIONS = INDIAN_STATES.map((s) => ({ value: s.code, label: `${s.code} - ${s.name}` }));
export const stateName = (code: string) => INDIAN_STATES.find((s) => s.code === code)?.name ?? null;

function toValues(w?: Warehouse | null): WarehouseFormValues {
  const a = w?.address ?? {};
  return {
    code: w?.code ?? '',
    name: w?.name ?? '',
    line1: a.line1 ?? '',
    line2: a.line2 ?? '',
    city: a.city ?? '',
    stateCode: a.stateCode ?? w?.stateCode ?? '',
    pincode: a.pincode ?? '',
    country: a.country ?? 'IN',
    gstin: w?.gstin ?? '',
    isDefault: w?.isDefault ?? false,
  };
}

/** API paths are nested under address.*; the form keeps them flat. */
const mapPath = (path: string) => path.replace(/^address\./, '');

export function WarehouseFormModal({ open, onClose, warehouse }: { open: boolean; onClose: () => void; warehouse?: Warehouse | null }) {
  const create = useCreateWarehouse();
  const patch = usePatchWarehouse();
  const defaults = useMemo(() => toValues(warehouse), [warehouse]);
  const { register, handleSubmit, reset, setError, formState: { errors } } = useForm<WarehouseFormValues>({ defaultValues: defaults });

  useEffect(() => {
    if (open) reset(defaults);
  }, [open, defaults, reset]);

  const submit = handleSubmit(async (v) => {
    const payload: WarehousePayload = {
      code: v.code.trim(),
      name: v.name.trim(),
      address: { line1: v.line1.trim(), line2: v.line2.trim() || null, city: v.city.trim(), state: stateName(v.stateCode), stateCode: v.stateCode, pincode: v.pincode.trim(), country: v.country.trim() || 'IN' },
      stateCode: v.stateCode,
      gstin: v.gstin.trim() || null,
      isDefault: v.isDefault,
    };
    try {
      if (warehouse) {
        const { code: _code, ...rest } = payload;
        // isDefault: false on the current default would leave the tenant without one; only send true.
        const saved = await patch.mutateAsync({ id: warehouse.id, patch: { ...rest, isDefault: rest.isDefault || undefined }, version: warehouse.version });
        toast.success(`${saved.name} updated`);
      } else {
        const saved = await create.mutateAsync(payload);
        toast.success(`${saved.name} created with a default STORE location`);
      }
      onClose();
    } catch (err) {
      const e = toApiError(err);
      if (e.code === 'VERSION_CONFLICT') {
        toast.error('This warehouse was changed by someone else. Reopen the dialog to see the latest version.');
        return;
      }
      toast.error(summarizeErrors(applyServerErrors(setError, e, { mapPath }), e.message));
    }
  });
  const saving = create.isPending || patch.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={warehouse ? `Edit ${warehouse.name}` : 'New Warehouse'}
      description={warehouse ? `Code ${warehouse.code} - version ${warehouse.version}` : 'A STORE location is created automatically; add more locations and bins afterwards.'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={saving}>
            {warehouse ? 'Save Changes' : 'Create Warehouse'}
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate className="space-y-6">
        <FormSection title="Identity">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Code" required htmlFor="wh-code" error={errors.code?.message} hint="Short unique code, e.g. MAIN or BLR-01. Cannot change later.">
              <Input id="wh-code" autoFocus={!warehouse} sanitize="code" maxLength={20} className="font-mono" disabled={Boolean(warehouse)} error={Boolean(errors.code)} {...register('code')} />
            </Field>
            <Field label="Name" required htmlFor="wh-name" error={errors.name?.message} className="sm:col-span-2">
              <Input id="wh-name" sanitize="singleLine" maxLength={100} error={Boolean(errors.name)} {...register('name')} />
            </Field>
          </div>
        </FormSection>
        <FormSection title="Address" description="The state code drives place of supply on documents shipped from this warehouse.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Address line 1" required htmlFor="wh-line1" error={errors.line1?.message} className="sm:col-span-2">
              <Input id="wh-line1" sanitize="singleLine" maxLength={200} error={Boolean(errors.line1)} {...register('line1')} />
            </Field>
            <Field label="Address line 2" htmlFor="wh-line2" error={errors.line2?.message} className="sm:col-span-2">
              <Input id="wh-line2" sanitize="singleLine" maxLength={200} error={Boolean(errors.line2)} {...register('line2')} />
            </Field>
            <Field label="City" required htmlFor="wh-city" error={errors.city?.message}>
              <Input id="wh-city" sanitize="singleLine" maxLength={100} error={Boolean(errors.city)} {...register('city')} />
            </Field>
            <Field label="State" required htmlFor="wh-state" error={errors.stateCode?.message}>
              <Select id="wh-state" placeholder="Select a state" options={STATE_OPTIONS} error={Boolean(errors.stateCode)} {...register('stateCode')} />
            </Field>
            <Field label="PIN code" required htmlFor="wh-pin" error={errors.pincode?.message}>
              <Input id="wh-pin" sanitize="pincode" className="tabular" error={Boolean(errors.pincode)} {...register('pincode')} />
            </Field>
            <Field label="Country" htmlFor="wh-country" error={errors.country?.message} hint="Two-letter ISO code">
              <Input id="wh-country" sanitize="upper" maxLength={2} className="font-mono uppercase" error={Boolean(errors.country)} {...register('country')} />
            </Field>
          </div>
        </FormSection>
        <FormSection title="Tax">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
            <Field label="GSTIN" htmlFor="wh-gstin" error={errors.gstin?.message} hint="Optional; for tenants registered in more than one state.">
              <Input id="wh-gstin" sanitize="gstin" className="font-mono" error={Boolean(errors.gstin)} {...register('gstin')} />
            </Field>
            <Checkbox label="Default warehouse" description="Pre-selected on new documents. The first warehouse is always the default." disabled={warehouse?.isDefault} {...register('isDefault')} />
          </div>
        </FormSection>
      </form>
    </Modal>
  );
}
