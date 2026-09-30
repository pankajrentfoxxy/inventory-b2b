import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Button, Card, CardBody, EmptyState, ErrorState, FormSkeleton, PageHeader } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { humanize } from '../../../lib/utils';
import { PurchaseOrderForm } from '../components/PurchaseOrderForm';
import { defaultPoForm, poToForm } from '../components/poForm.model';
import { usePurchaseOrder, useScopedWarehouses } from '../hooks';

/** /purchases/orders/new and /purchases/orders/:id/edit (DRAFT only). */
export function PurchaseOrderEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const editing = Boolean(id);
  const po = usePurchaseOrder(id);
  const warehouses = useScopedWarehouses();
  const crumbs = [{ label: 'Purchases' }, { label: 'Purchase orders', to: '/purchases/orders' }, editing ? { label: po.data?.number ?? 'Edit', to: `/purchases/orders/${id}` } : { label: 'New' }];

  const initial = useMemo(() => {
    if (editing) return po.data ? poToForm(po.data) : null;
    const wh = warehouses.warehouses;
    const def = warehouses.defaultId || (wh.length === 1 ? wh[0].id : '');
    return { ...defaultPoForm(def), shipToStateCode: wh.find((w) => w.id === def)?.stateCode ?? '' };
  }, [editing, po.data, warehouses.warehouses, warehouses.defaultId]);

  if (editing && po.isLoading) {
    return (
      <>
        <PageHeader title="Edit purchase order" breadcrumbs={crumbs} />
        <Card>
          <CardBody>
            <FormSkeleton />
          </CardBody>
        </Card>
      </>
    );
  }
  if (editing && (po.isError || !po.data)) {
    return (
      <>
        <PageHeader title="Edit purchase order" breadcrumbs={crumbs} />
        <Card>
          <ErrorState message={po.error ? toApiError(po.error).message : 'Purchase order not found'} onRetry={() => void po.refetch()} />
        </Card>
      </>
    );
  }
  if (editing && po.data && po.data.status !== 'DRAFT') {
    return (
      <>
        <PageHeader title={`Edit ${po.data.number}`} breadcrumbs={crumbs} />
        <Card>
          <EmptyState
            icon={Lock}
            title={`This order is ${humanize(po.data.status).toLowerCase()}`}
            hint="Only draft purchase orders can be edited. Issued orders are changed through a revision from the order page."
            action={
              <Button variant="secondary" onClick={() => navigate(`/purchases/orders/${po.data!.id}`)}>
                Open purchase order
              </Button>
            }
          />
        </Card>
      </>
    );
  }
  if (!editing && warehouses.isLoading) {
    return (
      <>
        <PageHeader title="New purchase order" breadcrumbs={crumbs} />
        <Card>
          <CardBody>
            <FormSkeleton />
          </CardBody>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title={editing ? `Edit ${po.data!.number}` : 'New purchase order'} subtitle={editing ? 'Draft. Changes are saved with optimistic locking.' : 'Saved as a draft until you submit it for approval.'} breadcrumbs={crumbs} />
      {initial && <PurchaseOrderForm key={editing ? `${po.data!.id}:${po.data!.version}` : 'new'} initial={initial} editing={editing ? po.data! : null} />}
    </>
  );
}
