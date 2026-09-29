import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FormSkeleton, PageHeader, ErrorState } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useUpdateVendor, useVendor, useVendorFormOptions } from '../hooks';
import { VendorForm } from '../form/VendorForm';
import { VendorStatusBadge } from '../components/VendorStatusBadge';

export function VendorEditPage() {
  const { id = '' } = useParams();
  const options = useVendorFormOptions();
  const vendor = useVendor(id);
  const update = useUpdateVendor(id);

  const loading = options.isLoading || vendor.isLoading;
  const error = options.isError ? options.error : vendor.isError ? vendor.error : null;

  return (
    <>
      <PageHeader
        title={vendor.data ? `Edit ${vendor.data.displayName}` : 'Edit Vendor'}
        subtitle={vendor.data ? <VendorStatusBadge status={vendor.data.status} /> : undefined}
        breadcrumbs={[{ label: 'Purchases' }, { label: 'Vendors', to: '/purchases/vendors' }, { label: vendor.data?.displayName ?? '...', to: `/purchases/vendors/${id}` }, { label: 'Edit' }]}
      />
      {loading ? (
        <FormSkeleton />
      ) : error || !options.data || !vendor.data ? (
        <ErrorState
          title={toApiError(error).status === 404 ? 'Vendor not found' : 'Could not load vendor'}
          message={toApiError(error).message}
          onRetry={() => {
            void options.refetch();
            void vendor.refetch();
          }}
        />
      ) : (
        <VendorForm
          options={options.data}
          vendor={vendor.data}
          submitting={update.isPending}
          onSubmit={async (payload) => {
            const saved = await update.mutateAsync(payload);
            toast.success('Vendor updated');
            return saved;
          }}
        />
      )}
    </>
  );
}
