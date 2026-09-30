import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Plus } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, ErrorState, ListToolbar, StatusBadge, type Column } from '../../../components/ui';
import { useUrlFilters } from '../../../hooks/useUrlFilters';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatDateTime, formatMoney, humanize } from '../../../lib/utils';
import { WarehousePicker } from '../components/WarehousePicker';
import { compactChips } from '../components/chips';
import { useAdjustments, useWarehouseMaps } from '../hooks';
import type { Adjustment } from '../types';

const DEFAULTS = { status: '', warehouseId: '', limit: 100 };
const VIEWS = [
  { value: '', label: 'All adjustments' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING_APPROVAL', label: 'Pending approval' },
  { value: 'POSTED', label: 'Posted' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export function AdjustmentListPage() {
  const navigate = useNavigate();
  const { hasPermission, warehouseIds } = useAuth();
  const { filters, setFilters, reset } = useUrlFilters(DEFAULTS);
  const maps = useWarehouseMaps();
  const params = useMemo(() => ({ status: filters.status, warehouseId: filters.warehouseId, limit: filters.limit }), [filters]);
  const query = useAdjustments(params);
  const rows = query.data ?? [];
  const canCreate = hasPermission('inventory.adjust');

  const columns: Column<Adjustment>[] = [
    { key: 'number', header: 'Number', render: (r) => <span className="font-mono text-[13px] font-medium text-slate-900">{r.number}</span> },
    { key: 'warehouse', header: 'Warehouse', render: (r) => maps.warehouseLabel(r.warehouseId), hideBelow: 'sm' },
    { key: 'reason', header: 'Reason', render: (r) => humanize(r.reasonCode), hideBelow: 'md' },
    { key: 'lines', header: 'Lines', align: 'right', render: (r) => <span className="tabular">{r.lines.length}</span>, hideBelow: 'lg' },
    { key: 'totalValue', header: 'Value', align: 'right', render: (r) => <span className="tabular">{r.status === 'DRAFT' ? <span className="text-slate-400">-</span> : formatMoney(r.totalValue)}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'createdAt', header: 'Created', render: (r) => <span className="text-slate-600 whitespace-nowrap">{formatDateTime(r.createdAt)}</span>, hideBelow: 'md' },
  ];

  const chips = compactChips([filters.warehouseId ? { label: <>Warehouse: {maps.warehouseLabel(filters.warehouseId)}</>, onClear: () => setFilters({ warehouseId: '' }) } : null]);
  const hasFilters = Boolean(filters.status || filters.warehouseId);

  return (
    <>
      <ListToolbar
        views={VIEWS}
        view={filters.status}
        onViewChange={(v) => setFilters({ status: v })}
        filters={<WarehousePicker value={filters.warehouseId} onChange={(v) => setFilters({ warehouseId: v })} allowAll={!warehouseIds || (warehouseIds?.length ?? 0) > 1} activeOnly={false} className="w-56" />}
        actions={canCreate ? <Button size="sm" icon={Plus} onClick={() => navigate('/inventory/adjustments/new')}>New adjustment</Button> : undefined}
        chips={chips}
        onClearAll={hasFilters ? reset : undefined}
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching && !query.isLoading}
      />
      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={query.isLoading}
          error={query.isError ? <ErrorState message={toApiError(query.error).message} onRetry={() => void query.refetch()} /> : undefined}
          empty={
            <EmptyState
              icon={ClipboardList}
              title={hasFilters ? 'No adjustments match' : 'No stock adjustments yet'}
              hint={hasFilters ? undefined : 'Adjustments correct counts, write off damage or loss, or record found stock. Large ones need approval.'}
              action={!hasFilters && canCreate ? <Button size="sm" icon={Plus} onClick={() => navigate('/inventory/adjustments/new')}>New adjustment</Button> : undefined}
            />
          }
          onRowClick={(r) => navigate(`/inventory/adjustments/${r.id}`)}
        />
      </Card>
    </>
  );
}
