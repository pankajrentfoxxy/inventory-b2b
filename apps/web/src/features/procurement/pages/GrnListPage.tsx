import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PackageCheck, Plus } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, ErrorState, ListToolbar, StatusBadge, type Column } from '../../../components/ui';
import { useUrlFilters } from '../../../hooks/useUrlFilters';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatDate, formatQty } from '../../../lib/utils';
import { LaptopSpecsView } from '../../../components/LaptopSpecs';
import { WarehouseSelect } from '../components/pickers';
import { useGrns, usePurchaseOrder } from '../hooks';
import type { Grn, GrnListParams } from '../types';

const DEFAULTS = { status: '', warehouseId: '', poId: '', q: '' };

const VIEWS = [
  { value: '', label: 'All goods receipts' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'RECEIVED', label: 'Received (posting in progress)' },
  { value: 'QC_PENDING', label: 'QC pending' },
  { value: 'QC_COMPLETED', label: 'QC completed' },
  { value: 'POSTING_FAILED', label: 'Posting failed' },
  { value: 'CANCELLATION_PENDING', label: 'Cancellation pending' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export function GrnListPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const { filters, setFilters, reset } = useUrlFilters(DEFAULTS);
  const params = useMemo<GrnListParams>(() => ({ status: filters.status || undefined, warehouseId: filters.warehouseId || undefined, poId: filters.poId || undefined, q: filters.q || undefined, limit: 100 }), [filters]);
  const query = useGrns(params);
  const po = usePurchaseOrder(filters.poId || undefined);
  const rows = query.data ?? [];

  const columns: Column<Grn>[] = [
    { key: 'number', header: 'Number', render: (g) => <span className="font-mono text-[13px] font-medium text-slate-900">{g.number}</span> },
    {
      key: 'po',
      header: 'Purchase order',
      render: (g) => (
        <Link to={`/purchases/orders/${g.poId}`} onClick={(e) => e.stopPropagation()} className="text-brand-700 hover:underline font-mono text-[13px]">
          {g.poNumber ?? (po.data && po.data.id === g.poId ? po.data.number : g.poId.slice(0, 8))}
        </Link>
      ),
    },
    {
      key: 'laptops',
      header: 'Laptops',
      hideBelow: 'md',
      render: (g) => {
        const first = g.lines[0];
        if (!first) return <span className="text-slate-300">-</span>;
        return (
          <div className="min-w-0 max-w-[280px]">
            <p className="text-[13px]">
              <span className="font-mono font-medium text-slate-900">{first.item.sku}</span>
              {g.lines.length > 1 && <span className="text-xs text-slate-500"> +{g.lines.length - 1} more</span>}
            </p>
            <LaptopSpecsView specs={first.item.specs} variant="inline" />
          </div>
        );
      },
    },
    { key: 'supplier', header: 'Vendor', hideBelow: 'md', render: (g) => g.supplier.displayName },
    { key: 'warehouse', header: 'Warehouse', hideBelow: 'md', render: (g) => `${g.warehouse.code} - ${g.warehouse.name}` },
    { key: 'date', header: 'Received', render: (g) => <span className="tabular">{formatDate(g.receivedDate)}</span> },
    { key: 'lines', header: 'Lines', align: 'right', hideBelow: 'lg', render: (g) => <span className="tabular">{g.lines.length}</span> },
    {
      key: 'qc',
      header: 'QC progress',
      hideBelow: 'lg',
      render: (g) =>
        ['DRAFT', 'RECEIVED', 'POSTING_FAILED', 'CANCELLED'].includes(g.status) ? (
          <span className="text-slate-300">-</span>
        ) : (
          <span className="text-xs tabular">
            {g.qcProgress.done}/{g.qcProgress.total} lines
            {g.qcProgress.done > 0 && (
              <span className="ml-2">
                <span className="text-emerald-700">{formatQty(g.qcProgress.passQty)} pass</span> / <span className={g.qcProgress.failQty > 0 ? 'text-red-700' : 'text-slate-500'}>{formatQty(g.qcProgress.failQty)} fail</span>
              </span>
            )}
          </span>
        ),
    },
    { key: 'status', header: 'Status', render: (g) => <StatusBadge status={g.status} /> },
  ];

  const chips = [
    ...(filters.q ? [{ label: `Search: ${filters.q}`, onClear: () => setFilters({ q: '' }) }] : []),
    ...(filters.warehouseId ? [{ label: 'Warehouse filter', onClear: () => setFilters({ warehouseId: '' }) }] : []),
    ...(filters.poId ? [{ label: `PO: ${po.data?.number ?? filters.poId.slice(0, 8)}`, onClear: () => setFilters({ poId: '' }) }] : []),
  ];

  return (
    <>
      <ListToolbar
        views={VIEWS}
        view={filters.status}
        onViewChange={(v) => setFilters({ status: v })}
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching}
        chips={chips}
        onClearAll={chips.length ? reset : undefined}
        filters={
          <div className="w-52 sm:w-64">
            <WarehouseSelect value={filters.warehouseId} onChange={(id) => setFilters({ warehouseId: id })} placeholder="All warehouses" includeInactive />
          </div>
        }
        actions={
          hasPermission('grn.create') ? (
            <Button icon={Plus} onClick={() => navigate(filters.poId ? `/purchases/receipts/new?po=${filters.poId}` : '/purchases/receipts/new')}>
              New
            </Button>
          ) : undefined
        }
      />
      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(g) => g.id}
          loading={query.isLoading}
          error={query.isError ? <ErrorState message={toApiError(query.error).message} onRetry={() => void query.refetch()} /> : undefined}
          empty={
            <EmptyState
              icon={PackageCheck}
              title={chips.length || filters.status ? 'No goods receipts match' : 'No goods receipts yet'}
              hint={chips.length || filters.status ? 'Try another view or clear the filters.' : 'Record a delivery against an issued purchase order.'}
              action={hasPermission('grn.create') && !chips.length && !filters.status ? <Button icon={Plus} onClick={() => navigate('/purchases/receipts/new')}>New goods receipt</Button> : undefined}
            />
          }
          onRowClick={(g) => navigate(`/purchases/receipts/${g.id}`)}
        />
      </Card>
    </>
  );
}
