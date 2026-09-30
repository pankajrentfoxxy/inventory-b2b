import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertTriangle, Check, Send, XCircle } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, DescriptionList, DetailSkeleton, ErrorState, PageHeader, ReasonDialog, StatusBadge } from '../../../components/ui';
import { toApiError, type ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatDateTime, formatMoney, humanize } from '../../../lib/utils';
import { SignedQty } from '../components/SignedQty';
import { describeInventoryError } from '../components/errors';
import { useAdjustment, useApproveAdjustment, useCancelAdjustment, useProductRefs, useSubmitAdjustment, useWarehouseMaps } from '../hooks';
import type { Adjustment } from '../types';

interface LineProblem {
  lineNo: number | null;
  message: string;
}

/** INSUFFICIENT_STOCK names item/bucket/bin in its detail; map that back to the adjustment line. */
function problemFrom(e: ApiError, adj: Adjustment): LineProblem {
  const d = e.details[0] as (Record<string, unknown> & { message?: string }) | undefined;
  if (e.code === 'INSUFFICIENT_STOCK' && d) {
    const line = adj.lines.find((l) => l.itemId === d.itemId && l.bucket === d.bucket && (l.binId ?? null) === ((d.binId as string | null) ?? null));
    return { lineNo: line?.lineNo ?? null, message: describeInventoryError(e) };
  }
  return { lineNo: null, message: describeInventoryError(e) };
}

export function AdjustmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission, session } = useAuth();
  const query = useAdjustment(id);
  const maps = useWarehouseMaps();
  const adj = query.data;
  const items = useProductRefs(adj?.lines.map((l) => l.itemId) ?? []);
  const submit = useSubmitAdjustment();
  const approve = useApproveAdjustment();
  const cancel = useCancelAdjustment();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [problem, setProblem] = useState<LineProblem | null>(null);

  const crumbs = [{ label: 'Inventory' }, { label: 'Adjustments', to: '/inventory/adjustments' }, { label: adj?.number ?? '...' }];

  if (query.isLoading) {
    return (
      <>
        <PageHeader title="Adjustment" breadcrumbs={crumbs} />
        <DetailSkeleton />
      </>
    );
  }
  if (query.isError || !adj) {
    const e = toApiError(query.error);
    return (
      <>
        <PageHeader title="Adjustment" breadcrumbs={crumbs} />
        <Card>
          <ErrorState title={e.status === 404 ? 'Adjustment not found' : 'Could not load adjustment'} message={e.message} onRetry={() => void query.refetch()} />
        </Card>
      </>
    );
  }

  const me = session?.user.id ?? null;
  const raisedByMe = Boolean(me && (adj.submittedBy === me || adj.createdBy === me));
  const canSubmit = adj.status === 'DRAFT' && hasPermission('inventory.adjust');
  const canApprove = adj.status === 'PENDING_APPROVAL' && hasPermission('inventory.adjust.approve');
  const canCancel = (adj.status === 'DRAFT' || adj.status === 'PENDING_APPROVAL') && hasPermission('inventory.adjust');
  const busy = submit.isPending || approve.isPending || cancel.isPending;

  const run = async (action: 'submit' | 'approve') => {
    setProblem(null);
    try {
      const result = action === 'submit' ? await submit.mutateAsync(adj.id) : await approve.mutateAsync(adj.id);
      toast.success(result.status === 'POSTED' ? `${result.number} posted to inventory` : `${result.number} submitted for approval`);
    } catch (err) {
      const e = toApiError(err);
      const p = problemFrom(e, adj);
      setProblem(p);
      toast.error(p.message);
    }
  };
  const doCancel = async ({ reason }: { reason: string }) => {
    try {
      await cancel.mutateAsync({ id: adj.id, reason: reason || undefined });
      toast.success(`${adj.number} cancelled`);
      setCancelOpen(false);
    } catch (err) {
      toast.error(describeInventoryError(toApiError(err)));
    }
  };

  const ledgerLink = `/inventory/ledger?refType=ADJUSTMENT&warehouseId=${adj.warehouseId}`;
  const th = 'px-4 py-2 text-[11px] uppercase tracking-wider text-slate-500 font-semibold';

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="font-mono">{adj.number}</span>
            <StatusBadge status={adj.status} />
          </span>
        }
        subtitle={`${humanize(adj.reasonCode)} - ${maps.warehouseLabel(adj.warehouseId)} - created ${formatDateTime(adj.createdAt)}`}
        breadcrumbs={crumbs}
        actions={
          <>
            {canSubmit && <Button icon={Send} onClick={() => void run('submit')} loading={submit.isPending} disabled={busy}>Submit</Button>}
            {canApprove && (
              <Button icon={Check} onClick={() => void run('approve')} loading={approve.isPending} disabled={busy || raisedByMe} title={raisedByMe ? 'You raised this adjustment; someone else must approve it' : undefined}>
                Approve
              </Button>
            )}
            {canCancel && <Button variant="dangerOutline" icon={XCircle} onClick={() => setCancelOpen(true)} disabled={busy}>Cancel</Button>}
          </>
        }
      />

      {adj.status === 'PENDING_APPROVAL' && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            This adjustment is worth {formatMoney(adj.totalValue)} and needs approval before it posts. {raisedByMe ? 'You raised it, so another approver has to sign it off.' : 'The person who raised it cannot approve it.'}
          </span>
        </div>
      )}
      {problem && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex gap-2" role="alert">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            {problem.lineNo !== null && <strong>Line {problem.lineNo}: </strong>}
            {problem.message}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2 overflow-hidden">
          <CardHeader title="Lines" description={`${adj.lines.length} line${adj.lines.length === 1 ? '' : 's'}`} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm border-collapse">
              <thead className="border-b border-slate-200 bg-slate-50/60">
                <tr>
                  <th className={`${th} text-left w-10`}>#</th>
                  <th className={`${th} text-left`}>Item</th>
                  <th className={`${th} text-left`}>Bucket</th>
                  <th className={`${th} text-left`}>Bin</th>
                  <th className={`${th} text-right`}>Qty change</th>
                  <th className={`${th} text-right`}>Unit cost</th>
                  <th className={`${th} text-left`}>Serials</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {adj.lines.map((l) => {
                  const flagged = problem?.lineNo === l.lineNo;
                  return (
                    <tr key={l.id} className={flagged ? 'bg-red-50/60' : undefined}>
                      <td className="px-4 py-3 tabular text-slate-500">{l.lineNo}</td>
                      <td className="px-4 py-3">
                        <Link to={`/inventory/stock/${l.itemId}`} className="font-medium text-slate-900 hover:text-brand-700">{items.label(l.itemId)}</Link>
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={l.bucket} dot={false} /></td>
                      <td className="px-4 py-3 font-mono text-[13px]">{maps.binLabel(l.binId)}</td>
                      <td className="px-4 py-3 text-right"><SignedQty value={l.qtyDelta} /></td>
                      <td className="px-4 py-3 text-right tabular text-slate-600">{l.unitCost === null ? <span className="text-slate-400">avg</span> : formatMoney(l.unitCost)}</td>
                      <td className="px-4 py-3">
                        {l.serialNumbers.length ? (
                          <details>
                            <summary className="cursor-pointer text-xs text-brand-700">{l.serialNumbers.length} serial{l.serialNumbers.length === 1 ? '' : 's'}</summary>
                            <p className="font-mono text-xs text-slate-600 mt-1 break-all">{l.serialNumbers.join(', ')}</p>
                          </details>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50/60">
                  <td colSpan={5} className="px-4 py-2.5 text-right text-sm font-medium text-slate-700">Adjustment value</td>
                  <td colSpan={2} className="px-4 py-2.5 text-right text-sm text-slate-700">
                    {adj.status === 'DRAFT' ? <span className="text-slate-400">Calculated on submit</span> : <span className="font-semibold text-slate-900 tabular">{formatMoney(adj.totalValue)}</span>}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  { label: 'Warehouse', value: maps.warehouseLabel(adj.warehouseId) },
                  { label: 'Reason', value: humanize(adj.reasonCode) },
                  { label: 'Notes', value: adj.notes },
                  { label: 'Status', value: <StatusBadge status={adj.status} /> },
                  { label: 'Cancellation reason', value: adj.status === 'CANCELLED' ? adj.statusReason : undefined },
                  { label: 'Value', value: adj.status === 'DRAFT' ? null : formatMoney(adj.totalValue) },
                  { label: 'Created', value: formatDateTime(adj.createdAt) },
                  { label: 'Posted', value: adj.postedAt ? formatDateTime(adj.postedAt) : null },
                  { label: 'Approved by', value: adj.approvedBy ? (adj.approvedBy === me ? 'You' : `${adj.approvedBy.slice(0, 8)}...`) : null },
                  { label: 'Version', value: String(adj.version), mono: true },
                ].filter((i) => i.value !== undefined)}
              />
            </CardBody>
          </Card>
          {adj.postingIds.length > 0 && (
            <Card>
              <CardHeader title="Postings" description="Ledger entries created when this adjustment posted." />
              <CardBody className="space-y-2">
                {adj.postingIds.map((p) => (
                  <Link key={p} to={ledgerLink} className="block font-mono text-[13px] text-brand-700 hover:underline break-all">
                    {p}
                  </Link>
                ))}
                <Link to={ledgerLink} className="block text-sm text-brand-700 hover:underline">Open the ledger for adjustments in this warehouse</Link>
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      <ReasonDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={(input) => void doCancel(input)}
        loading={cancel.isPending}
        title={`Cancel ${adj.number}?`}
        message="The adjustment is kept for audit but will never post to inventory."
        confirmLabel="Cancel adjustment"
        reasonRequired={false}
      />
    </>
  );
}
