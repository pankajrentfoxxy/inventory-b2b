import { useEffect, useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, RefreshCw, ShieldAlert } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Field, FormSkeleton, Input, PageHeader, StatusBadge } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatDateTime, formatMoney, formatQty } from '../../../lib/utils';
import { useInventorySettings, useProductRefs, useReconciliation, useUpdateInventorySettings, useWarehouseMaps } from '../hooks';
import type { Reconciliation } from '../types';

function SettingsCard() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('inventory.adjust.approve');
  const query = useInventorySettings();
  const update = useUpdateInventorySettings();
  const [threshold, setThreshold] = useState('');
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (query.data) setThreshold(String(query.data.adjustmentApprovalThreshold));
  }, [query.data]);

  const dirty = query.data ? threshold !== String(query.data.adjustmentApprovalThreshold) : false;
  const save = async () => {
    setError(undefined);
    try {
      const saved = await update.mutateAsync({ adjustmentApprovalThreshold: threshold === '' ? 0 : Number(threshold) });
      toast.success(`Approval threshold set to ${formatMoney(saved.adjustmentApprovalThreshold)}`);
    } catch (err) {
      const e = toApiError(err);
      setError(e.fieldErrors.adjustmentApprovalThreshold ?? e.message);
      toast.error(e.message);
    }
  };

  return (
    <Card>
      <CardHeader title="Adjustments" description="Adjustments whose value reaches the threshold wait for approval by someone other than the person who raised them." />
      <CardBody>
        {query.isLoading ? (
          <FormSkeleton />
        ) : query.isError ? (
          <ErrorState message={toApiError(query.error).message} onRetry={() => void query.refetch()} />
        ) : (
          <div className="space-y-4 max-w-md">
            <Field label="Approval threshold" required hint="0 means every adjustment needs approval" error={error} htmlFor="inv-threshold">
              <Input id="inv-threshold" sanitize="decimal" prefix="INR" value={threshold} onChange={(e) => setThreshold(e.target.value)} disabled={!canEdit} error={Boolean(error)} className="text-right tabular" />
            </Field>
            <p className="text-xs text-slate-500">Current: {formatMoney(query.data?.adjustmentApprovalThreshold ?? null)}</p>
            {canEdit ? (
              <div className="flex items-center gap-2">
                <Button onClick={() => void save()} loading={update.isPending} disabled={!dirty}>Save</Button>
                {dirty && <Button variant="ghost" onClick={() => setThreshold(String(query.data?.adjustmentApprovalThreshold ?? ''))}>Reset</Button>}
              </div>
            ) : (
              <p className="text-xs text-slate-500">Only members with the approve-adjustments permission can change this.</p>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function MismatchTable<T extends { itemId: string }>({ title, rows, columns }: { title: string; rows: T[]; columns: { header: string; render: (r: T) => ReactNode; align?: 'right' }[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
        <Badge tone="red">{rows.length}</Badge>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/60 border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              {columns.map((c) => (
                <th key={c.header} className={`px-3 py-2 font-semibold ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.header} className={`px-3 py-2 ${c.align === 'right' ? 'text-right tabular' : ''}`}>{c.render(r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReconciliationBody({ data }: { data: Reconciliation }) {
  const maps = useWarehouseMaps();
  const items = useProductRefs([...data.ledgerMismatches, ...data.unbalancedPostings, ...data.serialMismatches, ...data.negativeBalances].map((r) => r.itemId));
  if (data.ok) {
    return (
      <EmptyState icon={CheckCircle2} title="Ledger, balances and serials agree" hint={`Checked ${formatDateTime(data.checkedAt)}.`} />
    );
  }
  const item = (id: string) => <span className="text-slate-800">{items.label(id)}</span>;
  return (
    <div className="space-y-6">
      <p className="text-xs text-slate-500">Checked {formatDateTime(data.checkedAt)}. Mismatches usually mean a posting failed half-way; share the posting ids with support.</p>
      <MismatchTable
        title="Ledger vs balances"
        rows={data.ledgerMismatches}
        columns={[
          { header: 'Item', render: (r) => item(r.itemId) },
          { header: 'Warehouse', render: (r) => maps.warehouseLabel(r.warehouseId) },
          { header: 'Bin', render: (r) => <span className="font-mono text-[13px]">{maps.binLabel(r.binId)}</span> },
          { header: 'Bucket', render: (r) => <StatusBadge status={r.bucket} dot={false} /> },
          { header: 'Ledger', align: 'right', render: (r) => formatQty(r.ledgerQty) },
          { header: 'Balance', align: 'right', render: (r) => formatQty(r.balanceQty) },
        ]}
      />
      <MismatchTable
        title="Unbalanced postings"
        rows={data.unbalancedPostings}
        columns={[
          { header: 'Posting', render: (r) => <span className="font-mono text-[13px]">{r.postingId}</span> },
          { header: 'Item', render: (r) => item(r.itemId) },
          { header: 'Sum', align: 'right', render: (r) => formatQty(r.sum) },
        ]}
      />
      <MismatchTable
        title="Serial counts vs balances"
        rows={data.serialMismatches}
        columns={[
          { header: 'Item', render: (r) => item(r.itemId) },
          { header: 'Warehouse', render: (r) => maps.warehouseLabel(r.warehouseId) },
          { header: 'Bin', render: (r) => <span className="font-mono text-[13px]">{maps.binLabel(r.binId)}</span> },
          { header: 'Bucket', render: (r) => <StatusBadge status={r.bucket} dot={false} /> },
          { header: 'Serials', align: 'right', render: (r) => formatQty(r.serialCount) },
          { header: 'Balance', align: 'right', render: (r) => formatQty(r.balanceQty) },
        ]}
      />
      <MismatchTable
        title="Negative balances"
        rows={data.negativeBalances}
        columns={[
          { header: 'Item', render: (r) => item(r.itemId) },
          { header: 'Warehouse', render: (r) => maps.warehouseLabel(r.warehouseId) },
          { header: 'Bucket', render: (r) => <StatusBadge status={r.bucket} dot={false} /> },
          { header: 'Qty', align: 'right', render: (r) => <span className="text-red-600">{formatQty(r.qty)}</span> },
        ]}
      />
    </div>
  );
}

function ReconciliationCard() {
  const [requested, setRequested] = useState(false);
  const query = useReconciliation(requested);
  const run = () => {
    if (requested) void query.refetch();
    else setRequested(true);
  };
  return (
    <Card>
      <CardHeader
        title="Reconciliation"
        description="Compares the movement ledger with stock balances and serial counts for this organisation."
        actions={
          <div className="flex items-center gap-2">
            {query.data && (query.data.ok ? <Badge tone="green" dot>OK</Badge> : <Badge tone="red" dot>Mismatches</Badge>)}
            <Button size="sm" variant="secondary" icon={RefreshCw} onClick={run} loading={query.isFetching}>
              {query.data ? 'Run again' : 'Run'}
            </Button>
          </div>
        }
      />
      <CardBody>
        {!requested ? (
          <EmptyState icon={ShieldAlert} title="Not run yet" hint="The check reads every balance row; run it after a failed posting or before period close." action={<Button size="sm" onClick={run}>Run reconciliation</Button>} />
        ) : query.isLoading ? (
          <FormSkeleton />
        ) : query.isError ? (
          <ErrorState message={toApiError(query.error).message} onRetry={() => void query.refetch()} />
        ) : query.data ? (
          <ReconciliationBody data={query.data} />
        ) : null}
      </CardBody>
    </Card>
  );
}

export function InventorySettingsPage() {
  const { hasPermission } = useAuth();
  return (
    <>
      <PageHeader title="Inventory settings" breadcrumbs={[{ label: 'Settings' }, { label: 'Inventory' }]} />
      <div className="space-y-5">
        <SettingsCard />
        {hasPermission('inventory.adjust.approve') && <ReconciliationCard />}
      </div>
    </>
  );
}
