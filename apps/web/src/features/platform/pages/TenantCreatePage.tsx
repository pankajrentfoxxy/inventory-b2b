import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Button, Card, CardBody, PageHeader } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { applyServerErrors, summarizeErrors } from '../../../lib/validation';
import { shouldRetryWithSameKey, useIdempotencyKey } from '../../../hooks/useIdempotencyKey';
import { useCreateTenant } from '../hooks';
import { EMPTY_TENANT_FORM, TenantProfileFields, formValuesToPayload, type TenantFormValues } from '../components/TenantProfileFields';

/** POST /v1/platform/vendors (Idempotency-Key). The tenant starts PENDING; approval happens on the detail page. */
export function TenantCreatePage() {
  const navigate = useNavigate();
  const create = useCreateTenant();
  const { keyFor, reset: resetKey } = useIdempotencyKey();
  const form = useForm<TenantFormValues>({ defaultValues: EMPTY_TENANT_FORM });
  const { handleSubmit, setError, formState: { isDirty } } = form;

  const submit = handleSubmit(async (v) => {
    const payload = formValuesToPayload(v);
    try {
      const tenant = await create.mutateAsync({ payload, idempotencyKey: keyFor(payload) });
      resetKey();
      toast.success(`${tenant.displayName} created as ${tenant.code}. It is pending approval.`);
      navigate(`/admin/tenants/${tenant.id}`, { replace: true });
    } catch (err) {
      const e = toApiError(err);
      if (!shouldRetryWithSameKey(e.status)) resetKey();
      toast.error(summarizeErrors(applyServerErrors(setError, e), e.message));
    }
  });

  return (
    <>
      <PageHeader
        title="New tenant"
        subtitle="Creates a tenant in PENDING status. Approve and activate it from the tenant page to send the owner invite."
        breadcrumbs={[{ label: 'Tenants', to: '/admin/tenants' }, { label: 'New tenant' }]}
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/admin/tenants')} disabled={create.isPending}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} loading={create.isPending}>
              Create tenant
            </Button>
          </>
        }
      />
      <Card>
        <CardBody>
          <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
            <TenantProfileFields form={form} showCode autoFocus />
            <div className="mt-6 flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
              {isDirty && <span className="text-xs text-slate-400 mr-auto">Unsaved changes</span>}
              <Button variant="secondary" onClick={() => navigate('/admin/tenants')} disabled={create.isPending}>
                Cancel
              </Button>
              <Button type="submit" loading={create.isPending}>
                Create tenant
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </>
  );
}
