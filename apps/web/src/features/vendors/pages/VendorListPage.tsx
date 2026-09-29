import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Power, X } from 'lucide-react';
import { Button, Card, ConfirmDialog, Pagination } from '../../../components/ui';
import { useUrlFilters } from '../../../hooks/useUrlFilters';
import { toApiError } from '../../../lib/api';
import { useDeleteVendor, useVendorFormOptions, useVendorStatusMutation, useVendors } from '../hooks';
import type { VendorListItem } from '../types';
import { VendorToolbar } from '../components/VendorFilters';
import { VendorTable } from '../components/VendorTable';

const DEFAULTS = {
  page: 1,
  limit: 25,
  search: '',
  status: '',
  sortBy: 'displayName',
  sortOrder: 'asc',
  gstTreatmentId: '',
  sourceOfSupplyId: '',
  vendorType: '',
  tagOptionId: '',
};

export function VendorListPage() {
  const { filters, setFilters, reset } = useUrlFilters(DEFAULTS);
  const params = useMemo(() => ({ ...filters, status: filters.status || 'ALL' }), [filters]);
  const query = useVendors(params);
  const options = useVendorFormOptions();
  const statusMutation = useVendorStatusMutation();
  const deleteMutation = useDeleteVendor();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<VendorListItem | null>(null);
  const [pendingStatus, setPendingStatus] = useState<VendorListItem | null>(null);
  const [bulk, setBulk] = useState<'ACTIVE' | 'INACTIVE' | null>(null);

  const hasFilters = Boolean(filters.search || filters.status || filters.gstTreatmentId || filters.sourceOfSupplyId || filters.vendorType || filters.tagOptionId);
  const error = query.isError ? toApiError(query.error).message : null;

  const onSort = (key: string) => {
    if (filters.sortBy === key) setFilters({ sortOrder: filters.sortOrder === 'asc' ? 'desc' : 'asc' });
    else setFilters({ sortBy: key, sortOrder: 'asc' });
  };

  const changeStatus = async (row: VendorListItem) => {
    const next = row.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await statusMutation.mutateAsync({ id: row.id, status: next });
      toast.success(`${row.displayName} marked as ${next.toLowerCase()}`);
    } catch (err) {
      toast.error(toApiError(err).message);
    } finally {
      setPendingStatus(null);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteMutation.mutateAsync(pendingDelete.id);
      toast.success(`${pendingDelete.displayName} deleted`);
      setSelected((s) => {
        const n = new Set(s);
        n.delete(pendingDelete.id);
        return n;
      });
    } catch (err) {
      toast.error(toApiError(err).message);
    } finally {
      setPendingDelete(null);
    }
  };

  const runBulk = async () => {
    if (!bulk) return;
    const ids = [...selected];
    const results = await Promise.allSettled(ids.map((id) => statusMutation.mutateAsync({ id, status: bulk })));
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed) toast.error(`${failed} of ${ids.length} vendors could not be updated`);
    else toast.success(`${ids.length} vendor${ids.length === 1 ? '' : 's'} marked as ${bulk.toLowerCase()}`);
    setSelected(new Set());
    setBulk(null);
  };

  const data = query.data;

  return (
    <>
      <div className="mb-4">
        <VendorToolbar
          filters={filters}
          counts={data?.counts}
          options={options.data}
          onChange={(patch) => setFilters(patch)}
          onReset={reset}
          onRefresh={() => void query.refetch()}
          refreshing={query.isFetching && !query.isLoading}
        />
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">
          <span className="font-medium">{selected.size} selected</span>
          <Button size="xs" variant="secondary" icon={Power} onClick={() => setBulk('ACTIVE')}>
            Mark as Active
          </Button>
          <Button size="xs" variant="secondary" icon={Power} onClick={() => setBulk('INACTIVE')}>
            Mark as Inactive
          </Button>
          <Button size="xs" variant="ghost" icon={X} onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

      <Card className="overflow-hidden">
        <VendorTable
          rows={data?.data ?? []}
          loading={query.isLoading}
          error={error}
          onRetry={() => void query.refetch()}
          hasFilters={hasFilters}
          onClearFilters={reset}
          sortBy={filters.sortBy}
          sortOrder={filters.sortOrder as 'asc' | 'desc'}
          onSort={onSort}
          selected={selected}
          onSelectedChange={setSelected}
          onToggleStatus={(row) => setPendingStatus(row)}
          onDelete={(row) => setPendingDelete(row)}
        />
        {data && data.pagination.total > 0 && (
          <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} total={data.pagination.total} limit={data.pagination.limit} onPageChange={(p) => setFilters({ page: p })} onLimitChange={(l) => setFilters({ limit: l, page: 1 })} />
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(pendingStatus)}
        onClose={() => setPendingStatus(null)}
        onConfirm={() => pendingStatus && void changeStatus(pendingStatus)}
        loading={statusMutation.isPending}
        tone={pendingStatus?.status === 'ACTIVE' ? 'danger' : 'primary'}
        title={pendingStatus?.status === 'ACTIVE' ? 'Mark vendor as inactive?' : 'Mark vendor as active?'}
        confirmLabel={pendingStatus?.status === 'ACTIVE' ? 'Mark inactive' : 'Mark active'}
        message={
          pendingStatus?.status === 'ACTIVE' ? (
            <>
              <strong>{pendingStatus?.displayName}</strong> will no longer be selectable in new purchase transactions. Existing records are kept.
            </>
          ) : (
            <>
              <strong>{pendingStatus?.displayName}</strong> will be available again for new purchase transactions.
            </>
          )
        }
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
        loading={deleteMutation.isPending}
        title="Delete vendor?"
        confirmLabel="Delete"
        message={
          <>
            <strong>{pendingDelete?.displayName}</strong> will be removed from all vendor lists. The record is archived, not destroyed, so history and audit entries are preserved.
          </>
        }
      />

      <ConfirmDialog
        open={Boolean(bulk)}
        onClose={() => setBulk(null)}
        onConfirm={() => void runBulk()}
        loading={statusMutation.isPending}
        tone={bulk === 'INACTIVE' ? 'danger' : 'primary'}
        title={`Mark ${selected.size} vendor${selected.size === 1 ? '' : 's'} as ${bulk?.toLowerCase()}?`}
        confirmLabel="Apply"
        message="Status changes are recorded in each vendor's activity history."
      />
    </>
  );
}
