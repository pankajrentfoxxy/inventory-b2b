import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowDownAZ, ArrowUpAZ, Check, ChevronDown, MoreHorizontal, Package, Pencil, Plus, Power, RefreshCw, SearchX, Trash2, X } from 'lucide-react';
import { ITEM_TYPE_LABELS } from '@b2b/shared';
import { Badge, Button, Card, ConfirmDialog, DataTable, Dropdown, EmptyState, ErrorState, IconButton, Pagination, Select, type Column, type MenuItem } from '../../../components/ui';
import { useUrlFilters } from '../../../hooks/useUrlFilters';
import { toApiError } from '../../../lib/api';
import { usePermission } from '../../../lib/auth';
import { cn, formatMoney } from '../../../lib/utils';
import { useDeleteItem, useItemStatus, useItems } from '../hooks';
import type { Item } from '../types';
import { ItemFormModal } from '../components/ItemFormModal';

const DEFAULTS = { page: 1, limit: 25, search: '', status: '', type: '', sortBy: 'name', sortOrder: 'asc' };
const VIEWS = [
  { value: '', label: 'All Items', countKey: 'ALL' as const },
  { value: 'ACTIVE', label: 'Active Items', countKey: 'ACTIVE' as const },
  { value: 'INACTIVE', label: 'Inactive Items', countKey: 'INACTIVE' as const },
];
const SORTS = [
  { value: 'name', label: 'Name' },
  { value: 'sku', label: 'SKU' },
  { value: 'purchaseRate', label: 'Purchase Rate' },
  { value: 'createdAt', label: 'Created Time' },
  { value: 'updatedAt', label: 'Last Modified Time' },
];

export function ItemListPage() {
  const { filters, setFilters, reset } = useUrlFilters(DEFAULTS);
  const params = useMemo(() => ({ ...filters, status: filters.status || 'ALL' }), [filters]);
  const query = useItems(params);
  const perms = usePermission();
  const statusMutation = useItemStatus();
  const deleteMutation = useDeleteItem();
  const [searchParams, setSearchParams] = useSearchParams();
  // Quick-create ("+" in the top bar) lands here with ?new=1 and opens the form straight away.
  const [modal, setModal] = useState<{ open: boolean; item: Item | null }>({ open: searchParams.get('new') === '1' && perms.canCreateItem, item: null });
  const [pendingDelete, setPendingDelete] = useState<Item | null>(null);
  const closeModal = () => {
    setModal({ open: false, item: null });
    if (searchParams.get('new')) {
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
  };

  const view = VIEWS.find((v) => v.value === (filters.status || '')) ?? VIEWS[0];
  const hasFilters = Boolean(filters.search || filters.status || filters.type);
  const data = query.data;

  const onSort = (key: string) => {
    if (filters.sortBy === key) setFilters({ sortOrder: filters.sortOrder === 'asc' ? 'desc' : 'asc' });
    else setFilters({ sortBy: key, sortOrder: 'asc' });
  };

  const toggle = async (item: Item) => {
    try {
      await statusMutation.mutateAsync({ id: item.id, isActive: !item.isActive });
      toast.success(`${item.name} marked as ${item.isActive ? 'inactive' : 'active'}`);
    } catch (err) {
      toast.error(toApiError(err).message);
    }
  };
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteMutation.mutateAsync(pendingDelete.id);
      toast.success(`${pendingDelete.name} deleted`);
    } catch (err) {
      toast.error(toApiError(err).message);
    } finally {
      setPendingDelete(null);
    }
  };

  const columns: Column<Item>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (i) => (
        <div className="min-w-0 flex items-start gap-2">
          <div className="min-w-0">
            <button type="button" onClick={() => perms.canEditItem && setModal({ open: true, item: i })} className={cn('font-medium text-brand-700 text-left', perms.canEditItem && 'hover:underline')}>
              {i.name}
            </button>
            <p className="text-xs text-slate-500 truncate">{[i.sku, i.description].filter(Boolean).join(' - ')}</p>
          </div>
          {!i.isActive && <Badge tone="gray">Inactive</Badge>}
        </div>
      ),
    },
    { key: 'sku', header: 'SKU', sortable: true, hideBelow: 'md', render: (i) => <span className="font-mono text-[13px] tabular text-slate-800">{i.sku ?? ''}</span> },
    { key: 'type', header: 'Type', hideBelow: 'lg', render: (i) => <span className="text-slate-800">{ITEM_TYPE_LABELS[i.type]}</span> },
    { key: 'unit', header: 'Unit', hideBelow: 'lg', render: (i) => <span className="text-slate-800">{i.unit}</span> },
    { key: 'hsn', header: 'HSN/SAC', hideBelow: 'xl', render: (i) => <span className="font-mono text-[13px] tabular text-slate-800">{i.hsnCode ?? ''}</span> },
    { key: 'tax', header: 'Tax', hideBelow: 'lg', render: (i) => <span className="text-slate-800">{i.tax ? `${i.tax.name} [${i.tax.rate}%]` : ''}</span> },
    { key: 'purchaseRate', header: 'Purchase Rate', sortable: true, align: 'right', className: 'whitespace-nowrap', render: (i) => <span className="tabular text-slate-900">{i.purchaseRate === null ? <span className="text-slate-300">-</span> : formatMoney(i.purchaseRate)}</span> },
  ];

  const moreItems: MenuItem[] = [
    ...SORTS.map((o) => ({
      key: `sort-${o.value}`,
      label: (
        <span className="flex items-center justify-between w-full gap-3">
          <span className="text-slate-500 text-xs">Sort by</span>
          <span className="flex-1">{o.label}</span>
          {filters.sortBy === o.value && <Check className="w-4 h-4 text-brand-600" />}
        </span>
      ),
      onSelect: () => onSort(o.value),
    })),
    { key: 'order', label: filters.sortOrder === 'asc' ? 'Ascending order' : 'Descending order', icon: filters.sortOrder === 'asc' ? ArrowDownAZ : ArrowUpAZ, onSelect: () => setFilters({ sortOrder: filters.sortOrder === 'asc' ? 'desc' : 'asc' }) },
    { key: 'refresh', label: 'Refresh List', icon: RefreshCw, onSelect: () => void query.refetch() },
  ];

  return (
    <>
      <div className="mb-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Dropdown
            align="left"
            trigger={({ toggle: t }) => (
              <button type="button" onClick={t} className="inline-flex items-center gap-1.5 text-xl font-semibold text-slate-900 hover:text-brand-700">
                {view.label}
                <ChevronDown className="w-5 h-5 text-brand-600" />
              </button>
            )}
            items={VIEWS.map((v) => ({
              key: v.value || 'all',
              label: (
                <span className="flex items-center justify-between w-full gap-4">
                  <span>{v.label}</span>
                  <span className="flex items-center gap-2">
                    {data && <span className="text-xs text-slate-400 tabular">{data.counts[v.countKey]}</span>}
                    {v.value === (filters.status || '') && <Check className="w-4 h-4 text-brand-600" />}
                  </span>
                </span>
              ),
              onSelect: () => setFilters({ status: v.value }),
            }))}
          />
          <div className="flex items-center gap-2">
            <Select aria-label="Item type" value={filters.type} onChange={(e) => setFilters({ type: e.target.value })} placeholder="All types" options={[{ value: 'GOODS', label: 'Goods' }, { value: 'SERVICE', label: 'Services' }]} className="h-9 w-36" />
            {perms.canCreateItem && (
              <Button icon={Plus} onClick={() => setModal({ open: true, item: null })}>
                New
              </Button>
            )}
            <Dropdown trigger={({ toggle: t }) => <IconButton icon={MoreHorizontal} label="More actions" onClick={t} className="border border-slate-300 bg-white" />} items={moreItems} />
          </div>
        </div>
        {hasFilters && (
          <div className="flex items-center gap-2 flex-wrap text-xs text-slate-600">
            {filters.search && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 text-brand-700 px-2.5 py-1">
                Search: <strong>{filters.search}</strong>
                <button type="button" onClick={() => setFilters({ search: '' })} aria-label="Clear search" className="hover:text-brand-900">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            <button type="button" onClick={reset} className="text-slate-500 hover:text-slate-800 hover:underline">
              Clear all filters
            </button>
          </div>
        )}
      </div>

      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={data?.data ?? []}
          rowKey={(r) => r.id}
          loading={query.isLoading}
          error={query.isError ? <ErrorState message={toApiError(query.error).message} onRetry={() => void query.refetch()} /> : undefined}
          empty={
            hasFilters ? (
              <EmptyState icon={SearchX} title="No items match your search" action={<Button variant="secondary" size="sm" onClick={reset}>Clear filters</Button>} />
            ) : (
              <EmptyState icon={Package} title="No items yet" hint="Items are the goods and services you buy and sell. Add your first item to start raising purchase orders." action={perms.canCreateItem ? <Button onClick={() => setModal({ open: true, item: null })}>New Item</Button> : undefined} />
            )
          }
          sortBy={filters.sortBy}
          sortOrder={filters.sortOrder as 'asc' | 'desc'}
          onSort={onSort}
          onRowClick={perms.canEditItem ? (r) => setModal({ open: true, item: r }) : undefined}
          rowActions={(i) => (
            <Dropdown
              trigger={({ toggle: t }) => <IconButton icon={MoreHorizontal} label="Item actions" size="sm" onClick={t} />}
              items={[
                { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => setModal({ open: true, item: i }), hidden: !perms.canEditItem },
                { key: 'status', label: i.isActive ? 'Mark as Inactive' : 'Mark as Active', icon: Power, onSelect: () => void toggle(i), hidden: !perms.canEditItem },
                { key: 'delete', label: 'Delete', icon: Trash2, tone: 'danger', onSelect: () => setPendingDelete(i), hidden: !perms.canDeleteItem },
              ]}
            />
          )}
        />
        {data && data.pagination.total > 0 && <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} total={data.pagination.total} limit={data.pagination.limit} onPageChange={(p) => setFilters({ page: p })} onLimitChange={(l) => setFilters({ limit: l, page: 1 })} />}
      </Card>

      <ItemFormModal open={modal.open} item={modal.item} onClose={closeModal} />
      <ConfirmDialog open={Boolean(pendingDelete)} onClose={() => setPendingDelete(null)} onConfirm={() => void confirmDelete()} loading={deleteMutation.isPending} title="Delete item?" confirmLabel="Delete" message={<><strong>{pendingDelete?.name}</strong> will be removed from item lists and pickers. Existing purchase orders keep their line details.</>} />
    </>
  );
}
