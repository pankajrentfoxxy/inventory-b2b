import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Plus, Search } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, ErrorState, Input, ListToolbar, StatusBadge, type Column } from '../../../components/ui';
import { useUrlFilters } from '../../../hooks/useUrlFilters';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatDate, humanize } from '../../../lib/utils';
import { useDashboard, useTenants } from '../hooks';
import { TENANT_STATUSES, type Tenant, type TenantListQuery, type TenantStatus } from '../types';

const DEFAULTS = { status: '', q: '' };

export function TenantListPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const { filters, setFilters, reset } = useUrlFilters(DEFAULTS);
  const counts = useDashboard().data?.counts;

  // Local search box; the URL (and the query) follow after a debounce.
  const [term, setTerm] = useState(filters.q);
  const debounced = useDebouncedValue(term, 350);
  useEffect(() => {
    if (debounced !== filters.q) setFilters({ q: debounced });
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setTerm(filters.q);
  }, [filters.q]);

  const params = useMemo<TenantListQuery>(() => ({ limit: 50, ...(filters.status ? { status: filters.status as TenantStatus } : {}), ...(filters.q ? { q: filters.q } : {}) }), [filters]);
  const query = useTenants(params);
  const rows = (query.data?.pages ?? []).flatMap((p) => p.data);
  const error = query.isError ? toApiError(query.error).message : null;
  const canCreate = hasPermission('platform.tenant.create');

  const views = [{ value: '', label: 'All tenants', count: counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined }, ...TENANT_STATUSES.map((s) => ({ value: s, label: humanize(s), count: counts?.[s] }))];

  const columns: Column<Tenant>[] = [
    { key: 'code', header: 'Code', width: '9rem', render: (t) => <span className="font-mono text-[13px] text-slate-700">{t.code}</span> },
    {
      key: 'name',
      header: 'Tenant',
      render: (t) => (
        <div className="min-w-0">
          <p className="font-medium text-slate-900 truncate">{t.displayName}</p>
          {t.legalName !== t.displayName && <p className="text-xs text-slate-500 truncate">{t.legalName}</p>}
        </div>
      ),
    },
    { key: 'gstin', header: 'GSTIN', hideBelow: 'lg', render: (t) => <span className="font-mono text-[13px]">{t.gstin ?? <span className="text-slate-400">-</span>}</span> },
    {
      key: 'owner',
      header: 'Owner',
      hideBelow: 'md',
      render: (t) => (
        <div className="min-w-0">
          <p className="text-slate-800 truncate">{t.ownerName}</p>
          <p className="text-xs text-slate-500 truncate">{t.ownerEmail}</p>
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (t) => <StatusBadge status={t.status} /> },
    { key: 'source', header: 'Source', hideBelow: 'xl', render: (t) => <span className="text-xs text-slate-500">{humanize(t.source)}</span> },
    { key: 'created', header: 'Created', hideBelow: 'md', align: 'right', render: (t) => <span className="text-xs text-slate-600 tabular">{formatDate(t.createdAt)}</span> },
  ];

  const chips = [
    ...(filters.status ? [{ label: `Status: ${humanize(filters.status)}`, onClear: () => setFilters({ status: '' }) }] : []),
    ...(filters.q ? [{ label: `Search: ${filters.q}`, onClear: () => setFilters({ q: '' }) }] : []),
  ];

  return (
    <>
      <ListToolbar
        views={views}
        view={filters.status}
        onViewChange={(v) => setFilters({ status: v })}
        filters={
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input aria-label="Search tenants" placeholder="Search name, code, GSTIN, owner email" value={term} onChange={(e) => setTerm(e.target.value)} className="pl-9 w-72" />
          </div>
        }
        actions={canCreate ? <Button icon={Plus} onClick={() => navigate('/admin/tenants/new')}>New tenant</Button> : undefined}
        chips={chips}
        onClearAll={chips.length > 1 ? reset : undefined}
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching && !query.isLoading}
      />
      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(t) => t.id}
          loading={query.isLoading}
          error={error ? <ErrorState message={error} onRetry={() => void query.refetch()} /> : undefined}
          empty={
            <EmptyState
              icon={Building2}
              title={chips.length ? 'No tenants match' : 'No tenants yet'}
              hint={chips.length ? 'Try a different status or search.' : 'Create the first tenant or wait for an application.'}
              action={chips.length ? <Button variant="secondary" onClick={reset}>Clear filters</Button> : canCreate ? <Button icon={Plus} onClick={() => navigate('/admin/tenants/new')}>New tenant</Button> : undefined}
            />
          }
          onRowClick={(t) => navigate(`/admin/tenants/${t.id}`)}
        />
        {rows.length > 0 && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 text-xs text-slate-500">
            <span className="tabular">{rows.length} loaded</span>
            {query.hasNextPage ? (
              <Button variant="secondary" size="sm" onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage}>
                Load more
              </Button>
            ) : (
              <span>End of list</span>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
