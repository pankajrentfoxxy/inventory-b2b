import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Button, Modal } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { applyServerErrors, summarizeErrors } from '../../../lib/validation';
import { useUpdateTenant } from '../hooks';
import type { Tenant } from '../types';
import { TenantProfileFields, formValuesToPatch, tenantToFormValues, type TenantFormValues } from './TenantProfileFields';

/** PATCH /v1/platform/vendors/:id with If-Match: version. The service diffs and audits only changed fields. */
export function TenantEditModal({ tenant, open, onClose }: { tenant: Tenant; open: boolean; onClose: () => void }) {
  const update = useUpdateTenant();
  const form = useForm<TenantFormValues>({ defaultValues: tenantToFormValues(tenant) });
  const { handleSubmit, reset, setError, formState: { isDirty } } = form;

  useEffect(() => {
    if (open) reset(tenantToFormValues(tenant));
  }, [open, tenant, reset]);

  const submit = handleSubmit(async (v) => {
    try {
      await update.mutateAsync({ id: tenant.id, payload: formValuesToPatch(v), version: tenant.version });
      toast.success(`${v.displayName.trim()} updated`);
      onClose();
    } catch (err) {
      const e = toApiError(err);
      const unmapped = applyServerErrors(setError, e);
      toast.error(summarizeErrors(unmapped, e.message));
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit ${tenant.displayName}`}
      description={`Code ${tenant.code}. Changes are audited; the code itself cannot change.`}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={update.isPending} disabled={!isDirty}>
            Save changes
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        <TenantProfileFields form={form} autoFocus />
      </form>
    </Modal>
  );
}
