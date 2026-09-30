import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Mail, MoreHorizontal, RefreshCw, ShieldCheck, UserMinus, UserPlus, UserX, Warehouse, XCircle } from 'lucide-react';
import { Badge, Button, Card, ConfirmDialog, DataTable, Dropdown, EmptyState, ErrorState, IconButton, ListToolbar, ReasonDialog, StatusBadge, Tabs, type Column } from '../../../components/ui';
import { useUrlFilters } from '../../../hooks/useUrlFilters';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatDateTime } from '../../../lib/utils';
import { useInvitations, useMembers, useResendInvitation, useRevokeInvitation, useRoles, useTransitionMember } from '../hooks';
import type { Invitation, Member, MemberCommand, MemberStatus } from '../types';
import { describeApiError } from '../errorText';
import { InviteMemberModal } from '../components/InviteMemberModal';
import { MemberRolesModal } from '../components/MemberRolesModal';
import { WarehouseScopeModal } from '../components/WarehouseScopeModal';

const DEFAULTS = { tab: 'members', status: '' };

const VIEWS = [
  { value: '', label: 'All members' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INVITED', label: 'Invited' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'REMOVED', label: 'Removed' },
];

const COMMAND_COPY: Record<MemberCommand, { title: string; label: string; tone: 'danger' | 'primary'; message: string }> = {
  suspend: { title: 'Suspend member?', label: 'Suspend', tone: 'danger', message: 'They lose access immediately. Their history and documents are kept.' },
  reactivate: { title: 'Reactivate member?', label: 'Reactivate', tone: 'primary', message: 'Access is restored with the same roles and warehouse scope.' },
  remove: { title: 'Remove member?', label: 'Remove', tone: 'danger', message: 'The membership is archived, not destroyed. They can be invited again later.' },
};

export function MembersPage() {
  const { filters, setFilters } = useUrlFilters(DEFAULTS);
  const tab = filters.tab === 'invitations' ? 'invitations' : 'members';
  const { hasPermission, session } = useAuth();
  const canInvite = hasPermission('iam.member.invite');

  const [inviteOpen, setInviteOpen] = useState(false);
  const invitations = useInvitations(true);
  const pendingCount = invitations.data?.filter((i) => i.status === 'PENDING').length;

  return (
    <>
      <Tabs
        className="mb-4"
        value={tab}
        onChange={(t) => setFilters({ tab: t === 'members' ? '' : t })}
        tabs={[
          { key: 'members', label: 'Members' },
          { key: 'invitations', label: 'Invitations', count: pendingCount },
        ]}
      />
      {tab === 'members' ? (
        <MembersTab status={filters.status as MemberStatus | ''} onStatusChange={(s) => setFilters({ status: s })} canInvite={canInvite} onInvite={() => setInviteOpen(true)} selfMembershipId={session?.membershipId ?? null} />
      ) : (
        <InvitationsTab canInvite={canInvite} onInvite={() => setInviteOpen(true)} />
      )}
      <InviteMemberModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </>
  );
}

/* ---- members ------------------------------------------------------------------ */

function MembersTab({ status, onStatusChange, canInvite, onInvite, selfMembershipId }: { status: MemberStatus | ''; onStatusChange: (s: string) => void; canInvite: boolean; onInvite: () => void; selfMembershipId: string | null }) {
  const { hasPermission } = useAuth();
  const params = useMemo(() => (status ? { status } : {}), [status]);
  const query = useMembers(params);
  const transition = useTransitionMember();

  const [rolesFor, setRolesFor] = useState<Member | null>(null);
  const [scopeFor, setScopeFor] = useState<Member | null>(null);
  const [pending, setPending] = useState<{ member: Member; command: MemberCommand } | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  const canAssign = hasPermission('iam.role.assign');
  const canScope = hasPermission('iam.member.manage');
  const canSuspend = hasPermission('iam.member.suspend');
  const canRemove = hasPermission('iam.member.remove');

  const runTransition = async ({ reason }: { reason: string }) => {
    if (!pending) return;
    try {
      await transition.mutateAsync({ id: pending.member.id, command: pending.command, reason });
      toast.success(`${pending.member.fullName} ${pending.command === 'suspend' ? 'suspended' : pending.command === 'remove' ? 'removed' : 'reactivated'}`);
      setPending(null);
      setTransitionError(null);
    } catch (err) {
      const e = toApiError(err);
      const text = describeApiError(e);
      setTransitionError(e.fieldErrors.reason ?? null);
      toast.error(text);
    }
  };

  const columns: Column<Member>[] = [
    {
      key: 'name',
      header: 'Member',
      render: (m) => (
        <div className="min-w-0">
          <p className="font-medium text-slate-900 truncate">
            {m.fullName}
            {m.id === selfMembershipId && <span className="ml-2 text-xs text-slate-400">(you)</span>}
          </p>
          <p className="text-xs text-slate-500 truncate">{m.email}</p>
        </div>
      ),
    },
    {
      key: 'roles',
      header: 'Roles',
      render: (m) => (
        <div className="flex flex-wrap gap-1">
          {m.roles.length === 0 ? <span className="text-slate-400">-</span> : m.roles.map((r) => <Badge key={r.id} tone={r.key === 'OWNER' ? 'purple' : 'gray'}>{r.name}</Badge>)}
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (m) => <StatusBadge status={m.status} /> },
    {
      key: 'scope',
      header: 'Warehouses',
      hideBelow: 'md',
      render: (m) => (m.allWarehouses ? <span className="text-slate-700">All</span> : <span className="tabular">{m.warehouseIds.length} selected</span>),
    },
    { key: 'joined', header: 'Joined', hideBelow: 'lg', render: (m) => <span className="text-slate-600 text-xs">{m.joinedAt ? formatDateTime(m.joinedAt) : '-'}</span> },
  ];

  const rowActions = (m: Member) => {
    const isSelf = m.id === selfMembershipId;
    const gone = m.status === 'REMOVED';
    return (
      <Dropdown
        trigger={({ toggle }) => <IconButton icon={MoreHorizontal} label="Member actions" size="sm" onClick={toggle} />}
        items={[
          { key: 'roles', label: 'Change roles', icon: ShieldCheck, onSelect: () => setRolesFor(m), hidden: !canAssign || isSelf || gone },
          { key: 'scope', label: 'Warehouse scope', icon: Warehouse, onSelect: () => setScopeFor(m), hidden: !canScope || gone },
          { key: 'suspend', label: 'Suspend', icon: UserX, tone: 'danger', onSelect: () => setPending({ member: m, command: 'suspend' }), hidden: !canSuspend || isSelf || m.status !== 'ACTIVE' },
          { key: 'reactivate', label: 'Reactivate', icon: RefreshCw, onSelect: () => setPending({ member: m, command: 'reactivate' }), hidden: !canSuspend || isSelf || m.status !== 'SUSPENDED' },
          { key: 'remove', label: 'Remove', icon: UserMinus, tone: 'danger', onSelect: () => setPending({ member: m, command: 'remove' }), hidden: !canRemove || isSelf || gone },
        ]}
      />
    );
  };

  const error = query.isError ? toApiError(query.error).message : null;
  const copy = pending ? COMMAND_COPY[pending.command] : null;

  return (
    <>
      <ListToolbar
        views={VIEWS}
        view={status}
        onViewChange={onStatusChange}
        actions={canInvite ? <Button icon={UserPlus} onClick={onInvite}>Invite member</Button> : undefined}
        chips={status ? [{ label: `Status: ${status}`, onClear: () => onStatusChange('') }] : []}
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching && !query.isLoading}
      />
      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={query.data ?? []}
          rowKey={(m) => m.id}
          loading={query.isLoading}
          error={error ? <ErrorState message={error} onRetry={() => void query.refetch()} /> : undefined}
          empty={
            <EmptyState
              title={status ? `No ${status.toLowerCase()} members` : 'No members yet'}
              hint={status ? 'Try another status view.' : 'Invite your team and assign roles.'}
              action={canInvite && !status ? <Button icon={UserPlus} onClick={onInvite}>Invite member</Button> : status ? <Button variant="secondary" onClick={() => onStatusChange('')}>Show all</Button> : undefined}
            />
          }
          rowActions={rowActions}
        />
      </Card>

      <MemberRolesModal member={rolesFor} onClose={() => setRolesFor(null)} />
      <WarehouseScopeModal member={scopeFor} onClose={() => setScopeFor(null)} />
      <ReasonDialog
        open={Boolean(pending)}
        onClose={() => { setPending(null); setTransitionError(null); }}
        onConfirm={(v) => void runTransition(v)}
        loading={transition.isPending}
        title={copy?.title ?? ''}
        confirmLabel={copy?.label}
        tone={copy?.tone}
        error={transitionError}
        message={
          pending && (
            <>
              <strong>{pending.member.fullName}</strong> ({pending.member.email}). {copy?.message}
            </>
          )
        }
      />
    </>
  );
}

/* ---- invitations ----------------------------------------------------------------- */

function InvitationsTab({ canInvite, onInvite }: { canInvite: boolean; onInvite: () => void }) {
  const { hasPermission } = useAuth();
  const query = useInvitations(true);
  // Fallback only: the server embeds role names on each invitation.
  const roles = useRoles(hasPermission('iam.role.view'));
  const resend = useResendInvitation();
  const revoke = useRevokeInvitation();
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  const [view, setView] = useState<'PENDING' | ''>('PENDING');

  const roleName = (inv: Invitation, id: string) => inv.roles?.find((r) => r.id === id)?.name ?? roles.data?.find((r) => r.id === id)?.name ?? 'Deleted role';
  const rows = (query.data ?? []).filter((i) => (view ? i.status === view : true));

  const doResend = async (inv: Invitation) => {
    try {
      await resend.mutateAsync(inv.id);
      toast.success(`Invitation re-sent to ${inv.email}`);
    } catch (err) {
      toast.error(toApiError(err).message);
    }
  };
  const doRevoke = async () => {
    if (!revoking) return;
    try {
      await revoke.mutateAsync(revoking.id);
      toast.success(`Invitation for ${revoking.email} revoked`);
    } catch (err) {
      toast.error(toApiError(err).message);
    } finally {
      setRevoking(null);
    }
  };

  const columns: Column<Invitation>[] = [
    {
      key: 'email',
      header: 'Invitee',
      render: (i) => (
        <div className="min-w-0">
          <p className="font-medium text-slate-900 truncate">{i.fullName ?? i.email}</p>
          {i.fullName && <p className="text-xs text-slate-500 truncate">{i.email}</p>}
        </div>
      ),
    },
    {
      key: 'roles',
      header: 'Roles',
      render: (i) => (
        <div className="flex flex-wrap gap-1">
          {i.roleIds.map((id) => (
            <Badge key={id}>{roleName(i, id)}</Badge>
          ))}
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (i) => <StatusBadge status={i.status} /> },
    { key: 'scope', header: 'Warehouses', hideBelow: 'md', render: (i) => (i.warehouseIds.length === 0 ? 'All' : `${i.warehouseIds.length} selected`) },
    {
      key: 'expires',
      header: 'Expires',
      hideBelow: 'md',
      render: (i) => {
        const expired = new Date(i.expiresAt).getTime() < Date.now();
        return <span className={expired && i.status === 'PENDING' ? 'text-xs text-red-600' : 'text-xs text-slate-600'}>{formatDateTime(i.expiresAt)}</span>;
      },
    },
    { key: 'by', header: 'Invited by', hideBelow: 'lg', render: (i) => <span className="text-xs text-slate-600">{i.invitedByName ?? '-'}</span> },
  ];

  const error = query.isError ? toApiError(query.error).message : null;

  return (
    <>
      <ListToolbar
        views={[
          { value: 'PENDING', label: 'Pending invitations', count: query.data?.filter((i) => i.status === 'PENDING').length },
          { value: '', label: 'All invitations', count: query.data?.length },
        ]}
        view={view}
        onViewChange={(v) => setView(v as 'PENDING' | '')}
        actions={canInvite ? <Button icon={UserPlus} onClick={onInvite}>Invite member</Button> : undefined}
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching && !query.isLoading}
      />
      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(i) => i.id}
          loading={query.isLoading}
          error={error ? <ErrorState message={error} onRetry={() => void query.refetch()} /> : undefined}
          empty={<EmptyState icon={Mail} title={view ? 'No pending invitations' : 'No invitations yet'} hint="Invitations you send appear here until they are accepted, revoked or expire." action={canInvite ? <Button icon={UserPlus} onClick={onInvite}>Invite member</Button> : undefined} />}
          rowActions={(i) =>
            canInvite && i.status === 'PENDING' ? (
              <Dropdown
                trigger={({ toggle }) => <IconButton icon={MoreHorizontal} label="Invitation actions" size="sm" onClick={toggle} />}
                items={[
                  { key: 'resend', label: 'Resend email', icon: Mail, onSelect: () => void doResend(i), disabled: resend.isPending },
                  { key: 'revoke', label: 'Revoke', icon: XCircle, tone: 'danger', onSelect: () => setRevoking(i) },
                ]}
              />
            ) : null
          }
        />
      </Card>
      <ConfirmDialog
        open={Boolean(revoking)}
        onClose={() => setRevoking(null)}
        onConfirm={() => void doRevoke()}
        loading={revoke.isPending}
        title="Revoke invitation?"
        confirmLabel="Revoke"
        message={
          <>
            The link sent to <strong>{revoking?.email}</strong> will stop working. You can invite them again later.
          </>
        }
      />
    </>
  );
}
