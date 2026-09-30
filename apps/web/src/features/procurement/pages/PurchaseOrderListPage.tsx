import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, ShoppingCart } from 'lucide-react';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, Input, ListToolbar, StatusBadge, type Column } from '../../../components/ui';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useUrlFilters } from '../../../hooks/useUrlFilters';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatDate, formatMoney } from '../../../lib/utils';
import { ProgressBar } from '../components/ProgressBar';
import { SupplierPicker } from '../components/pickers';
import { usePurchaseOrders } from '../hooks';
import type { PoListParams, PurchaseOrder } from '../types';

const DEFAULTS = { view: '', supplierId: '', q: '' };

const VIEWS = [
  { value: '', label: 'All purchase orders' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'AWAITING', label: 'Awaiting approval' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'ISSUED', label: 'Issued' },
  { value: 'PARTIALLY_RECEIVED', label: 'Partially received' },
  { value: 'RECEIVED', label: 'Received' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export function received(po: PurchaseOrder) {
  return po.lines.reduce((s, l) => s + l.receivedQty, 0);
}
export function ordered(po: PurchaseOrder) {
  return po.lines.reduce((s, l) => s + l.orderedQty, 0);
}

export function PurchaseOrderListPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const { filters, setFilters, reset } = useUrlFilters(DEFAULTS);
  const [search, setSearch] = useState(filters.q);
  const debounced = useDebouncedValue(search, 300);
  const [supplierLabel, setSupplierLabel] = useState<string>('');
  useEffect(() => {
    if (debounced !== filters.q) setFilters({ q: debounced });
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  const params = useMemo<PoListParams>(() => ({ ...(filters.view === 'AWAITING' ? { awaitingApproval: 'true' as const } : filters.view ? { status: filters.view } : {}), supplierId: filters.supplierId || undefined, q: filters.q || undefined, limit: 100 }), [filters]);
  const query = usePurchaseOrders(params);
  const rows = query.data ?? [];

  const columns: Column<PurchaseOrder>[] = [
    {
      key: 'number',
      header: 'Number',
      render: (po) => (
        <span className="flex items-center gap-2">
          <span className="font-medium text-slate-900 font-mono text-[13px]">{po.number}</span>
          {po.revision > 0 && <Badge tone="purple">rev {po.revision}</Badge>}
        </span>
      ),
    },
    { key: 'supplier', header: 'Vendor', render: (po) => <span className="text-slate-800">{po.supplier.displayName}</span> },
    { key: 'orderDate', header: 'Order date', hideBelow: 'md', render: (po) => <span className="tabular">{formatDate(po.orderDate)}</span> },
    { key: 'expectedDate', header: 'Expected', hideBelow: 'lg', render: (po) => <span className="tabular text-slate-600">{formatDate(po.expectedDate)}</span> },
    { key: 'total', header: 'Total', align: 'right', render: (po) => <span className="tabular font-medium">{formatMoney(po.total, po.currency)}</span> },
    { key: 'progress', header: 'Received', hideBelow: 'md', render: (po) => (['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CANCELLED'].includes(po.status) ? <span className="text-slate-300">-</span> : <ProgressBar value={received(po)} total={ordered(po)} />) },
    { key: 'status', header: 'Status', render: (po) => <StatusBadge status={po.status} /> },
  ];

  const chips = [
    ...(filters.supplierId ? [{ label: `Vendor: ${supplierLabel || 'selected'}`, onClear: () => setFilters({ supplierId: '' }) }] : []),
    ...(filters.q ? [{ label: `Search: ${filters.q}`, onClear: () => { setSearch(''); setFilters({ q: '' }); } }] : []),
  ];

  return (
    <>
      <ListToolbar
        views={VIEWS}
        view={filters.view}
        onViewChange={(v) => setFilters({ view: v })}
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching}
        chips={chips}
        onClearAll={chips.length ? () => { setSearch(''); reset(); } : undefined}
        filters={
          <>
            <div className="w-44 sm:w-56">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search number" aria-label="Search purchase orders" prefix={<Search className="w-4 h-4" />} className="h-9" />
            </div>
            <div className="w-48 sm:w-60">
              <SupplierPicker value={filters.supplierId} selectedLabel={supplierLabel || 'Vendor'} allowClear placeholder="All vendors" onChange={(id, s) => { setSupplierLabel(s?.displayName ?? ''); setFilters({ supplierId: id }); }} />
            </div>
          </>
        }
        actions={
          hasPermission('purchase.create') ? (
            <Button icon={Plus} onClick={() => navigate('/purchases/orders/new')}>
              New
            </Button>
          ) : undefined
        }
      />
      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(po) => po.id}
          loading={query.isLoading}
          error={query.isError ? <ErrorState message={toApiError(query.error).message} onRetry={() => void query.refetch()} /> : undefined}
          empty={
            <EmptyState
              icon={ShoppingCart}
              title={chips.length || filters.view ? 'No purchase orders match' : 'No purchase orders yet'}
              hint={chips.length || filters.view ? 'Try another view or clear the filters.' : 'Create a purchase order to start buying from a vendor.'}
              action={hasPermission('purchase.create') && !chips.length && !filters.view ? <Button icon={Plus} onClick={() => navigate('/purchases/orders/new')}>New purchase order</Button> : undefined}
            />
          }
          onRowClick={(po) => navigate(`/purchases/orders/${po.id}`)}
        />
        {rows.length >= 100 && <p className="px-4 py-2 text-xs text-slate-500 border-t border-slate-100">Showing the latest 100 orders. Narrow the view or search to find older ones.</p>}
      </Card>
    </>
  );
}
