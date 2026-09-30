import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClipboardCheck } from 'lucide-react';
import { Card, DataTable, EmptyState, ErrorState, ListToolbar, StatusBadge, type Column } from '../../../components/ui';
import { useUrlFilters } from '../../../hooks/useUrlFilters';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { cn, formatDateTime, formatQty, humanize } from '../../../lib/utils';
import { LaptopSpecsView } from '../../../components/LaptopSpecs';
import { WarehouseSelect } from '../../procurement/components/pickers';
import { useScopedWarehouses } from '../../procurement/hooks';
import { useQcLots } from '../hooks';
import type { QcLot, QcLotListParams, QcLotStatus } from '../types';

const DEFAULTS = { status: 'OPEN', warehouseId: '', sourceId: '', mine: '', q: '' };

const VIEWS = [
  { value: 'OPEN', label: 'Open lots' },
  { value: 'IN_INSPECTION', label: 'In inspection' },
  { value: 'DECIDED', label: 'Decided' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'ALL', label: 'All lots' },
];

function sourceLink(lot: QcLot) {
  if (lot.sourceType === 'GRN') return `/purchases/receipts/${lot.sourceId}`;
  return null;
}

/** Inspector work queue. */
export function QcLotListPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { filters, setFilters, reset } = useUrlFilters(DEFAULTS);
  const { byId } = useScopedWarehouses();
  const params = useMemo<QcLotListParams>(() => ({ status: filters.status === 'ALL' ? undefined : (filters.status as QcLotStatus), warehouseId: filters.warehouseId || undefined, sourceId: filters.sourceId || undefined, mine: filters.mine === '1' ? 'true' : undefined, q: filters.q || undefined, limit: 100 }), [filters]);
  const query = useQcLots(params);
  const rows = query.data ?? [];
  const me = session?.user.id;

  const columns: Column<QcLot>[] = [
    { key: 'number', header: 'Lot', render: (l) => <span className="font-mono text-[13px] font-medium text-slate-900">{l.number}</span> },
    {
      key: 'source',
      header: 'Source GRN',
      render: (l) => {
        const to = sourceLink(l);
        const label = l.sourceNumber ?? humanize(l.sourceType);
        return to ? (
          <Link to={to} onClick={(e) => e.stopPropagation()} className="text-brand-700 hover:underline font-mono text-[13px]">
            {label}
          </Link>
        ) : (
          <span className="text-xs">{label}</span>
        );
      },
    },
    {
      key: 'item',
      header: 'Laptop (SKU)',
      render: (l) => (
        <div className="min-w-0 max-w-[340px]">
          <p className="font-mono text-[13px] font-medium text-slate-900">{l.item.sku}</p>
          <p className="text-xs text-slate-700 truncate">{l.item.name}</p>
          <LaptopSpecsView specs={l.expectedSpecs ?? l.item.specs} variant="inline" />
        </div>
      ),
    },
    { key: 'warehouse', header: 'Warehouse', hideBelow: 'md', render: (l) => byId(l.warehouseId)?.code ?? <span className="font-mono text-xs text-slate-500">{l.warehouseId.slice(0, 8)}</span> },
    { key: 'mode', header: 'Mode', hideBelow: 'lg', render: (l) => <span className="text-xs">{l.mode === 'SERIAL' ? 'Serial' : 'Quantity'}</span> },
    { key: 'qty', header: 'Qty', align: 'right', render: (l) => <span className="tabular">{formatQty(l.qty)}</span> },
    {
      key: 'progress',
      header: 'Progress',
      hideBelow: 'md',
      render: (l) =>
        l.status === 'DECIDED' || l.status === 'CLOSED' ? (
          <span className="text-xs tabular">
            <span className="text-emerald-700">{formatQty(l.passQty)} pass</span> / <span className={l.failQty > 0 ? 'text-red-700' : 'text-slate-500'}>{formatQty(l.failQty)} fail</span>
          </span>
        ) : l.progress ? (
          <span className="text-xs tabular block">
            <span className={cn(l.progress.inspected === l.progress.total ? 'text-emerald-700' : 'text-slate-700')}>
              {l.progress.inspected}/{l.progress.total} inspected
            </span>
            {l.progress.inspected > 0 && (
              <span className="block">
                <span className="text-emerald-700">{l.progress.passed ?? 0} passed</span> / <span className={(l.progress.failed ?? 0) > 0 ? 'text-red-700' : 'text-slate-500'}>{l.progress.failed ?? 0} failed</span> / <span className={(l.progress.onHold ?? 0) > 0 ? 'text-amber-700' : 'text-slate-500'}>{l.progress.onHold ?? 0} on hold</span>
                <span className="text-slate-500"> of {l.progress.total}</span>
              </span>
            )}
          </span>
        ) : (
          <span className="text-xs text-slate-400">-</span>
        ),
    },
    { key: 'status', header: 'Status', render: (l) => <StatusBadge status={l.status} /> },
    { key: 'inspector', header: 'Inspector', hideBelow: 'lg', render: (l) => (l.inspectorId ? l.inspectorId === me ? <span className="text-brand-700 font-medium">You</span> : <span className="font-mono text-xs text-slate-500">{l.inspectorId.slice(0, 8)}</span> : <span className="text-slate-400">-</span>) },
    { key: 'created', header: 'Created', hideBelow: 'xl', render: (l) => <span className="tabular text-xs text-slate-600">{formatDateTime(l.createdAt)}</span> },
  ];

  const chips = [
    ...(filters.q ? [{ label: `Search: ${filters.q}`, onClear: () => setFilters({ q: '' }) }] : []),
    ...(filters.mine === '1' ? [{ label: 'Assigned to me', onClear: () => setFilters({ mine: '' }) }] : []),
    ...(filters.warehouseId ? [{ label: `Warehouse: ${byId(filters.warehouseId)?.code ?? 'selected'}`, onClear: () => setFilters({ warehouseId: '' }) }] : []),
    ...(filters.sourceId ? [{ label: `Source: ${rows[0]?.sourceNumber ?? filters.sourceId.slice(0, 8)}`, onClear: () => setFilters({ sourceId: '' }) }] : []),
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
          <>
            <button type="button" onClick={() => setFilters({ mine: filters.mine === '1' ? '' : '1' })} aria-pressed={filters.mine === '1'} className={cn('h-9 px-3 rounded-lg border text-sm font-medium transition-colors', filters.mine === '1' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50')}>
              Mine
            </button>
            <div className="w-48 sm:w-60">
              <WarehouseSelect value={filters.warehouseId} onChange={(id) => setFilters({ warehouseId: id })} placeholder="All warehouses" includeInactive />
            </div>
          </>
        }
      />
      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(l) => l.id}
          loading={query.isLoading}
          error={query.isError ? <ErrorState message={toApiError(query.error).message} onRetry={() => void query.refetch()} /> : undefined}
          empty={<EmptyState icon={ClipboardCheck} title={filters.status === 'OPEN' && !chips.length ? 'No laptops waiting for QC' : 'No lots match'} hint={filters.status === 'OPEN' && !chips.length ? 'A QC lot is created automatically for every laptop line when a goods receipt is posted.' : 'Try another view or clear the filters.'} />}
          onRowClick={(l) => navigate(`/qc/lots/${l.id}`)}
        />
      </Card>
    </>
  );
}
