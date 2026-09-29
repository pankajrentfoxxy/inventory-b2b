import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { XCircle } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, DataTable, DescriptionList, DetailSkeleton, ErrorState, PageHeader, Textarea, type Column } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { usePermission } from '../../../lib/auth';
import { formatDate, formatDateTime, formatQty } from '../../../lib/utils';
import { ReceiveStatusBadge } from '../../purchase-orders/components/PoStatusBadge';
import { useCancelPurchaseReceive, usePurchaseReceive } from '../hooks';
import type { ReceiveLine } from '../types';

export function PurchaseReceiveDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const perms = usePermission();
  const q = usePurchaseReceive(id);
  const cancel = useCancelPurchaseReceive();
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState('');

  if (q.isLoading) return <DetailSkeleton />;
  if (q.isError || !q.data) {
    const err = toApiError(q.error);
    return (
      <>
        <PageHeader title="Purchase Receive" breadcrumbs={[{ label: 'Purchases' }, { label: 'Purchase Receives', to: '/purchases/purchase-receives' }]} />
        <Card><ErrorState title={err.status === 404 ? 'Purchase receive not found' : 'Could not load purchase receive'} message={err.message} onRetry={err.status === 404 ? undefined : () => void q.refetch()} /></Card>
      </>
    );
  }
  const r = q.data;

  const columns: Column<ReceiveLine>[] = [
    { key: 'item', header: 'Item Details', render: (l) => <div><p className="font-medium text-slate-900">{l.name}</p>{l.sku && <p className="text-xs font-mono text-slate-500">{l.sku}</p>}</div> },
    { key: 'ordered', header: 'Ordered', align: 'right', render: (l) => <span className="tabular">{formatQty(l.orderedQuantity)} {l.unit ?? ''}</span> },
    { key: 'qty', header: 'Received in this GRN', align: 'right', render: (l) => <span className="tabular font-semibold text-slate-900">{formatQty(l.quantity)}</span> },
    { key: 'todate', header: 'Received to Date', align: 'right', hideBelow: 'md', render: (l) => <span className="tabular text-emerald-700">{formatQty(l.receivedToDate)}</span> },
  ];

  const doCancel = async () => {
    try {
      await cancel.mutateAsync({ id: r.id, reason: reason || undefined });
      toast.success(`${r.receiveNumber} cancelled`);
    } catch (err) {
      toast.error(toApiError(err).message);
    } finally {
      setConfirm(false);
    }
  };

  return (
    <>
      <PageHeader
        title={<span className="inline-flex items-center gap-3"><span className="font-mono">{r.receiveNumber}</span><ReceiveStatusBadge status={r.status} /></span>}
        subtitle={<span>Against <Link to={`/purchases/purchase-orders/${r.purchaseOrder.id}`} className="text-brand-700 hover:underline font-mono">{r.purchaseOrder.purchaseOrderNumber}</Link> from {r.vendor.displayName}</span>}
        breadcrumbs={[{ label: 'Purchases' }, { label: 'Purchase Receives', to: '/purchases/purchase-receives' }, { label: r.receiveNumber }]}
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate(`/purchases/purchase-orders/${r.purchaseOrder.id}`)}>View Purchase Order</Button>
            {perms.canCancelReceive && r.status === 'RECEIVED' && <Button variant="dangerOutline" icon={XCircle} onClick={() => setConfirm(true)}>Cancel Receive</Button>}
          </>
        }
      >
        {r.status === 'CANCELLED' && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">This receive was cancelled{r.cancelReason ? `: ${r.cancelReason}` : ''}. Quantities were reversed on the purchase order.</div>}
      </PageHeader>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          <Card className="overflow-hidden">
            <CardHeader title="Received Items" description={`${formatQty(r.totalQuantity)} units in total`} />
            <DataTable columns={columns} rows={r.lines} rowKey={(l) => l.id} dense />
          </Card>
          {r.notes && (
            <Card><CardHeader title="Notes" /><CardBody><p className="text-sm text-slate-800 whitespace-pre-wrap">{r.notes}</p></CardBody></Card>
          )}
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DescriptionList columns={1} items={[
                { label: 'Received Date', value: formatDate(r.receivedDate) },
                { label: 'Vendor', value: <Link to={`/purchases/vendors/${r.vendor.id}`} className="text-brand-700 hover:underline">{r.vendor.displayName}</Link> },
                { label: 'Location', value: r.location?.name ?? null },
                { label: 'Recorded by', value: r.createdByName },
                { label: 'Recorded at', value: formatDateTime(r.createdAt) },
                ...(r.cancelledAt ? [{ label: 'Cancelled at', value: formatDateTime(r.cancelledAt) }] : []),
              ]} />
            </CardBody>
          </Card>
        </div>
      </div>

      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => void doCancel()} loading={cancel.isPending} title="Cancel this purchase receive?" confirmLabel="Cancel Receive" message={<div className="space-y-3"><p>The received quantities will be reversed on <strong>{r.purchaseOrder.purchaseOrderNumber}</strong> and its status re-derived.</p><Textarea rows={2} placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} /></div>} />
    </>
  );
}
