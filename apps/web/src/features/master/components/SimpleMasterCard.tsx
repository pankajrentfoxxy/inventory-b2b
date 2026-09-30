import { useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { Archive, Inbox, MoreHorizontal, Plus, Power } from 'lucide-react';
import { Button, Card, CardHeader, Checkbox, DataTable, Dropdown, EmptyState, ErrorState, IconButton, StatusBadge, type Column } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useSimpleCreate, useSimpleMaster, useSimpleStatus } from '../hooks';
import type { MasterStatus, SimpleKind, SimpleRowMap } from '../types';
import { SimpleFormModal, type FieldSpec } from './SimpleFormModal';

export interface SimpleMasterCardProps<K extends SimpleKind> {
  kind: K;
  title: string;
  description?: ReactNode;
  /** Singular noun for toasts and buttons ("Unit", "Tax rate"). */
  noun: string;
  columns: Column<SimpleRowMap[K]>[];
  fields: FieldSpec[];
  rowLabel: (row: SimpleRowMap[K]) => string;
  emptyHint?: string;
  /** Extra row menu entries (e.g. "Add child" for categories). */
  extraActions?: (row: SimpleRowMap[K]) => { key: string; label: string; onSelect: () => void }[];
  mapPath?: (path: string) => string | null;
  /** Merged into every create payload (e.g. a preset parentId). */
  presetPayload?: Record<string, unknown>;
  className?: string;
}

/** Card + table + add modal + status menu shared by every small master. */
export function SimpleMasterCard<K extends SimpleKind>({ kind, title, description, noun, columns, fields, rowLabel, emptyHint, extraActions, mapPath, presetPayload, className }: SimpleMasterCardProps<K>) {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('master.manage');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const query = useSimpleMaster(kind, includeInactive);
  const create = useSimpleCreate(kind);
  const setStatus = useSimpleStatus(kind);

  const changeStatus = async (row: SimpleRowMap[K], status: MasterStatus) => {
    try {
      await setStatus.mutateAsync({ id: row.id, status });
      toast.success(`${rowLabel(row)} is now ${status.toLowerCase()}`);
    } catch (err) {
      toast.error(toApiError(err).message);
    }
  };

  const rows = (query.data ?? []) as SimpleRowMap[K][];
  const allColumns: Column<SimpleRowMap[K]>[] = [...columns, { key: '__status', header: 'Status', width: '110px', render: (r) => <StatusBadge status={r.status} /> }];

  return (
    <Card className={className}>
      <CardHeader
        title={title}
        description={description}
        actions={
          <>
            <Checkbox label={<span className="text-xs text-slate-600">Show inactive</span>} checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
            {canManage && (
              <Button size="sm" icon={Plus} onClick={() => setAddOpen(true)}>
                Add
              </Button>
            )}
          </>
        }
      />
      <DataTable
        dense
        columns={allColumns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={query.isLoading}
        error={query.isError ? <ErrorState message={toApiError(query.error).message} onRetry={() => void query.refetch()} /> : undefined}
        empty={<EmptyState icon={Inbox} title={`No ${noun.toLowerCase()}s yet`} hint={emptyHint} className="py-8" action={canManage ? <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAddOpen(true)}>Add {noun.toLowerCase()}</Button> : undefined} />}
        rowActions={
          canManage
            ? (row) => (
                <Dropdown
                  trigger={({ toggle }) => <IconButton icon={MoreHorizontal} label={`${noun} actions`} size="sm" onClick={toggle} />}
                  items={[
                    ...(extraActions?.(row) ?? []),
                    { key: 'activate', label: 'Activate', icon: Power, onSelect: () => void changeStatus(row, 'ACTIVE'), hidden: row.status === 'ACTIVE' },
                    { key: 'deactivate', label: 'Deactivate', icon: Power, onSelect: () => void changeStatus(row, 'INACTIVE'), hidden: row.status !== 'ACTIVE' },
                    { key: 'archive', label: 'Archive', icon: Archive, tone: 'danger', onSelect: () => void changeStatus(row, 'ARCHIVED'), hidden: row.status === 'ARCHIVED' },
                  ]}
                />
              )
            : undefined
        }
      />
      <SimpleFormModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={`New ${noun}`}
        fields={fields}
        pending={create.isPending}
        mapPath={mapPath}
        onSubmit={(payload) => create.mutateAsync({ ...presetPayload, ...payload })}
        successMessage={(r) => `${rowLabel(r as SimpleRowMap[K])} created`}
      />
    </Card>
  );
}
