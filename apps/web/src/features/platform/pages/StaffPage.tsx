import { useState } from 'react';
import { MoreHorizontal, ShieldCheck, UserPlus } from 'lucide-react';
import { Badge, Button, Card, DataTable, Dropdown, EmptyState, ErrorState, IconButton, ListToolbar, StatusBadge, type Column } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { usePlatformRoles, usePlatformStaff } from '../hooks';
import type { PlatformStaff } from '../types';
import { AddStaffModal } from '../components/AddStaffModal';
import { StaffRolesModal } from '../components/StaffRolesModal';

export function StaffPage() {
  const { session } = useAuth();
  const query = usePlatformStaff();
  const roles = usePlatformRoles();
  const [addOpen, setAddOpen] = useState(false);
  const [rolesFor, setRolesFor] = useState<PlatformStaff | null>(null);

  const roleName = (key: string) => roles.data?.find((r) => r.key === key)?.name ?? key;
  const error = query.isError ? toApiError(query.error).message : null;

  const columns: Column<PlatformStaff>[] = [
    {
      key: 'name',
      header: 'Staff member',
      render: (s) => (
        <div className="min-w-0">
          <p className="font-medium text-slate-900 truncate">
            {s.fullName}
            {s.userId === session?.user.id && <span className="ml-2 text-xs text-slate-400">(you)</span>}
          </p>
          <p className="text-xs text-slate-500 truncate">{s.email}</p>
        </div>
      ),
    },
    {
      key: 'roles',
      header: 'Platform roles',
      render: (s) => (
        <div className="flex flex-wrap gap-1">
          {s.roleKeys.length === 0 ? <span className="text-slate-400">-</span> : s.roleKeys.map((k) => <Badge key={k} tone={k === 'PLATFORM_SUPER_ADMIN' ? 'purple' : 'blue'}>{roleName(k)}</Badge>)}
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (s) => <StatusBadge status={s.status} /> },
    { key: 'user', header: 'User id', hideBelow: 'lg', render: (s) => <span className="font-mono text-xs text-slate-500">{s.userId}</span> },
  ];

  return (
    <>
      <ListToolbar
        views={[{ value: '', label: 'Platform staff', count: query.data?.length }]}
        view=""
        onViewChange={() => undefined}
        actions={<Button icon={UserPlus} onClick={() => setAddOpen(true)}>Add staff</Button>}
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching && !query.isLoading}
      />
      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={query.data ?? []}
          rowKey={(s) => s.id}
          loading={query.isLoading}
          error={error ? <ErrorState message={error} onRetry={() => void query.refetch()} /> : undefined}
          empty={<EmptyState icon={ShieldCheck} title="No platform staff" hint="Create identities with the svc-auth admin CLI, then attach platform roles here." action={<Button icon={UserPlus} onClick={() => setAddOpen(true)}>Add staff</Button>} />}
          rowActions={(s) => (
            <Dropdown
              trigger={({ toggle }) => <IconButton icon={MoreHorizontal} label="Staff actions" size="sm" onClick={toggle} />}
              items={[{ key: 'roles', label: 'Change platform roles', icon: ShieldCheck, onSelect: () => setRolesFor(s), disabled: s.userId === session?.user.id }]}
            />
          )}
        />
      </Card>
      <AddStaffModal open={addOpen} onClose={() => setAddOpen(false)} />
      <StaffRolesModal staff={rolesFor} onClose={() => setRolesFor(null)} />
    </>
  );
}
