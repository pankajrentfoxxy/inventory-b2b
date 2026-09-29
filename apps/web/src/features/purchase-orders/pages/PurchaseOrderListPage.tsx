import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowDownAZ, ArrowUpAZ, Check, ChevronDown, MoreHorizontal, Plus, RefreshCw, Send, Settings2, SlidersHorizontal, X } from 'lucide-react';
import { PURCHASE_ORDER_STATUS_LABELS, PURCHASE_ORDER_STATUSES, validateDateRange } from '@b2b/shared';
import { Button, Card, ConfirmDialog, Dropdown, IconButton, Input, Pagination, SearchSelect, type MenuItem } from '../../../components/ui';
import { useUrlFilters } from '../../../hooks/useUrlFilters';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { toApiError } from '../../../lib/api';
import { usePermission } from '../../../lib/auth';
import { cn } from '../../../lib/utils';
import { useVendors } from '../../vendors/hooks';
import { usePurchaseOrderAction, usePurchaseOrders } from '../hooks';
import type { PoListItem } from '../types';
import { PoTable } from '../components/PoTable';

const DEFAULTS = { page: 1, limit: 25, search: '', status: '', vendorId: '', dateFrom: '', dateTo: '', sortBy: 'createdAt', sortOrder: 'desc' };

const VIEWS: { value: string; label: string }[] = [
  { value: '', label: 'All Purchase Orders' },
  { value: 'OPEN', label: 'Open Orders' },
  ...PURCHASE_ORDER_STATUSES.map((s) => ({ value: s, label: `${PURCHASE_ORDER_STATUS_LABELS[s]} Orders` })),
];
const SORTS = [
  { value: 'createdAt', label: 'Created Time' },
  { value: 'orderDate', label: 'Date' },
  { value: 'purchaseOrderNumber', label: 'Purchase Order#' },
  { value: 'expectedDeliveryDate', label: 'Expected Delivery Date' },
  { value: 'total', label: 'Amount' },
  { value: 'status', label: 'Status' },
  { value: 'updatedAt', label: 'Last Modified Time' },
];

export function PurchaseOrderListPage() {
  const navigate = useNavigate();
  const perms = usePermission();
  const { filters, setFilters, reset } = useUrlFilters(DEFAULTS);
  // An inverted date range is shown as an error and the "to" bound is dropped from the request.
  const dateRangeError = validateDateRange(filters.dateFrom, filters.dateTo, 'From date', 'To date');
  const params = useMemo(() => ({ ...filters, status: filters.status || 'ALL', dateTo: dateRangeError ? '' : filters.dateTo }), [filters, dateRangeError]);
  const query = usePurchaseOrders(params);
  const action = usePurchaseOrderAction();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<{ row: PoListItem; action: 'issue' | 'cancel' | 'delete' } | null>(null);
  const [bulkIssue, setBulkIssue] = useState(false);
  const [advanced, setAdvanced] = useState(Boolean(filters.vendorId || filters.dateFrom || filters.dateTo));
  const [vendorTerm, setVendorTerm] = useState('');
  const vendors = useVendors({ page: 1, limit: 15, search: useDebouncedValue(vendorTerm, 250), status: 'ALL', sortBy: 'displayName', sortOrder: 'asc', gstTreatmentId: '', sourceOfSupplyId: '', vendorType: '', tagOptionId: '' }, advanced);

  const data = query.data;
  const view = VIEWS.find((v) => v.value === (filters.status || '')) ?? VIEWS[0];
  const advancedCount = [filters.vendorId, filters.dateFrom, filters.dateTo].filter(Boolean).length;
  const hasFilters = Boolean(filters.search || filters.status || advancedCount);

  const onSort = (key: string) => {
    if (filters.sortBy === key) setFilters({ sortOrder: filters.sortOrder === 'asc' ? 'desc' : 'asc' });
    else setFilters({ sortBy: key, sortOrder: key === 'purchaseOrderNumber' ? 'asc' : 'desc' });
  };

  const runPending = async () => {
    if (!pending) return;
    try {
      await action.mutateAsync({ id: pending.row.id, action: pending.action });
      toast.success(`${pending.row.purchaseOrderNumber} ${pending.action === 'issue' ? 'issued' : pending.action === 'cancel' ? 'cancelled' : 'deleted'}`);
    } catch (err) {
      toast.error(toApiError(err).message);
    } finally {
      setPending(null);
    }
  };

  const runBulkIssue = async () => {
    const ids = [...selected].filter((id) => data?.data.find((r) => r.id === id)?.status === 'DRAFT');
    const results = await Promise.allSettled(ids.map((id) => action.mutateAsync({ id, action: 'issue' })));
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed) toast.error(`${failed} of ${ids.length} orders could not be issued`);
    else toast.success(`${ids.length} order${ids.length === 1 ? '' : 's'} issued`);
    setSelected(new Set());
    setBulkIssue(false);
  };

  const moreItems: MenuItem[] = [
    ...SORTS.map((o) => ({
      key: `sort-${o.value}`,
      label: (
        <span className="flex items-center justify-between w-full gap-3">
          <span className="text-slate-500 text-xs">Sort by</span>
          <span className="flex-1">{o.label}</span>
          {filters.sortBy === o.value && <Check className="w-4 h-4 text-brand-600" />}
        </span>
      ),
      onSelect: () => onSort(o.value),
    })),
    { key: 'order', label: filters.sortOrder === 'asc' ? 'Ascending order' : 'Descending order', icon: filters.sortOrder === 'asc' ? ArrowDownAZ : ArrowUpAZ, onSelect: () => setFilters({ sortOrder: filters.sortOrder === 'asc' ? 'desc' : 'asc' }) },
    { key: 'refresh', label: 'Refresh List', icon: RefreshCw, onSelect: () => void query.refetch() },
    { key: 'settings', label: 'Purchase Settings', icon: Settings2, onSelect: () => navigate('/settings/purchases'), hidden: !perms.canManageSettings },
  ];

  const selectedDrafts = [...selected].filter((id) => data?.data.find((r) => r.id === id)?.status === 'DRAFT').length;

  return (
    <>
      <div className="mb-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Dropdown
            align="left"
            trigger={({ toggle }) => (
              <button type="button" onClick={toggle} className="inline-flex items-center gap-1.5 text-xl font-semibold text-slate-900 hover:text-brand-700">
                {view.label}
                <ChevronDown className="w-5 h-5 text-brand-600" />
              </button>
            )}
            items={VIEWS.map((v) => ({
              key: v.value || 'all',
              label: (
                <span className="flex items-center justify-between w-full gap-4">
                  <span>{v.label}</span>
                  <span className="flex items-center gap-2">
                    {data && <span className="text-xs text-slate-400 tabular">{data.counts[v.value || 'ALL'] ?? 0}</span>}
                    {v.value === (filters.status || '') && <Check className="w-4 h-4 text-brand-600" />}
                  </span>
                </span>
              ),
              onSelect: () => setFilters({ status: v.value }),
            }))}
          />
          <div className="flex items-center gap-2">
            <Button variant={advanced || advancedCount ? 'subtle' : 'secondary'} icon={SlidersHorizontal} onClick={() => setAdvanced((o) => !o)}>
              Filters{advancedCount ? ` (${advancedCount})` : ''}
            </Button>
            {perms.canCreatePurchaseOrder && (
              <Button icon={Plus} onClick={() => navigate('/purchases/purchase-orders/new')}>
                New
              </Button>
            )}
            <Dropdown trigger={({ toggle }) => <IconButton icon={MoreHorizontal} label="More actions" onClick={toggle} className={cn('border border-slate-300 bg-white', query.isFetching && !query.isLoading && 'animate-pulse')} />} items={moreItems} />
          </div>
        </div>

        {advanced && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 rounded-lg border border-slate-200 bg-white">
            <SearchSelect
              value={filters.vendorId}
              selectedLabel={vendors.data?.data.find((v) => v.id === filters.vendorId)?.displayName ?? 'Selected vendor'}
              onChange={(v) => setFilters({ vendorId: v })}
              onSearch={setVendorTerm}
              loading={vendors.isFetching}
              allowClear
              size="sm"
              placeholder="All vendors"
              options={(vendors.data?.data ?? []).map((v) => ({ value: v.id, label: v.displayName }))}
            />
            <Input type="date" aria-label="From date" value={filters.dateFrom} max={filters.dateTo || undefined} onChange={(e) => setFilters({ dateFrom: e.target.value })} className="h-8 text-xs" />
            <div>
              <Input type="date" aria-label="To date" value={filters.dateTo} min={filters.dateFrom || undefined} onChange={(e) => setFilters({ dateTo: e.target.value })} error={Boolean(dateRangeError)} className="h-8 text-xs" />
              {dateRangeError && <p className="text-xs text-red-600 mt-1">{dateRangeError}</p>}
            </div>
          </div>
        )}

        {hasFilters && (
          <div className="flex items-center gap-2 flex-wrap text-xs text-slate-600">
            {filters.search && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 text-brand-700 px-2.5 py-1">
                Search: <strong>{filters.search}</strong>
                <button type="button" onClick={() => setFilters({ search: '' })} aria-label="Clear search" className="hover:text-brand-900">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            <button type="button" onClick={reset} className="text-slate-500 hover:text-slate-800 hover:underline">
              Clear all filters
            </button>
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">
          <span className="font-medium">{selected.size} selected</span>
          <Button size="xs" variant="secondary" icon={Send} disabled={selectedDrafts === 0} onClick={() => setBulkIssue(true)}>
            Issue {selectedDrafts} draft{selectedDrafts === 1 ? '' : 's'}
          </Button>
          <Button size="xs" variant="ghost" icon={X} onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

      <Card className="overflow-hidden">
        <PoTable rows={data?.data ?? []} loading={query.isLoading} error={query.isError ? toApiError(query.error).message : null} onRetry={() => void query.refetch()} hasFilters={hasFilters} onClearFilters={reset} sortBy={filters.sortBy} sortOrder={filters.sortOrder as 'asc' | 'desc'} onSort={onSort} selected={selected} onSelectedChange={setSelected} onAction={(row, a) => setPending({ row, action: a })} />
        {data && data.pagination.total > 0 && <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} total={data.pagination.total} limit={data.pagination.limit} onPageChange={(p) => setFilters({ page: p })} onLimitChange={(l) => setFilters({ limit: l, page: 1 })} />}
      </Card>

      <ConfirmDialog
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        onConfirm={() => void runPending()}
        loading={action.isPending}
        tone={pending?.action === 'issue' ? 'primary' : 'danger'}
        title={pending?.action === 'issue' ? 'Issue this purchase order?' : pending?.action === 'cancel' ? 'Cancel this purchase order?' : 'Delete this purchase order?'}
        confirmLabel={pending?.action === 'issue' ? 'Mark as Issued' : pending?.action === 'cancel' ? 'Cancel Order' : 'Delete'}
        message={
          pending?.action === 'issue' ? (
            <><strong>{pending?.row.purchaseOrderNumber}</strong> will be marked as issued to {pending?.row.vendor.displayName} and goods can be received against it.</>
          ) : pending?.action === 'cancel' ? (
            <><strong>{pending?.row.purchaseOrderNumber}</strong> will be cancelled. It stays in the list for reference and can be reopened later.</>
          ) : (
            <><strong>{pending?.row.purchaseOrderNumber}</strong> will be removed from purchase order lists. History is preserved.</>
          )
        }
      />
      <ConfirmDialog open={bulkIssue} onClose={() => setBulkIssue(false)} onConfirm={() => void runBulkIssue()} loading={action.isPending} tone="primary" title={`Issue ${selectedDrafts} draft order${selectedDrafts === 1 ? '' : 's'}?`} confirmLabel="Issue" message="Only draft orders in the selection will be issued. Each change is recorded in the order's activity." />
    </>
  );
}
