import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { Card, DataTable, EmptyState, ErrorState, Input, ListToolbar, Select, StatusBadge, type Column } from '../../../components/ui';
import { useUrlFilters } from '../../../hooks/useUrlFilters';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatDateTime, formatMoney, formatQty, humanize } from '../../../lib/utils';
import { ProductPicker } from '../components/ProductPicker';
import { RefLink } from '../components/RefLink';
import { SignedQty } from '../components/SignedQty';
import { WarehousePicker } from '../components/WarehousePicker';
import { compactChips } from '../components/chips';
import { useLedger, useStockByItem, useWarehouseMaps } from '../hooks';
import { REF_TYPES, type LedgerRow } from '../types';

const DEFAULTS = { itemId: '', warehouseId: '', from: '', to: '', refType: '', limit: 200 };

/** Date-only inputs -> ISO datetimes with offset (the service's ledger query wants full timestamps). */
function dayStart(date: string) {
  return date ? new Date(`${date}T00:00:00`).toISOString() : undefined;
}
function dayEnd(date: string) {
  return date ? new Date(`${date}T23:59:59.999`).toISOString() : undefined;
}

export function LedgerPage() {
  const { warehouseIds } = useAuth();
  const { filters, setFilters, reset } = useUrlFilters(DEFAULTS);
  const maps = useWarehouseMaps();
  // Only to label an item chosen through the URL (e.g. from the stock page).
  const pickedItem = useStockByItem(filters.itemId || undefined);

  const params = useMemo(() => ({ itemId: filters.itemId, warehouseId: filters.warehouseId, from: dayStart(filters.from), to: dayEnd(filters.to), refType: filters.refType, limit: filters.limit }), [filters]);
  const query = useLedger(params);
  const rows = query.data ?? [];
  const hasFilters = Boolean(filters.itemId || filters.warehouseId || filters.from || filters.to || filters.refType);

  const columns: Column<LedgerRow>[] = [
    { key: 'createdAt', header: 'Date / time', render: (r) => <span className="tabular text-slate-700 whitespace-nowrap">{formatDateTime(r.createdAt)}</span> },
    { key: 'postingType', header: 'Posting', render: (r) => <StatusBadge status={r.postingType} dot={false} /> },
    { key: 'ref', header: 'Reference', render: (r) => <RefLink refType={r.refType} refId={r.refId} refNumber={r.refNumber} />, hideBelow: 'md' },
    {
      key: 'item',
      header: 'Item',
      render: (r) => (
        <div className="min-w-0">
          <Link to={`/inventory/stock/${r.itemId}`} className="font-medium text-slate-900 hover:text-brand-700 truncate block">{r.name}</Link>
          <p className="text-xs text-slate-500 font-mono">{r.sku}</p>
        </div>
      ),
    },
    {
      key: 'where',
      header: 'Warehouse / bin',
      render: (r) => (r.warehouseId ? <span>{maps.warehouseLabel(r.warehouseId)} <span className="text-slate-400">/</span> <span className="font-mono text-[13px]">{maps.binLabel(r.binId)}</span></span> : <span className="text-slate-400">External</span>),
      hideBelow: 'lg',
    },
    { key: 'bucket', header: 'Bucket', render: (r) => <StatusBadge status={r.bucket} dot={false} />, hideBelow: 'sm' },
    { key: 'qty', header: 'Qty', align: 'right', render: (r) => <SignedQty value={r.qty} /> },
    { key: 'unitCost', header: 'Unit cost', align: 'right', render: (r) => <span className="tabular text-slate-600">{formatMoney(r.unitCost)}</span>, hideBelow: 'xl' },
    ...(filters.itemId ? [{ key: 'running', header: 'On-hand', align: 'right' as const, render: (r: LedgerRow) => <span className="tabular font-medium">{r.runningOnHand === null ? '-' : formatQty(r.runningOnHand)}</span> }] : []),
  ];

  const chips = compactChips([
    filters.itemId ? { label: <>Item: {pickedItem.data?.item.sku ?? '...'}</>, onClear: () => setFilters({ itemId: '' }) } : null,
    filters.warehouseId ? { label: <>Warehouse: {maps.warehouseLabel(filters.warehouseId)}</>, onClear: () => setFilters({ warehouseId: '' }) } : null,
    filters.refType ? { label: <>Reference: {humanize(filters.refType)}</>, onClear: () => setFilters({ refType: '' }) } : null,
    filters.from || filters.to ? { label: <>{filters.from || 'Start'} to {filters.to || 'today'}</>, onClear: () => setFilters({ from: '', to: '' }) } : null,
  ]);

  return (
    <>
      <ListToolbar
        views={[{ value: '', label: 'Stock ledger' }]}
        view=""
        onViewChange={() => undefined}
        chips={chips}
        onClearAll={hasFilters ? reset : undefined}
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching && !query.isLoading}
      />
      <Card className="mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 px-4 py-3">
          <ProductPicker value={filters.itemId} onChange={(id) => setFilters({ itemId: id })} selectedLabel={pickedItem.data ? `${pickedItem.data.item.sku} - ${pickedItem.data.item.name}` : pickedItem.isError ? 'Unknown item' : 'Loading...'} allowClear placeholder="Any item" />
          <WarehousePicker value={filters.warehouseId} onChange={(v) => setFilters({ warehouseId: v })} allowAll={!warehouseIds || (warehouseIds?.length ?? 0) > 1} activeOnly={false} />
          <Input type="date" aria-label="From date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilters({ from: e.target.value })} />
          <Input type="date" aria-label="To date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilters({ to: e.target.value })} />
          <Select aria-label="Reference type" value={filters.refType} onChange={(e) => setFilters({ refType: e.target.value })} placeholder="Any reference" options={REF_TYPES.map((t) => ({ value: t, label: humanize(t) }))} />
        </div>
      </Card>
      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          dense
          loading={query.isLoading}
          error={query.isError ? <ErrorState message={toApiError(query.error).message} onRetry={() => void query.refetch()} /> : undefined}
          empty={<EmptyState icon={BookOpen} title={hasFilters ? 'No movements match these filters' : 'No stock movements yet'} hint={hasFilters ? undefined : 'Every posting (opening stock, receipts, QC decisions, adjustments, bin moves) shows here, newest first.'} />}
        />
        {rows.length >= filters.limit && <p className="px-4 py-2 text-xs text-slate-500 border-t border-slate-100">Showing the latest {filters.limit} movements. Add a date range or item filter to go further back.</p>}
      </Card>
    </>
  );
}
