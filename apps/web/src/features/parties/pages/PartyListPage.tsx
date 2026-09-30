import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, SearchX, Users } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, ErrorState, ListToolbar, Select, StatusBadge, type Column } from '../../../components/ui';
import { useUrlFilters } from '../../../hooks/useUrlFilters';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useParties } from '../hooks';
import { GST_TREATMENTS, GST_TREATMENT_LABELS, PARTY_META, type Party, type PartyType } from '../types';
import { stateName } from '../components/partyForm.model';

const DEFAULTS = { status: '', gstTreatment: '', q: '' };

export function PartyListPage({ type }: { type: PartyType }) {
  const meta = PARTY_META[type];
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canManage = hasPermission(meta.manage);
  const { filters, setFilters, reset } = useUrlFilters(DEFAULTS);
  const params = useMemo(() => ({ q: filters.q, status: filters.status, gstTreatment: filters.gstTreatment, limit: 50 }), [filters]);
  const query = useParties(type, params);
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);
  const hasFilters = Boolean(filters.q || filters.status || filters.gstTreatment);
  const base = `/parties/${meta.path}`;

  const views = [
    { value: '', label: `All ${meta.plural}` },
    { value: 'ACTIVE', label: `Active ${meta.plural}` },
    { value: 'INACTIVE', label: `Inactive ${meta.plural}` },
    { value: 'BLOCKED', label: `Blocked ${meta.plural}` },
  ];

  const columns: Column<Party>[] = [
    { key: 'code', header: 'Code', width: '120px', render: (p) => <span className="font-mono text-[13px] text-slate-800">{p.code}</span> },
    {
      key: 'displayName',
      header: 'Display name',
      render: (p) => (
        <div className="min-w-0">
          <p className="font-medium text-brand-700">{p.displayName}</p>
          <p className="text-xs text-slate-500 truncate md:hidden">{p.legalName}</p>
        </div>
      ),
    },
    { key: 'legalName', header: 'Legal name', hideBelow: 'md', render: (p) => <span className="text-slate-800">{p.legalName}</span> },
    { key: 'gstin', header: 'GSTIN', hideBelow: 'lg', render: (p) => (p.gstin ? <span className="font-mono text-[13px] text-slate-800">{p.gstin}</span> : <span className="text-xs text-slate-500">{GST_TREATMENT_LABELS[p.gstTreatment]}</span>) },
    { key: 'state', header: 'State', hideBelow: 'lg', render: (p) => <span className="text-slate-800">{stateName(p.stateCode) ?? p.stateCode ?? <span className="text-slate-300">-</span>}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (p) => (
        <div className="min-w-0">
          <StatusBadge status={p.status} />
          {p.status === 'BLOCKED' && p.blockedReason && <p className="text-xs text-red-700 mt-1 truncate max-w-xs" title={p.blockedReason}>{p.blockedReason}</p>}
        </div>
      ),
    },
  ];

  return (
    <>
      <ListToolbar
        views={views}
        view={filters.status}
        onViewChange={(v) => setFilters({ status: v })}
        filters={<Select aria-label="GST treatment" value={filters.gstTreatment} onChange={(e) => setFilters({ gstTreatment: e.target.value })} placeholder="All GST treatments" options={GST_TREATMENTS.map((t) => ({ value: t, label: GST_TREATMENT_LABELS[t] }))} className="w-56" />}
        actions={
          canManage ? (
            <Button icon={Plus} onClick={() => navigate(`${base}/new`)}>
              New
            </Button>
          ) : undefined
        }
        chips={[
          ...(filters.q ? [{ label: <>Search: <strong>{filters.q}</strong></>, onClear: () => setFilters({ q: '' }) }] : []),
          ...(filters.gstTreatment ? [{ label: <>GST: <strong>{GST_TREATMENT_LABELS[filters.gstTreatment as keyof typeof GST_TREATMENT_LABELS] ?? filters.gstTreatment}</strong></>, onClear: () => setFilters({ gstTreatment: '' }) }] : []),
        ]}
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
              <EmptyState icon={SearchX} title={`No ${meta.plural.toLowerCase()} match your filters`} hint="Search covers display name, legal name, code, GSTIN and email." action={<Button variant="secondary" size="sm" onClick={reset}>Clear filters</Button>} />
            ) : (
              <EmptyState
                icon={Users}
                title={`No ${meta.plural.toLowerCase()} yet`}
                hint={type === 'SUPPLIER' ? 'Suppliers are the businesses you buy from. Add your first supplier to start raising purchase orders.' : 'Customers are the businesses and consumers you sell to. Add your first customer to start raising sales orders.'}
                action={canManage ? <Button icon={Plus} onClick={() => navigate(`${base}/new`)}>New {meta.singular}</Button> : undefined}
              />
            )
          }
          onRowClick={(r) => navigate(`${base}/${r.id}`)}
        />
        {query.hasNextPage && (
          <div className="flex justify-center border-t border-slate-200 px-4 py-3">
            <Button variant="secondary" size="sm" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
              Load more
            </Button>
          </div>
        )}
        {!query.hasNextPage && rows.length > 0 && <p className="px-4 py-2 text-xs text-slate-500 border-t border-slate-100 tabular">{rows.length} {rows.length === 1 ? meta.singular.toLowerCase() : meta.plural.toLowerCase()}</p>}
      </Card>
    </>
  );
}
