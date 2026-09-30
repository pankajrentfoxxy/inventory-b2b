import { useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Boxes } from 'lucide-react';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, ListToolbar, Select, type Column } from '../../../components/ui';
import { useUrlFilters } from '../../../hooks/useUrlFilters';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatMoney, formatQty, humanize } from '../../../lib/utils';
import { LaptopSpecsView } from '../../../components/LaptopSpecs';
import { WarehousePicker } from '../components/WarehousePicker';
import { compactChips } from '../components/chips';
import { useScopedWarehouses, useStock } from '../hooks';
import { WAREHOUSE_BUCKETS, type StockRow } from '../types';

const DEFAULTS = { warehouseId: '', bucket: '', q: '', limit: 200 };

export function StockListPage() {
  const navigate = useNavigate();
  const { hasPermission, warehouseIds } = useAuth();
  const { filters, setFilters, reset } = useUrlFilters(DEFAULTS);
  const scoped = useScopedWarehouses({ activeOnly: false });

  // Members with a warehouse scope start on their first warehouse; unscoped members see everything.
  useEffect(() => {
    if (warehouseIds && !filters.warehouseId && scoped.defaultId) setFilters({ warehouseId: scoped.defaultId });
  }, [warehouseIds, filters.warehouseId, scoped.defaultId, setFilters]);

  const params = useMemo(() => ({ warehouseId: filters.warehouseId, bucket: filters.bucket, q: filters.q, limit: filters.limit }), [filters]);
  const query = useStock(params, !warehouseIds || Boolean(filters.warehouseId) || scoped.isFetched);
  const rows = query.data ?? [];
  const hasFilters = Boolean(filters.q || filters.bucket || (filters.warehouseId && !warehouseIds));

  const columns: Column<StockRow>[] = [
    {
      key: 'item',
      header: 'Laptop (SKU)',
      render: (r) => (
        <div className="min-w-0 max-w-[320px]">
          <p className="font-mono text-[13px] font-semibold text-slate-900 flex items-center gap-2">
            <span className="truncate">{r.sku}</span>
            {r.isSerialized && <Badge tone="purple">Serialized</Badge>}
          </p>
          <p className="text-xs text-slate-700 truncate">{r.name}</p>
          <LaptopSpecsView specs={r.specs} variant="inline" className="xl:hidden" />
        </div>
      ),
    },
    { key: 'processor', header: 'Processor', hideBelow: 'xl', render: (r) => <span className="text-xs text-slate-700">{r.specs?.processor ?? <span className="text-slate-300">-</span>}</span> },
    { key: 'ram', header: 'RAM', hideBelow: 'xl', render: (r) => <span className="text-xs text-slate-700 whitespace-nowrap">{r.specs?.ram ?? <span className="text-slate-300">-</span>}</span> },
    { key: 'ssd', header: 'SSD', hideBelow: 'xl', render: (r) => <span className="text-xs text-slate-700 whitespace-nowrap">{r.specs?.ssd ?? <span className="text-slate-300">-</span>}</span> },
    { key: 'warehouse', header: 'Warehouse', render: (r) => <span title={r.warehouseName}>{r.warehouseCode}</span>, hideBelow: 'sm' },
    { key: 'qcHold', header: 'QC Hold', align: 'right', render: (r) => <span className="tabular text-amber-700">{formatQty(r.qcHold)}</span>, hideBelow: 'md' },
    { key: 'available', header: 'Available', align: 'right', render: (r) => <span className="tabular font-medium text-emerald-700">{formatQty(r.available)}</span> },
    { key: 'reserved', header: 'Reserved', align: 'right', render: (r) => <span className="tabular">{formatQty(r.reserved)}</span>, hideBelow: 'md' },
    { key: 'rejected', header: 'Rejected', align: 'right', render: (r) => <span className="tabular text-red-600">{formatQty(r.rejected)}</span>, hideBelow: 'lg' },
    { key: 'inTransit', header: 'In Transit', align: 'right', render: (r) => <span className="tabular">{formatQty(r.inTransit)}</span>, hideBelow: 'lg' },
    { key: 'onHand', header: 'On-hand', align: 'right', render: (r) => <span className="tabular font-semibold">{formatQty(r.onHand)} <span className="text-xs text-slate-400 font-normal">{r.unitCode}</span></span> },
    { key: 'avgCost', header: 'Avg cost', align: 'right', render: (r) => <span className="tabular text-slate-600">{formatMoney(r.avgCost)}</span>, hideBelow: 'xl' },
  ];

  const chips = compactChips([
    filters.q ? { label: <>Search: {filters.q}</>, onClear: () => setFilters({ q: '' }) } : null,
    filters.bucket ? { label: <>Bucket: {humanize(filters.bucket)}</>, onClear: () => setFilters({ bucket: '' }) } : null,
    filters.warehouseId && !warehouseIds ? { label: <>Warehouse: {scoped.warehouses.find((w) => w.id === filters.warehouseId)?.code ?? '...'}</>, onClear: () => setFilters({ warehouseId: '' }) } : null,
  ]);

  const empty = hasFilters ? (
    <EmptyState icon={Boxes} title="No stock matches these filters" action={<Button variant="secondary" size="sm" onClick={reset}>Clear filters</Button>} />
  ) : (
    <EmptyState
      icon={Boxes}
      title="No stock yet"
      hint="Receive a purchase order (laptops go to QC hold, then Available once QC passes) or record opening stock."
      action={
        <div className="flex flex-wrap gap-2 justify-center">
          {hasPermission('inventory.adjust') && <Button size="sm" onClick={() => navigate('/inventory/opening-stock')}>Record opening stock</Button>}
          {hasPermission(['grn.create', 'purchase_receive.create']) && <Button size="sm" variant="secondary" onClick={() => navigate('/purchases/receipts/new')}>Receive a purchase order</Button>}
        </div>
      }
    />
  );

  return (
    <>
      <ListToolbar
        views={[{ value: '', label: 'Stock on hand' }]}
        view=""
        onViewChange={() => undefined}
        filters={
          <>
            <WarehousePicker value={filters.warehouseId} onChange={(v) => setFilters({ warehouseId: v })} allowAll={!warehouseIds} activeOnly={false} className="w-56" />
            <Select value={filters.bucket} onChange={(e) => setFilters({ bucket: e.target.value })} placeholder="Any bucket" options={WAREHOUSE_BUCKETS.map((b) => ({ value: b, label: humanize(b) }))} className="w-40" />
          </>
        }
        actions={
          <>
            <Link to="/inventory/ledger" className="text-sm text-brand-700 hover:underline">Ledger</Link>
            {hasPermission('inventory.adjust') && <Button size="sm" variant="secondary" onClick={() => navigate('/inventory/adjustments/new')}>New adjustment</Button>}
          </>
        }
        chips={chips}
        onClearAll={hasFilters ? reset : undefined}
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching && !query.isLoading}
      />
      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => `${r.itemId}:${r.warehouseId}`}
          loading={query.isLoading || (Boolean(warehouseIds) && scoped.isLoading)}
          error={query.isError ? <ErrorState message={toApiError(query.error).message} onRetry={() => void query.refetch()} /> : undefined}
          empty={empty}
          onRowClick={(r) => navigate(`/inventory/stock/${r.itemId}`)}
        />
        {rows.length >= filters.limit && <p className="px-4 py-2 text-xs text-slate-500 border-t border-slate-100">Showing the first {filters.limit} rows. Narrow the search to see the rest.</p>}
      </Card>
    </>
  );
}
