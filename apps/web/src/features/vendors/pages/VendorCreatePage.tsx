import toast from 'react-hot-toast';
import { FormSkeleton, PageHeader, ErrorState } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useCreateVendor, useVendorFormOptions } from '../hooks';
import { VendorForm } from '../form/VendorForm';

export function VendorCreatePage() {
  const options = useVendorFormOptions();
  const create = useCreateVendor();

  return (
    <>
      <PageHeader title="New Vendor" breadcrumbs={[{ label: 'Purchases' }, { label: 'Vendors', to: '/purchases/vendors' }, { label: 'New' }]} />
      {options.isLoading ? (
        <FormSkeleton />
      ) : options.isError || !options.data ? (
        <ErrorState message={toApiError(options.error).message} onRetry={() => void options.refetch()} />
      ) : (
        <VendorForm
          options={options.data}
          submitting={create.isPending}
          onSubmit={async (payload, andNew) => {
            const saved = await create.mutateAsync(payload);
            toast.success(andNew ? `${saved.displayName} created. Add the next vendor.` : `${saved.displayName} created`);
            return saved;
          }}
        />
      )}
    </>
  );
}
