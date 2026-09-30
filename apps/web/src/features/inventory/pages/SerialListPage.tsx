import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScanBarcode, Search } from 'lucide-react';
import { Card, DataTable, EmptyState, ErrorState, Input, ListToolbar, Select, StatusBadge, type Column } from '../../../components/ui';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useUrlFilters } from '../../../hooks/useUrlFilters';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { humanize } from '../../../lib/utils';
import { ProductPicker } from '../components/ProductPicker';
import { WarehousePicker } from '../components/WarehousePicker';
import { compactChips } from '../components/chips';
import { useProductRefs, useSerials, useStockByItem, useWarehouseMaps } from '../hooks';
import { BUCKETS, type SerialUnit } from '../types';

const DEFAULTS = { q: '', itemId: '', bucket: '', warehouseId: '', limit: 100 };

export function SerialListPage() {
  const navigate = useNavigate();
  const { warehouseIds } = useAuth();
  const { filters, setFilters, reset } = useUrlFilters(DEFAULTS);
  const [term, setTerm] = useState(filters.q);
  const debounced = useDebouncedValue(term, 300);
  const maps = useWarehouseMaps();
  const pickedItem = useStockByItem(filters.itemId || undefined);

  const params = useMemo(() => ({ q: debounced, itemId: filters.itemId, bucket: filters.bucket, warehouseId: filters.warehouseId, limit: filters.limit }), [debounced, filters]);
  const query = useSerials(params);
  const rows = query.data ?? [];
  const items = useProductRefs(rows.map((r) => r.itemId));
  const hasFilters = Boolean(filters.q || filters.itemId || filters.bucket || filters.warehouseId);

  const columns: Column<SerialUnit>[] = [
    {
      key: 'serial',
      header: 'Serial',
      render: (r) => (
        <div>
          <p className="font-mono text-[13px] font-medium text-slate-900">{r.serialNo}</p>
          {r.imei && <p className="text-xs text-slate-500 font-mono">IMEI {r.imei}</p>}
        </div>
      ),
    },
    { key: 'item', header: 'Item', render: (r) => <span className="text-slate-800">{items.label(r.itemId)}</span> },
    { key: 'bucket', header: 'Bucket', render: (r) => <StatusBadge status={r.bucket} /> },
    { key: 'warehouse', header: 'Warehouse', render: (r) => (r.warehouseId ? maps.warehouseLabel(r.warehouseId) : <span className="text-slate-400">-</span>), hideBelow: 'md' },
    { key: 'bin', header: 'Bin', render: (r) => <span className="font-mono text-[13px]">{r.warehouseId ? maps.binLabel(r.binId) : '-'}</span>, hideBelow: 'lg' },
    { key: 'grade', header: 'Grade', render: (r) => r.gradeCode ?? <span className="text-slate-400">-</span>, hideBelow: 'lg' },
    { key: 'qc', header: 'QC', render: (r) => (r.qcStatus ? <StatusBadge status={r.qcStatus} dot={false} /> : <span className="text-slate-400">-</span>), hideBelow: 'sm' },
  ];

  const chips = compactChips([
    filters.itemId ? { label: <>Item: {pickedItem.data?.item.sku ?? '...'}</>, onClear: () => setFilters({ itemId: '' }) } : null,
    filters.bucket ? { label: <>Bucket: {humanize(filters.bucket)}</>, onClear: () => setFilters({ bucket: '' }) } : null,
    filters.warehouseId ? { label: <>Warehouse: {maps.warehouseLabel(filters.warehouseId)}</>, onClear: () => setFilters({ warehouseId: '' }) } : null,
  ]);

  return (
    <>
      <ListToolbar
        views={[{ value: '', label: 'Serial numbers' }]}
        view=""
        onViewChange={() => undefined}
        chips={chips}
        onClearAll={hasFilters ? () => { setTerm(''); reset(); } : undefined}
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching && !query.isLoading}
      />
      <Card className="mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 px-4 py-3">
          <Input
            prefix={<Search className="w-4 h-4" />}
            aria-label="Search serial or IMEI"
            placeholder="Serial number or IMEI"
            sanitize="singleLine"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setFilters({ q: e.target.value });
            }}
            className="font-mono"
          />
          <ProductPicker value={filters.itemId} onChange={(id) => setFilters({ itemId: id })} selectedLabel={pickedItem.data ? `${pickedItem.data.item.sku} - ${pickedItem.data.item.name}` : pickedItem.isError ? 'Unknown item' : 'Loading...'} allowClear placeholder="Any item" />
          <Select aria-label="Bucket" value={filters.bucket} onChange={(e) => setFilters({ bucket: e.target.value })} placeholder="Any bucket" options={BUCKETS.map((b) => ({ value: b, label: humanize(b) }))} />
          <WarehousePicker value={filters.warehouseId} onChange={(v) => setFilters({ warehouseId: v })} allowAll={!warehouseIds || (warehouseIds?.length ?? 0) > 1} activeOnly={false} />
        </div>
      </Card>
      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={query.isLoading}
          error={query.isError ? <ErrorState message={toApiError(query.error).message} onRetry={() => void query.refetch()} /> : undefined}
          empty={<EmptyState icon={ScanBarcode} title={hasFilters ? 'No serial numbers match' : 'No serial numbers yet'} hint={hasFilters ? 'Try a different serial, IMEI or filter.' : 'Serial units appear once a serialized item is received or recorded as opening stock.'} />}
          onRowClick={(r) => navigate(`/inventory/serials/${r.id}`)}
        />
        {rows.length >= filters.limit && <p className="px-4 py-2 text-xs text-slate-500 border-t border-slate-100">Showing the {filters.limit} most recently updated units. Refine the search to see others.</p>}
      </Card>
    </>
  );
}
