import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Copy, Lock, Plus, Shield, Trash2, Users } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, EmptyState, ErrorState, PageHeader, Skeleton } from '../../../components/ui';
import { useUrlFilters } from '../../../hooks/useUrlFilters';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { cn } from '../../../lib/utils';
import { useDeleteRole, usePermissionCatalog, useReplaceRolePermissions, useRoles } from '../hooks';
import type { Role } from '../types';
import { describeApiError } from '../errorText';
import { PermissionMatrix } from '../components/PermissionMatrix';
import { RoleFormModal } from '../components/RoleFormModal';

const DEFAULTS = { role: '' };

export function RolesPage() {
  const { filters, setFilters } = useUrlFilters(DEFAULTS);
  const { hasPermission, permissions } = useAuth();
  const canManage = hasPermission('iam.role.manage');

  const roles = useRoles();
  const catalog = usePermissionCatalog();
  const replace = useReplaceRolePermissions();
  const remove = useDeleteRole();

  const selected: Role | null = useMemo(() => {
    const list = roles.data ?? [];
    return list.find((r) => r.id === filters.role) ?? list[0] ?? null;
  }, [roles.data, filters.role]);

  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [formOpen, setFormOpen] = useState<{ source: Role | null } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Role | null>(null);

  // Reset the draft whenever the selected role (or its saved version) changes.
  useEffect(() => {
    setDraft(new Set(selected?.permissionCodes ?? []));
  }, [selected?.id, selected?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(() => {
    if (!selected) return false;
    const saved = new Set(selected.permissionCodes);
    if (saved.size !== draft.size) return true;
    for (const c of draft) if (!saved.has(c)) return true;
    return false;
  }, [selected, draft]);

  const editable = Boolean(selected && !selected.isSystem && canManage);

  const save = async () => {
    if (!selected) return;
    try {
      const res = await replace.mutateAsync({ id: selected.id, permissionCodes: [...draft].sort(), version: selected.version });
      toast.success(`${selected.name} saved. ${res.affectedMemberships} member${res.affectedMemberships === 1 ? '' : 's'} affected.`);
    } catch (err) {
      const e = toApiError(err);
      toast.error(e.code === 'VERSION_CONFLICT' ? `${e.message}. The list has been refreshed.` : describeApiError(e));
      if (e.code === 'VERSION_CONFLICT') void roles.refetch();
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await remove.mutateAsync(pendingDelete.id);
      toast.success(`${pendingDelete.name} deleted`);
      if (filters.role === pendingDelete.id) setFilters({ role: '' });
    } catch (err) {
      toast.error(describeApiError(toApiError(err)));
    } finally {
      setPendingDelete(null);
    }
  };

  const listError = roles.isError ? toApiError(roles.error).message : null;

  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        subtitle="System roles are fixed; clone one to start a custom role. Rank controls who may assign or edit whom."
        breadcrumbs={[{ label: 'Settings', to: '/settings/members' }, { label: 'Roles & Permissions' }]}
        actions={canManage ? <Button icon={Plus} onClick={() => setFormOpen({ source: null })}>New role</Button> : undefined}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 items-start">
        <Card className="overflow-hidden">
          <CardHeader title="Roles" description={roles.data ? `${roles.data.length} roles` : undefined} />
          {roles.isLoading ? (
            <div className="p-3 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : listError ? (
            <ErrorState title="Could not load roles" message={listError} onRetry={() => void roles.refetch()} />
          ) : (roles.data ?? []).length === 0 ? (
            <EmptyState icon={Shield} title="No roles" hint="System roles are seeded when the organisation is activated." />
          ) : (
            <ul className="divide-y divide-slate-100 max-h-[70vh] overflow-y-auto">
              {(roles.data ?? []).map((r) => {
                const active = selected?.id === r.id;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setFilters({ role: r.id })}
                      className={cn('w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors', active && 'bg-brand-50/60 border-l-2 border-brand-600')}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-900 truncate">{r.name}</span>
                        <span className="flex items-center gap-1.5 shrink-0">
                          {r.isSystem ? (
                            <Badge tone="blue">
                              <Lock className="w-3 h-3" /> System
                            </Badge>
                          ) : (
                            <Badge tone="purple">Custom</Badge>
                          )}
                          <span className="text-[11px] text-slate-400 tabular">rank {r.rank}</span>
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-3 text-xs text-slate-500">
                        <span className="inline-flex items-center gap-1 tabular">
                          <Users className="w-3 h-3" /> {r.memberCount} member{r.memberCount === 1 ? '' : 's'}
                        </span>
                        <span className="tabular">{r.permissionCodes.length} permissions</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          {selected ? (
            <>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    {selected.name}
                    {selected.isSystem && (
                      <Badge tone="blue">
                        <Lock className="w-3 h-3" /> System role
                      </Badge>
                    )}
                  </span>
                }
                description={selected.description ?? (selected.isSystem ? 'System roles cannot be edited; clone one to customise.' : `Key ${selected.key}, rank ${selected.rank}, version ${selected.version}`)}
                actions={
                  canManage ? (
                    <>
                      <Button variant="secondary" size="sm" icon={Copy} onClick={() => setFormOpen({ source: selected })}>
                        Clone
                      </Button>
                      {!selected.isSystem && (
                        <Button variant="dangerOutline" size="sm" icon={Trash2} onClick={() => setPendingDelete(selected)} disabled={selected.memberCount > 0} title={selected.memberCount > 0 ? 'Unassign this role from all members first' : undefined}>
                          Delete
                        </Button>
                      )}
                      {editable && (
                        <Button size="sm" onClick={() => void save()} loading={replace.isPending} disabled={!dirty}>
                          Save permissions
                        </Button>
                      )}
                    </>
                  ) : undefined
                }
              />
              <CardBody>
                {catalog.isError ? (
                  <ErrorState title="Could not load the permission catalogue" message={toApiError(catalog.error).message} onRetry={() => void catalog.refetch()} />
                ) : (
                  <>
                    {editable && dirty && <p className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Unsaved changes. Saving bumps every affected member's permissions immediately.</p>}
                    <PermissionMatrix groups={catalog.data ?? []} loading={catalog.isLoading} value={draft} onChange={setDraft} readOnly={!editable} held={editable ? permissions : undefined} />
                  </>
                )}
              </CardBody>
            </>
          ) : (
            <EmptyState icon={Shield} title="Select a role" hint="Pick a role on the left to see its permissions." />
          )}
        </Card>
      </div>

      <RoleFormModal open={Boolean(formOpen)} source={formOpen?.source ?? null} onClose={() => setFormOpen(null)} onSaved={(id) => setFilters({ role: id })} />
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
        loading={remove.isPending}
        title="Delete role?"
        confirmLabel="Delete"
        message={
          <>
            <strong>{pendingDelete?.name}</strong> will be deleted. Roles assigned to members cannot be deleted.
          </>
        }
      />
    </>
  );
}
