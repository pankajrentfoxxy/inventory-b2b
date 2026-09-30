import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Package, Plus, SearchX } from 'lucide-react';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, ListToolbar, Select, StatusBadge, type Column } from '../../../components/ui';
import { useUrlFilters } from '../../../hooks/useUrlFilters';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useProducts } from '../hooks';
import type { Product } from '../types';
import { ProductFormModal } from '../components/ProductFormModal';

const DEFAULTS = { status: '', type: '', isSerialized: '', q: '' };
const VIEWS = [
  { value: '', label: 'All Products' },
  { value: 'DRAFT', label: 'Draft Products' },
  { value: 'ACTIVE', label: 'Active Products' },
  { value: 'INACTIVE', label: 'Inactive Products' },
  { value: 'ARCHIVED', label: 'Archived Products' },
];

export function ProductListPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('master.manage');
  const { filters, setFilters, reset } = useUrlFilters(DEFAULTS);
  const params = useMemo(() => ({ q: filters.q, status: filters.status, type: filters.type, isSerialized: filters.isSerialized, limit: 50 }), [filters]);
  const query = useProducts(params);
  const [searchParams, setSearchParams] = useSearchParams();
  // Quick-create ("+" in the top bar) lands here with ?new=1 and opens the form straight away.
  const [modalOpen, setModalOpen] = useState(searchParams.get('new') === '1' && canManage);

  const closeModal = () => {
    setModalOpen(false);
    if (searchParams.get('new')) {
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
  };

  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);
  const hasFilters = Boolean(filters.q || filters.status || filters.type || filters.isSerialized);

  const columns: Column<Product>[] = [
    { key: 'sku', header: 'SKU', render: (p) => <span className="font-mono text-[13px] tabular text-slate-800">{p.sku}</span> },
    {
      key: 'name',
      header: 'Name',
      render: (p) => (
        <div className="min-w-0">
          <p className="font-medium text-brand-700">{p.name}</p>
          {p.description && <p className="text-xs text-slate-500 truncate max-w-md">{p.description}</p>}
        </div>
      ),
    },
    { key: 'type', header: 'Type', hideBelow: 'md', render: (p) => <span className="text-slate-800">{p.type === 'GOODS' ? 'Goods' : 'Service'}</span> },
    { key: 'unit', header: 'Unit', hideBelow: 'lg', render: (p) => <span className="text-slate-800">{p.unitCode}</span> },
    { key: 'hsn', header: 'HSN/SAC', hideBelow: 'lg', render: (p) => <span className="font-mono text-[13px] tabular text-slate-800">{p.hsnCode ?? <span className="text-slate-300">-</span>}</span> },
    { key: 'tax', header: 'Tax', hideBelow: 'xl', align: 'right', render: (p) => <span className="tabular text-slate-800">{p.taxRate === null ? <span className="text-slate-300">-</span> : `${p.taxRate}%`}</span> },
    {
      key: 'serialized',
      header: 'Tracking',
      hideBelow: 'md',
      render: (p) => (
        <span className="flex items-center gap-1 flex-wrap">
          {p.isSerialized && <Badge tone="purple">Serialized</Badge>}
          {p.requiresImei && <Badge tone="blue">IMEI</Badge>}
          {!p.trackInventory && <Badge tone="gray">Not tracked</Badge>}
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
  ];

  const chips = [
    filters.q ? { label: <>Search: <strong>{filters.q}</strong></>, onClear: () => setFilters({ q: '' }) } : null,
    filters.type ? { label: <>Type: <strong>{filters.type === 'GOODS' ? 'Goods' : 'Services'}</strong></>, onClear: () => setFilters({ type: '' }) } : null,
    filters.isSerialized ? { label: <>{filters.isSerialized === 'true' ? 'Serialized only' : 'Non-serialized only'}</>, onClear: () => setFilters({ isSerialized: '' }) } : null,
  ].filter((c): c is { label: JSX.Element; onClear: () => void } => c !== null);

  return (
    <>
      <ListToolbar
        views={VIEWS}
        view={filters.status}
        onViewChange={(v) => setFilters({ status: v })}
        filters={
          <>
            <Select aria-label="Product type" value={filters.type} onChange={(e) => setFilters({ type: e.target.value })} placeholder="All types" options={[{ value: 'GOODS', label: 'Goods' }, { value: 'SERVICE', label: 'Services' }]} className="w-36" />
            <Select aria-label="Serialization" value={filters.isSerialized} onChange={(e) => setFilters({ isSerialized: e.target.value })} placeholder="Serialized: any" options={[{ value: 'true', label: 'Serialized only' }, { value: 'false', label: 'Non-serialized' }]} className="w-40" />
          </>
        }
        actions={
          canManage ? (
            <Button icon={Plus} onClick={() => setModalOpen(true)}>
              New
            </Button>
          ) : undefined
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
          rowKey={(r) => r.id}
          loading={query.isLoading}
          error={query.isError ? <ErrorState message={toApiError(query.error).message} onRetry={() => void query.refetch()} /> : undefined}
          empty={
            hasFilters ? (
              <EmptyState icon={SearchX} title="No products match your filters" action={<Button variant="secondary" size="sm" onClick={reset}>Clear filters</Button>} />
            ) : (
              <EmptyState icon={Package} title="No products yet" hint="Products are the goods and services you buy, stock and sell. Add your first product to start raising purchase orders." action={canManage ? <Button icon={Plus} onClick={() => setModalOpen(true)}>New Product</Button> : undefined} />
            )
          }
          onRowClick={(r) => navigate(`/masters/products/${r.id}`)}
        />
        {query.hasNextPage && (
          <div className="flex justify-center border-t border-slate-200 px-4 py-3">
            <Button variant="secondary" size="sm" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
              Load more
            </Button>
          </div>
        )}
        {!query.hasNextPage && rows.length > 0 && <p className="px-4 py-2 text-xs text-slate-500 border-t border-slate-100 tabular">{rows.length} product{rows.length === 1 ? '' : 's'}</p>}
      </Card>

      <ProductFormModal open={modalOpen} onClose={closeModal} onSaved={(p) => navigate(`/masters/products/${p.id}`)} />
    </>
  );
}
