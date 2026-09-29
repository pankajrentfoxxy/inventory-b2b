import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowDownAZ, ArrowUpAZ, Check, ChevronDown, Eye, MoreHorizontal, PackageCheck, Plus, RefreshCw, SearchX, X, XCircle } from 'lucide-react';
import { Button, Card, ConfirmDialog, DataTable, Dropdown, EmptyState, ErrorState, IconButton, Pagination, Textarea, type Column, type MenuItem } from '../../../components/ui';
import { useUrlFilters } from '../../../hooks/useUrlFilters';
import { toApiError } from '../../../lib/api';
import { usePermission } from '../../../lib/auth';
import { formatDate, formatQty } from '../../../lib/utils';
import { ReceiveStatusBadge } from '../../purchase-orders/components/PoStatusBadge';
import { useCancelPurchaseReceive, usePurchaseReceives } from '../hooks';
import type { PurchaseReceive } from '../types';

const DEFAULTS = { page: 1, limit: 25, search: '', status: '', vendorId: '', purchaseOrderId: '', sortBy: 'createdAt', sortOrder: 'desc' };
const VIEWS = [
  { value: '', label: 'All Purchase Receives', key: 'ALL' },
  { value: 'RECEIVED', label: 'Received', key: 'RECEIVED' },
  { value: 'CANCELLED', label: 'Cancelled', key: 'CANCELLED' },
];
const SORTS = [
  { value: 'createdAt', label: 'Created Time' },
  { value: 'receivedDate', label: 'Date' },
  { value: 'receiveNumber', label: 'Purchase Receive#' },
];

export function PurchaseReceiveListPage() {
  const navigate = useNavigate();
  const perms = usePermission();
  const { filters, setFilters, reset } = useUrlFilters(DEFAULTS);
  const params = useMemo(() => ({ ...filters, status: filters.status || 'ALL' }), [filters]);
  const query = usePurchaseReceives(params);
  const cancel = useCancelPurchaseReceive();
  const [pending, setPending] = useState<PurchaseReceive | null>(null);
  const [reason, setReason] = useState('');
  const data = query.data;
  const view = VIEWS.find((v) => v.value === (filters.status || '')) ?? VIEWS[0];
  const hasFilters = Boolean(filters.search || filters.status || filters.vendorId || filters.purchaseOrderId);

  const onSort = (key: string) => {
    if (filters.sortBy === key) setFilters({ sortOrder: filters.sortOrder === 'asc' ? 'desc' : 'asc' });
    else setFilters({ sortBy: key, sortOrder: 'desc' });
  };

  const doCancel = async () => {
    if (!pending) return;
    try {
      await cancel.mutateAsync({ id: pending.id, reason: reason || undefined });
      toast.success(`${pending.receiveNumber} cancelled`);
    } catch (err) {
      toast.error(toApiError(err).message);
    } finally {
      setPending(null);
      setReason('');
    }
  };

  const columns: Column<PurchaseReceive>[] = [
    { key: 'receivedDate', header: 'Date', sortable: true, className: 'whitespace-nowrap', render: (r) => <span className="tabular text-slate-800">{formatDate(r.receivedDate)}</span> },
    { key: 'receiveNumber', header: 'Purchase Receive#', sortable: true, render: (r) => <Link to={`/purchases/purchase-receives/${r.id}`} className="font-mono text-[13px] font-medium text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>{r.receiveNumber}</Link> },
    { key: 'po', header: 'Purchase Order#', hideBelow: 'md', render: (r) => <Link to={`/purchases/purchase-orders/${r.purchaseOrder.id}`} className="font-mono text-[13px] text-slate-700 hover:text-brand-700" onClick={(e) => e.stopPropagation()}>{r.purchaseOrder.purchaseOrderNumber}</Link> },
    { key: 'vendor', header: 'Vendor Name', hideBelow: 'md', render: (r) => <span className="text-slate-800">{r.vendor.displayName}</span> },
    { key: 'status', header: 'Status', render: (r) => <ReceiveStatusBadge status={r.status} /> },
    { key: 'billed', header: 'Billed', hideBelow: 'xl', render: () => <span className="text-slate-300" title="Billing is not connected yet">-</span> },
    { key: 'qty', header: 'Quantity', align: 'right', render: (r) => <span className="tabular font-medium text-slate-900">{formatQty(r.totalQuantity)}</span> },
  ];

  const moreItems: MenuItem[] = [
    ...SORTS.map((o) => ({ key: `sort-${o.value}`, label: <span className="flex items-center justify-between w-full gap-3"><span className="text-slate-500 text-xs">Sort by</span><span className="flex-1">{o.label}</span>{filters.sortBy === o.value && <Check className="w-4 h-4 text-brand-600" />}</span>, onSelect: () => onSort(o.value) })),
    { key: 'order', label: filters.sortOrder === 'asc' ? 'Ascending order' : 'Descending order', icon: filters.sortOrder === 'asc' ? ArrowDownAZ : ArrowUpAZ, onSelect: () => setFilters({ sortOrder: filters.sortOrder === 'asc' ? 'desc' : 'asc' }) },
    { key: 'refresh', label: 'Refresh List', icon: RefreshCw, onSelect: () => void query.refetch() },
  ];

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
            items={VIEWS.map((v) => ({ key: v.key, label: <span className="flex items-center justify-between w-full gap-4"><span>{v.label}</span><span className="flex items-center gap-2">{data && <span className="text-xs text-slate-400 tabular">{data.counts[v.key] ?? 0}</span>}{v.value === (filters.status || '') && <Check className="w-4 h-4 text-brand-600" />}</span></span>, onSelect: () => setFilters({ status: v.value }) }))}
          />
          <div className="flex items-center gap-2">
            {perms.canCreateReceive && (
              <Button icon={Plus} onClick={() => navigate('/purchases/purchase-receives/new')}>
                New
              </Button>
            )}
            <Dropdown trigger={({ toggle }) => <IconButton icon={MoreHorizontal} label="More actions" onClick={toggle} className="border border-slate-300 bg-white" />} items={moreItems} />
          </div>
        </div>
        {hasFilters && (
          <div className="flex items-center gap-2 flex-wrap text-xs text-slate-600">
            {filters.search && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 text-brand-700 px-2.5 py-1">
                Search: <strong>{filters.search}</strong>
                <button type="button" onClick={() => setFilters({ search: '' })} aria-label="Clear search" className="hover:text-brand-900"><X className="w-3 h-3" /></button>
              </span>
            )}
            <button type="button" onClick={reset} className="text-slate-500 hover:text-slate-800 hover:underline">Clear all filters</button>
          </div>
        )}
      </div>

      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={data?.data ?? []}
          rowKey={(r) => r.id}
          loading={query.isLoading}
          error={query.isError ? <ErrorState message={toApiError(query.error).message} onRetry={() => void query.refetch()} /> : undefined}
          empty={hasFilters ? <EmptyState icon={SearchX} title="No purchase receives match" action={<Button variant="secondary" size="sm" onClick={reset}>Clear filters</Button>} /> : <EmptyState icon={PackageCheck} title="No purchase receives yet" hint="When goods arrive against an issued purchase order, record a purchase receive here." action={perms.canCreateReceive ? <Button onClick={() => navigate('/purchases/purchase-receives/new')}>New Purchase Receive</Button> : undefined} />}
          sortBy={filters.sortBy}
          sortOrder={filters.sortOrder as 'asc' | 'desc'}
          onSort={onSort}
          onRowClick={(r) => navigate(`/purchases/purchase-receives/${r.id}`)}
          rowActions={(r) => (
            <Dropdown
              trigger={({ toggle }) => <IconButton icon={MoreHorizontal} label="Receive actions" size="sm" onClick={toggle} />}
              items={[
                { key: 'view', label: 'View', icon: Eye, onSelect: () => navigate(`/purchases/purchase-receives/${r.id}`) },
                { key: 'cancel', label: 'Cancel', icon: XCircle, tone: 'danger', onSelect: () => setPending(r), hidden: !perms.canCancelReceive || r.status !== 'RECEIVED' },
              ]}
            />
          )}
        />
        {data && data.pagination.total > 0 && <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} total={data.pagination.total} limit={data.pagination.limit} onPageChange={(p) => setFilters({ page: p })} onLimitChange={(l) => setFilters({ limit: l, page: 1 })} />}
      </Card>

      <ConfirmDialog open={Boolean(pending)} onClose={() => setPending(null)} onConfirm={() => void doCancel()} loading={cancel.isPending} title="Cancel this purchase receive?" confirmLabel="Cancel Receive" message={<div className="space-y-3"><p><strong>{pending?.receiveNumber}</strong> will be cancelled and the received quantities reversed on {pending?.purchaseOrder.purchaseOrderNumber}.</p><Textarea rows={2} placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} /></div>} />
    </>
  );
}
