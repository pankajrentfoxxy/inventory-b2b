import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ErrorState, FormSkeleton, PageHeader } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useVendor } from '../../vendors/hooks';
import { useCreatePurchaseOrder, usePurchaseOrderFormOptions } from '../hooks';
import { PurchaseOrderForm } from '../form/PurchaseOrderForm';

export function PurchaseOrderCreatePage() {
  const options = usePurchaseOrderFormOptions();
  const create = useCreatePurchaseOrder();
  const [params] = useSearchParams();
  const vendorId = params.get('vendor') ?? undefined;
  const vendor = useVendor(vendorId);
  const preset = useMemo(() => (vendorId && vendor.data ? { vendorId, vendorName: vendor.data.displayName } : vendorId ? undefined : {}), [vendorId, vendor.data]);
  const waiting = options.isLoading || (vendorId && vendor.isLoading);

  return (
    <>
      <PageHeader title="New Purchase Order" breadcrumbs={[{ label: 'Purchases' }, { label: 'Purchase Orders', to: '/purchases/purchase-orders' }, { label: 'New' }]} />
      {waiting ? (
        <FormSkeleton />
      ) : options.isError || !options.data ? (
        <ErrorState message={toApiError(options.error).message} onRetry={() => void options.refetch()} />
      ) : (
        <PurchaseOrderForm
          options={options.data}
          preset={preset}
          submitting={create.isPending}
          onSubmit={async (payload, mode) => {
            const saved = await create.mutateAsync({ payload, issue: mode === 'issue' });
            toast.success(mode === 'issue' ? `${saved.purchaseOrderNumber} issued` : `${saved.purchaseOrderNumber} saved as draft`);
            return saved;
          }}
        />
      )}
    </>
  );
}
