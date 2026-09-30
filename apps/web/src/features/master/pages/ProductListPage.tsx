import { useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Laptop, Plus, SearchX } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, ErrorState, ListToolbar, Select, StatusBadge, type Column } from '../../../components/ui';
import { LaptopSpecsView } from '../../../components/LaptopSpecs';
import { useUrlFilters } from '../../../hooks/useUrlFilters';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatMoney } from '../../../lib/utils';
import { useLaptopSpecs, useProducts } from '../hooks';
import type { Product, SpecKind, SpecOption } from '../types';

const DEFAULTS = { status: '', q: '', brandId: '', modelId: '', processorId: '', ramId: '', ssdId: '', generationId: '' };
type FilterKey = 'brandId' | 'modelId' | 'generationId' | 'processorId' | 'ramId' | 'ssdId';
const FILTERS: { key: FilterKey; kind: SpecKind; label: string; width: string }[] = [
  { key: 'brandId', kind: 'BRAND', label: 'Brand', width: 'w-36' },
  { key: 'modelId', kind: 'MODEL', label: 'Model', width: 'w-44' },
  { key: 'generationId', kind: 'GENERATION', label: 'Generation', width: 'w-36' },
  { key: 'processorId', kind: 'PROCESSOR', label: 'Processor', width: 'w-44' },
  { key: 'ramId', kind: 'RAM', label: 'RAM', width: 'w-28' },
  { key: 'ssdId', kind: 'SSD', label: 'SSD', width: 'w-28' },
];
const VIEWS = [
  { value: '', label: 'All configurations' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'ARCHIVED', label: 'Archived' },
];

const dash = <span className="text-slate-300">-</span>;
const cell = (v: string | null | undefined) => (v ? <span className="text-slate-800 whitespace-nowrap">{v}</span> : dash);

/** Laptop configurations (the product master is laptop-only). */
export function ProductListPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('master.manage');
  const [searchParams] = useSearchParams();
  const { filters, setFilters, reset } = useUrlFilters(DEFAULTS);

  // Quick-create ("+" in the top bar) lands here with ?new=1.
  useEffect(() => {
    if (searchParams.get('new') === '1') navigate(canManage ? '/masters/products/new' : '/masters/products', { replace: true });
  }, [searchParams, canManage, navigate]);

  const specs = useLaptopSpecs({ includeInactive: true });
  const byKind = useMemo(() => {
    const map = new Map<SpecKind, SpecOption[]>();
    for (const o of specs.data ?? []) map.set(o.kind, [...(map.get(o.kind) ?? []), o]);
    return map;
  }, [specs.data]);
  const nameOf = (id: string) => specs.data?.find((o) => o.id === id)?.name ?? '...';

  const params = useMemo(
    () => ({ laptop: 'true' as const, q: filters.q, status: filters.status, brandId: filters.brandId, modelId: filters.modelId, generationId: filters.generationId, processorId: filters.processorId, ramId: filters.ramId, ssdId: filters.ssdId, limit: 50 }),
    [filters],
  );
  const query = useProducts(params);
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);
  const hasFilters = Boolean(filters.q || filters.status || FILTERS.some((f) => filters[f.key]));

  const columns: Column<Product>[] = [
    { key: 'sku', header: 'SKU', render: (p) => <span className="font-mono text-[13px] tabular text-slate-800 whitespace-nowrap">{p.sku}</span> },
    {
      key: 'name',
      header: 'Configuration',
      render: (p) => (
        <div className="min-w-0 max-w-md">
          <p className="font-medium text-brand-700">{p.name}</p>
          {p.specs ? <LaptopSpecsView specs={p.specs} variant="inline" /> : <span className="text-xs text-slate-400">Generic product (no specifications)</span>}
        </div>
      ),
    },
    { key: 'generation', header: 'Generation', hideBelow: 'xl', render: (p) => cell(p.specs?.generation) },
    { key: 'processor', header: 'Processor', hideBelow: 'lg', render: (p) => cell(p.specs?.processor) },
    { key: 'ram', header: 'RAM', hideBelow: 'md', render: (p) => cell(p.specs?.ram) },
    { key: 'ssd', header: 'SSD', hideBelow: 'md', render: (p) => cell(p.specs?.ssd) },
    { key: 'screen', header: 'Screen', hideBelow: 'xl', render: (p) => cell(p.specs?.screenSize) },
    { key: 'price', header: 'Purchase price', hideBelow: 'lg', align: 'right', render: (p) => <span className="tabular text-slate-800 whitespace-nowrap">{p.purchasePrice === null ? dash : formatMoney(p.purchasePrice)}</span> },
    { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
  ];

  const modelOptions = (byKind.get('MODEL') ?? []).filter((m) => !filters.brandId || m.brandId === filters.brandId);
  const chips = [
    filters.q ? { label: <>Search: <strong>{filters.q}</strong></>, onClear: () => setFilters({ q: '' }) } : null,
    ...FILTERS.map((f) => (filters[f.key] ? { label: <>{f.label}: <strong>{nameOf(filters[f.key])}</strong></>, onClear: () => setFilters({ [f.key]: '' } as Partial<typeof DEFAULTS>) } : null)),
  ].filter((c): c is { label: JSX.Element; onClear: () => void } => c !== null);

  const newButton = canManage ? (
    <Button icon={Plus} onClick={() => navigate('/masters/products/new')}>
      New configuration
    </Button>
  ) : undefined;

  return (
    <>
      <ListToolbar
        views={VIEWS}
        view={filters.status}
        onViewChange={(v) => setFilters({ status: v })}
        filters={
          <>
            {FILTERS.map((f) => (
              <Select
                key={f.key}
                aria-label={f.label}
                value={filters[f.key]}
                onChange={(e) => setFilters(f.key === 'brandId' ? { brandId: e.target.value, modelId: '' } : ({ [f.key]: e.target.value } as Partial<typeof DEFAULTS>))}
                placeholder={`${f.label}: any`}
                options={(f.kind === 'MODEL' ? modelOptions : byKind.get(f.kind) ?? []).map((o) => ({ value: o.id, label: o.status === 'ACTIVE' ? o.name : `${o.name} (inactive)` }))}
                className={f.width}
              />
            ))}
          </>
        }
        actions={newButton}
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
              <EmptyState icon={SearchX} title="No configurations match your filters" action={<Button variant="secondary" size="sm" onClick={reset}>Clear filters</Button>} />
            ) : (
              <EmptyState
                icon={Laptop}
                title="No laptop configurations yet"
                hint="A configuration is one purchasable variant: brand, model, generation, processor, RAM, SSD, graphics and screen size. Create one to start raising purchase orders."
                action={newButton}
              />
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
        {!query.hasNextPage && rows.length > 0 && <p className="px-4 py-2 text-xs text-slate-500 border-t border-slate-100 tabular">{rows.length} configuration{rows.length === 1 ? '' : 's'}</p>}
      </Card>
    </>
  );
}
