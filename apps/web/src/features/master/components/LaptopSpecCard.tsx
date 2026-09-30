import { useState } from 'react';
import toast from 'react-hot-toast';
import { Inbox, MoreHorizontal, Plus, Power } from 'lucide-react';
import { Button, Card, CardHeader, Checkbox, DataTable, Dropdown, EmptyState, ErrorState, IconButton, Select, StatusBadge, type Column } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useLaptopSpecs, useSpecStatus } from '../hooks';
import type { SpecKind, SpecOption, SpecStatus } from '../types';
import { SpecOptionFormModal } from './SpecOptionFormModal';

const HINTS: Partial<Record<SpecKind, string>> = {
  MODEL: 'Models belong to a brand. Add the models you buy, e.g. Latitude 5440.',
  PROCESSOR: 'e.g. Intel Core i5-1345U (code I5).',
  GPU: 'e.g. Intel Iris Xe, NVIDIA RTX 3050.',
};

/** One laptop specification master (brand, model, RAM ...): values, add, activate / deactivate. */
export function LaptopSpecCard({ kind, label }: { kind: SpecKind; label: string }) {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('master.manage');
  const isModel = kind === 'MODEL';
  const [includeInactive, setIncludeInactive] = useState(false);
  const [brandFilter, setBrandFilter] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const query = useLaptopSpecs({ kind, includeInactive, brandId: isModel && brandFilter ? brandFilter : undefined });
  const brands = useLaptopSpecs({ kind: 'BRAND', includeInactive: true }, isModel);
  const setStatus = useSpecStatus();

  const changeStatus = async (row: SpecOption, status: SpecStatus) => {
    try {
      await setStatus.mutateAsync({ id: row.id, status });
      toast.success(`${row.name} is now ${status.toLowerCase()}`);
    } catch (err) {
      toast.error(toApiError(err).message);
    }
  };

  const columns: Column<SpecOption>[] = [
    { key: 'name', header: 'Name', render: (r) => <span className="text-slate-900">{r.name}</span> },
    ...(isModel && !brandFilter ? [{ key: 'brand', header: 'Brand', render: (r: SpecOption) => <span className="text-slate-700">{r.brandName ?? '-'}</span> }] : []),
    { key: 'code', header: 'Code', width: '90px', render: (r) => <span className="font-mono text-[13px] text-slate-700">{r.code}</span> },
    { key: 'status', header: 'Status', width: '100px', render: (r) => <StatusBadge status={r.status} /> },
  ];

  const rows = query.data ?? [];
  const noun = label.toLowerCase();

  return (
    <Card className="flex flex-col">
      <CardHeader
        title={label}
        description={HINTS[kind]}
        actions={
          canManage ? (
            <Button size="sm" icon={Plus} onClick={() => setAddOpen(true)}>
              Add
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2 border-b border-slate-100">
        {isModel ? (
          <Select
            aria-label="Filter models by brand"
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            placeholder="All brands"
            options={(brands.data ?? []).map((b) => ({ value: b.id, label: b.name }))}
            className="h-8 w-44 text-xs"
          />
        ) : (
          <span />
        )}
        <Checkbox label={<span className="text-xs text-slate-600">Show inactive</span>} checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
      </div>
      <div className="max-h-80 overflow-y-auto">
        <DataTable
          dense
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={query.isLoading}
          error={query.isError ? <ErrorState message={toApiError(query.error).message} onRetry={() => void query.refetch()} /> : undefined}
          empty={
            <EmptyState
              icon={Inbox}
              title={brandFilter ? `No ${noun}s for this brand` : `No ${noun} values yet`}
              className="py-8"
              action={canManage ? <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAddOpen(true)}>Add {noun}</Button> : undefined}
            />
          }
          rowActions={
            canManage
              ? (row) => (
                  <Dropdown
                    trigger={({ toggle }) => <IconButton icon={MoreHorizontal} label={`${label} actions`} size="sm" onClick={toggle} />}
                    items={[
                      { key: 'activate', label: 'Activate', icon: Power, onSelect: () => void changeStatus(row, 'ACTIVE'), hidden: row.status === 'ACTIVE' },
                      { key: 'deactivate', label: 'Deactivate', icon: Power, tone: 'danger', onSelect: () => void changeStatus(row, 'INACTIVE'), hidden: row.status !== 'ACTIVE' },
                    ]}
                  />
                )
              : undefined
          }
        />
      </div>
      {rows.length > 0 && <p className="mt-auto px-5 py-2 text-xs text-slate-500 border-t border-slate-100 tabular">{rows.length} value{rows.length === 1 ? '' : 's'}</p>}
      <SpecOptionFormModal open={addOpen} onClose={() => setAddOpen(false)} kind={kind} label={label} defaultBrandId={isModel ? brandFilter : undefined} />
    </Card>
  );
}
