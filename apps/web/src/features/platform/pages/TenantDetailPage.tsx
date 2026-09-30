import { useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Ban, CheckCircle2, History, Mail, Pencil, Play, RotateCcw, ShieldOff, XCircle } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, DescriptionList, DetailSkeleton, EmptyState, ErrorState, PageHeader, ReasonDialog, StatusBadge, Tabs } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatDateTime, humanize } from '../../../lib/utils';
import { shouldRetryWithSameKey, useIdempotencyKey } from '../../../hooks/useIdempotencyKey';
import { useResendOwnerInvite, useTenant, useTenantTransition } from '../hooks';
import type { TenantCommand, TenantDetail } from '../types';
import { TenantEditModal } from '../components/TenantEditModal';
import { TenantSettingsCard } from '../components/TenantSettingsCard';

type Tab = 'overview' | 'settings' | 'history';

interface CommandSpec {
  command: TenantCommand;
  label: string;
  permission: string;
  from: TenantDetail['status'][];
  /** `reason` is required; `note` is optional. */
  input: 'reason' | 'note';
  confirmCode?: boolean;
  tone: 'danger' | 'primary';
  variant: 'primary' | 'secondary' | 'danger' | 'dangerOutline';
  icon: typeof CheckCircle2;
  title: string;
  message: string;
  done: string;
}

const COMMANDS: CommandSpec[] = [
  { command: 'approve', label: 'Approve', permission: 'platform.tenant.approve', from: ['PENDING'], input: 'note', tone: 'primary', variant: 'primary', icon: CheckCircle2, title: 'Approve tenant?', message: 'KYC fields (PAN or GSTIN, owner email, registered address) must be complete. The creator cannot approve their own tenant when four-eyes is on.', done: 'approved' },
  { command: 'reject', label: 'Reject', permission: 'platform.tenant.approve', from: ['PENDING'], input: 'reason', tone: 'danger', variant: 'dangerOutline', icon: XCircle, title: 'Reject application?', message: 'The applicant is notified with the reason. Rejected tenants cannot be edited or re-approved.', done: 'rejected' },
  { command: 'activate', label: 'Activate', permission: 'platform.tenant.activate', from: ['APPROVED'], input: 'note', tone: 'primary', variant: 'primary', icon: Play, title: 'Activate tenant?', message: 'Seeds the system roles and emails the owner an invitation to set up their account.', done: 'activated' },
  { command: 'suspend', label: 'Suspend', permission: 'platform.tenant.suspend', from: ['ACTIVE'], input: 'reason', tone: 'danger', variant: 'dangerOutline', icon: Ban, title: 'Suspend tenant?', message: 'All members lose access on their next request. Data is kept and the tenant can be reactivated.', done: 'suspended' },
  { command: 'reactivate', label: 'Reactivate', permission: 'platform.tenant.suspend', from: ['SUSPENDED'], input: 'reason', tone: 'primary', variant: 'primary', icon: RotateCcw, title: 'Reactivate tenant?', message: 'Members regain access with their previous roles.', done: 'reactivated' },
  { command: 'deactivate', label: 'Deactivate', permission: 'platform.tenant.deactivate', from: ['ACTIVE', 'SUSPENDED'], input: 'reason', confirmCode: true, tone: 'danger', variant: 'danger', icon: ShieldOff, title: 'Deactivate tenant?', message: 'This is final: a deactivated tenant cannot be reactivated or edited. Nothing is deleted.', done: 'deactivated' },
];

export function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const query = useTenant(id);
  const transition = useTenantTransition();
  const resend = useResendOwnerInvite();
  const { keyFor, reset: resetKey } = useIdempotencyKey();

  const [tab, setTab] = useState<Tab>('overview');
  const [editOpen, setEditOpen] = useState(false);
  const [pending, setPending] = useState<CommandSpec | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [resendOpen, setResendOpen] = useState(false);

  if (query.isLoading) return <DetailSkeleton />;
  if (query.isError || !query.data) {
    const e = query.error ? toApiError(query.error) : null;
    return (
      <>
        <PageHeader title="Tenant" breadcrumbs={[{ label: 'Tenants', to: '/admin/tenants' }, { label: 'Not found' }]} />
        <Card>
          <ErrorState title={e?.status === 404 ? 'Tenant not found' : 'Could not load the tenant'} message={e?.message} onRetry={e?.status === 404 ? undefined : () => void query.refetch()} />
        </Card>
      </>
    );
  }
  const t = query.data;
  const canEdit = hasPermission('platform.tenant.edit') && t.status !== 'DEACTIVATED' && t.status !== 'REJECTED';
  const available = COMMANDS.filter((c) => c.from.includes(t.status) && hasPermission(c.permission));
  // svc-tenant only accepts resend-owner-invite while ACTIVE (APPROVED returns TENANT_INVALID_TRANSITION).
  const canResend = t.status === 'ACTIVE' && hasPermission('platform.tenant.activate');

  const runCommand = async ({ reason, confirmCode }: { reason: string; confirmCode?: string }) => {
    if (!pending) return;
    const body = pending.input === 'reason' ? { reason, ...(pending.confirmCode ? { confirmCode } : {}) } : reason ? { note: reason } : {};
    const key = keyFor({ id: t.id, command: pending.command, body, version: t.version });
    try {
      await transition.mutateAsync({ id: t.id, command: pending.command, body, idempotencyKey: key });
      resetKey();
      toast.success(`${t.displayName} ${pending.done}`);
      setPending(null);
      setDialogError(null);
    } catch (err) {
      const e = toApiError(err);
      if (!shouldRetryWithSameKey(e.status)) resetKey();
      const detail = e.details.map((d) => `${humanize(d.path.split('.').pop() ?? d.path)}: ${d.message}`).join('; ');
      setDialogError(e.fieldErrors.reason ?? e.fieldErrors.confirmCode ?? null);
      toast.error(detail ? `${e.message} (${detail})` : e.message);
      if (e.code === 'VERSION_CONFLICT' || e.code === 'TENANT_INVALID_TRANSITION') void query.refetch();
    }
  };

  const doResend = async () => {
    try {
      await resend.mutateAsync(t.id);
      toast.success(`Owner invite re-sent to ${t.ownerEmail}`);
    } catch (err) {
      toast.error(toApiError(err).message);
    } finally {
      setResendOpen(false);
    }
  };

  const addr = t.registeredAddress;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {t.displayName}
            <StatusBadge status={t.status} />
          </span>
        }
        subtitle={
          <span className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[13px]">{t.code}</span>
            <span className="text-slate-300">|</span>
            <span>{t.legalName}</span>
            <Badge tone="gray">{humanize(t.source)}</Badge>
          </span>
        }
        breadcrumbs={[{ label: 'Tenants', to: '/admin/tenants' }, { label: t.code }]}
        actions={
          <>
            {canEdit && (
              <Button variant="secondary" icon={Pencil} onClick={() => setEditOpen(true)}>
                Edit
              </Button>
            )}
            {canResend && (
              <Button variant="secondary" icon={Mail} onClick={() => setResendOpen(true)}>
                Resend owner invite
              </Button>
            )}
            {available.map((c) => (
              <Button key={c.command} variant={c.variant} icon={c.icon} onClick={() => { setPending(c); setDialogError(null); }}>
                {c.label}
              </Button>
            ))}
          </>
        }
      />

      {t.statusReason && (t.status === 'SUSPENDED' || t.status === 'REJECTED' || t.status === 'DEACTIVATED') && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <span className="font-medium">{humanize(t.status)}:</span> {t.statusReason}
        </div>
      )}

      <Tabs<Tab>
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'settings', label: 'Settings' },
          { key: 'history', label: 'History', count: t.history.length },
        ]}
      />

      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          <Card className="lg:col-span-2">
            <CardHeader title="Profile" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: 'Legal name', value: t.legalName },
                  { label: 'Display name', value: t.displayName },
                  { label: 'Code', value: t.code, mono: true },
                  { label: 'State code', value: t.stateCode, mono: true },
                  { label: 'GSTIN', value: t.gstin, mono: true },
                  { label: 'PAN', value: t.pan, mono: true },
                  { label: 'Source', value: humanize(t.source) },
                  { label: 'Version', value: String(t.version), mono: true },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Owner" />
            <CardBody>
              <DescriptionList columns={1} items={[{ label: 'Name', value: t.ownerName }, { label: 'Email', value: t.ownerEmail }, { label: 'Phone', value: t.ownerPhone }]} />
            </CardBody>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="Registered address" />
            <CardBody>
              {addr ? (
                <DescriptionList
                  items={[
                    { label: 'Address', value: [addr.line1, addr.line2].filter(Boolean).join(', '), span: 2 },
                    { label: 'City', value: addr.city },
                    { label: 'State', value: `${addr.state} (${addr.stateCode})` },
                    { label: 'Pincode', value: addr.pincode, mono: true },
                    { label: 'Country', value: addr.country, mono: true },
                  ]}
                />
              ) : (
                <p className="text-sm text-slate-400">No address on file.</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Lifecycle" />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  { label: 'Created', value: formatDateTime(t.createdAt) },
                  { label: 'Approved', value: t.approvedAt ? formatDateTime(t.approvedAt) : null },
                  { label: 'Activated', value: t.activatedAt ? formatDateTime(t.activatedAt) : null },
                  { label: 'Suspended', value: t.suspendedAt ? formatDateTime(t.suspendedAt) : null },
                  { label: 'Deactivated', value: t.deactivatedAt ? formatDateTime(t.deactivatedAt) : null },
                  { label: 'Last updated', value: formatDateTime(t.updatedAt) },
                ]}
              />
            </CardBody>
          </Card>
        </div>
      )}

      {tab === 'settings' && <TenantSettingsCard tenantId={t.id} settings={t.settings} canEdit={hasPermission('platform.tenant.edit')} />}

      {tab === 'history' && (
        <Card className="overflow-hidden">
          <CardHeader title="Status history" description="Every transition with who did it and why." />
          {t.history.length === 0 ? (
            <EmptyState icon={History} title="No history" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {[...t.history].reverse().map((h) => (
                <li key={h.id} className="px-5 py-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    {h.fromStatus ? <StatusBadge status={h.fromStatus} dot={false} /> : <Badge tone="gray">New</Badge>}
                    <span className="text-slate-400">-&gt;</span>
                    <StatusBadge status={h.toStatus} />
                    {h.reason && <span className="text-sm text-slate-600">{h.reason}</span>}
                  </div>
                  <div className="text-xs text-slate-500 text-right">
                    <p>{h.actorName ?? 'system'}</p>
                    <p className="tabular">{formatDateTime(h.occurredAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <TenantEditModal tenant={t} open={editOpen} onClose={() => setEditOpen(false)} />

      <ReasonDialog
        open={Boolean(pending)}
        onClose={() => { setPending(null); setDialogError(null); }}
        onConfirm={(v) => void runCommand(v)}
        loading={transition.isPending}
        title={pending?.title ?? ''}
        confirmLabel={pending?.label}
        tone={pending?.tone}
        reasonRequired={pending?.input === 'reason'}
        reasonLabel={pending?.input === 'note' ? 'Note' : 'Reason'}
        confirmCode={pending?.confirmCode ? t.code : undefined}
        error={dialogError}
        message={
          pending && (
            <>
              <strong>{t.displayName}</strong> ({t.code}). {pending.message}
            </>
          )
        }
      />

      <ConfirmDialog
        open={resendOpen}
        onClose={() => setResendOpen(false)}
        onConfirm={() => void doResend()}
        loading={resend.isPending}
        tone="primary"
        title="Resend owner invite?"
        confirmLabel="Resend"
        message={
          <>
            A fresh invitation email goes to <strong>{t.ownerEmail}</strong>. Earlier links keep working until they expire.
          </>
        }
      />
    </>
  );
}
