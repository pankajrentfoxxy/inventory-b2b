import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { PURCHASE_ORDER_EDITABLE_STATUSES, PURCHASE_ORDER_STATUS_LABELS } from '@b2b/shared';
import { Button, Card, ErrorState, FormSkeleton, PageHeader } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { usePurchaseOrder, usePurchaseOrderFormOptions, useUpdatePurchaseOrder } from '../hooks';
import { PurchaseOrderForm } from '../form/PurchaseOrderForm';
import { PoStatusBadge } from '../components/PoStatusBadge';

export function PurchaseOrderEditPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const po = usePurchaseOrder(id);
  const options = usePurchaseOrderFormOptions();
  const update = useUpdatePurchaseOrder(id);

  const crumbs = [{ label: 'Purchases' }, { label: 'Purchase Orders', to: '/purchases/purchase-orders' }, { label: po.data?.purchaseOrderNumber ?? 'Purchase Order', to: `/purchases/purchase-orders/${id}` }, { label: 'Edit' }];

  if (po.isLoading || options.isLoading) {
    return (
      <>
        <PageHeader title="Edit Purchase Order" breadcrumbs={crumbs} />
        <FormSkeleton />
      </>
    );
  }
  if (po.isError || !po.data || options.isError || !options.data) {
    const err = toApiError(po.error ?? options.error);
    return (
      <>
        <PageHeader title="Edit Purchase Order" breadcrumbs={crumbs} />
        <Card>
          <ErrorState title={err.status === 404 ? 'Purchase order not found' : 'Could not load purchase order'} message={err.message} onRetry={err.status === 404 ? undefined : () => void po.refetch()} />
        </Card>
      </>
    );
  }
  if (!PURCHASE_ORDER_EDITABLE_STATUSES.includes(po.data.status)) {
    return (
      <>
        <PageHeader title={`Edit ${po.data.purchaseOrderNumber}`} breadcrumbs={crumbs} />
        <Card>
          <ErrorState title={`A ${PURCHASE_ORDER_STATUS_LABELS[po.data.status].toLowerCase()} purchase order cannot be edited`} message="Reopen the order first if you need to change it." />
          <div className="flex justify-center pb-6">
            <Button variant="secondary" onClick={() => navigate(`/purchases/purchase-orders/${id}`)}>
              Back to purchase order
            </Button>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            Edit {po.data.purchaseOrderNumber}
            <PoStatusBadge status={po.data.status} />
          </span>
        }
        breadcrumbs={crumbs}
      />
      <PurchaseOrderForm
        options={options.data}
        po={po.data}
        submitting={update.isPending}
        onSubmit={async (payload) => {
          const saved = await update.mutateAsync(payload);
          toast.success(`${saved.purchaseOrderNumber} updated`);
          return saved;
        }}
      />
    </>
  );
}
