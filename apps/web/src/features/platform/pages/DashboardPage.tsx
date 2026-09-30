import { useNavigate } from 'react-router-dom';
import { ArrowRight, Clock, Inbox } from 'lucide-react';
import { ActivityTimeline, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, Stat, StatGrid, StatusBadge, type ActivityItem } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { formatDateTime, humanize } from '../../../lib/utils';
import { useDashboard } from '../hooks';
import { TENANT_STATUSES, type Dashboard, type TenantStatus } from '../types';

const TONE: Record<TenantStatus, 'default' | 'green' | 'amber' | 'red' | 'blue'> = { PENDING: 'amber', APPROVED: 'blue', ACTIVE: 'green', SUSPENDED: 'amber', DEACTIVATED: 'default', REJECTED: 'red' };

function toItem(a: Dashboard['recentActions'][number], i: number): ActivityItem {
  return {
    id: `${a.tenantId}-${a.occurredAt}-${i}`,
    action: `TENANT_${a.toStatus}`,
    userName: a.actorName,
    summary: `${a.displayName} (${a.code}): ${a.fromStatus ? humanize(a.fromStatus) : 'New'} -> ${humanize(a.toStatus)}${a.reason ? ` - Reason: ${a.reason}` : ''}`,
    oldValue: a.fromStatus ? { status: a.fromStatus } : null,
    newValue: { status: a.toStatus },
    createdAt: a.occurredAt,
  };
}

export function DashboardPage() {
  const navigate = useNavigate();
  const query = useDashboard();
  const d = query.data;
  const error = query.isError ? toApiError(query.error).message : null;

  return (
    <>
      <PageHeader title="Platform Dashboard" subtitle="Tenant lifecycle at a glance. Counts refresh every minute." />

      {error && !d ? (
        <Card>
          <ErrorState title="Could not load the dashboard" message={error} onRetry={() => void query.refetch()} />
        </Card>
      ) : (
        <>
          <StatGrid className="md:grid-cols-3 xl:grid-cols-6">
            {TENANT_STATUSES.map((s) => (
              <Stat key={s} label={humanize(s)} value={d ? d.counts[s] ?? 0 : '-'} tone={TONE[s]} loading={query.isLoading} onClick={() => navigate(`/admin/tenants?status=${s}`)} hint="Open list" />
            ))}
          </StatGrid>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4 items-start">
            <Card className="overflow-hidden">
              <CardHeader title="Pending approvals" description="Oldest first. Applications wait here until a reviewer approves or rejects them." actions={<Button variant="ghost" size="sm" iconRight={ArrowRight} onClick={() => navigate('/admin/tenants?status=PENDING')}>All pending</Button>} />
              {query.isLoading ? (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : (d?.pendingApprovals ?? []).length === 0 ? (
                <EmptyState icon={Inbox} title="Nothing to approve" hint="New applications and admin-created tenants appear here." />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {(d?.pendingApprovals ?? []).map((p) => (
                    <li key={p.id} className="px-5 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 truncate">{p.displayName}</p>
                        <p className="text-xs text-slate-500 font-mono">{p.code}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className={`inline-flex items-center gap-1 text-xs tabular ${p.ageHours >= 48 ? 'text-red-600' : p.ageHours >= 24 ? 'text-amber-700' : 'text-slate-500'}`} title={formatDateTime(p.createdAt)}>
                          <Clock className="w-3.5 h-3.5" /> {p.ageHours}h
                        </span>
                        <StatusBadge status="PENDING" />
                        <Button size="xs" variant="secondary" onClick={() => navigate(`/admin/tenants/${p.id}`)}>
                          Open
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader title="Recent actions" description="Last 20 status changes across all tenants." />
              <CardBody>
                {query.isLoading ? (
                  <div className="space-y-4">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-10 w-full" />
                    ))}
                  </div>
                ) : (
                  <ActivityTimeline items={(d?.recentActions ?? []).map(toItem)} tones={{ TENANT_ACTIVE: 'bg-emerald-500', TENANT_APPROVED: 'bg-brand-600', TENANT_PENDING: 'bg-amber-500', TENANT_SUSPENDED: 'bg-amber-500', TENANT_REJECTED: 'bg-red-500', TENANT_DEACTIVATED: 'bg-slate-500' }} />
                )}
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
