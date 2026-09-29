import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ChevronDown, Lock, PackageCheck, Pencil, RotateCcw, Send, Trash2, XCircle } from 'lucide-react';
import { PURCHASE_ORDER_EDITABLE_STATUSES, PURCHASE_ORDER_RECEIVABLE_STATUSES } from '@b2b/shared';
import { ActivityTimeline, Button, Card, CardBody, CardHeader, ConfirmDialog, DataTable, DescriptionList, DetailSkeleton, Dropdown, EmptyState, ErrorState, PageHeader, Skeleton, Tabs, Textarea, type Column } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { usePermission } from '../../../lib/auth';
import { formatDate, formatDateTime, formatMoney, formatQty } from '../../../lib/utils';
import { usePurchaseOrder, usePurchaseOrderAction, usePurchaseOrderActivity } from '../hooks';
import type { PoDetail, PoLine } from '../types';
import { formatAddress } from '../form/poForm.model';
import { PoStatusBadge, ReceiveStateText, ReceiveStatusBadge } from '../components/PoStatusBadge';
import { PoAttachments } from '../components/PoAttachments';

type Tab = 'overview' | 'receives' | 'attachments' | 'activity';

function AddressCard({ title, name, address, extra }: { title: string; name?: string | null; address: Parameters<typeof formatAddress>[0]; extra?: React.ReactNode }) {
  const lines = formatAddress(address);
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">{title}</p>
      {name && <p className="text-sm font-semibold text-slate-900">{name}</p>}
      {lines.length === 0 ? <p className="text-sm text-slate-400">No address on file</p> : lines.map((l, i) => <p key={i} className="text-sm text-slate-700">{l}</p>)}
      {extra}
    </div>
  );
}

function Overview({ po }: { po: PoDetail }) {
  const columns: Column<PoLine>[] = [
    { key: 'n', header: '#', width: '40px', render: (l) => <span className="text-slate-500 tabular">{l.lineNumber}</span> },
    {
      key: 'item',
      header: 'Item & Description',
      render: (l) => (
        <div>
          <p className="font-medium text-slate-900">
            {l.item ? <Link to="/items" className="hover:text-brand-700">{l.name}</Link> : l.name}
            {l.sku && <span className="ml-2 text-xs font-mono text-slate-500">{l.sku}</span>}
          </p>
          {l.description && <p className="text-xs text-slate-500 whitespace-pre-wrap">{l.description}</p>}
          {l.hsnCode && <p className="text-[11px] text-slate-400 font-mono">HSN/SAC {l.hsnCode}</p>}
        </div>
      ),
    },
    { key: 'ordered', header: 'Ordered', align: 'right', render: (l) => <span className="tabular">{formatQty(l.quantity)} {l.unit ?? ''}</span> },
    { key: 'received', header: 'Received', align: 'right', hideBelow: 'md', render: (l) => <span className={l.receivedQuantity > 0 ? 'tabular text-emerald-700' : 'tabular text-slate-400'}>{formatQty(l.receivedQuantity)}</span> },
    { key: 'rate', header: 'Rate', align: 'right', render: (l) => <span className="tabular">{formatMoney(l.rate, po.currencyCode)}</span> },
    { key: 'tax', header: 'Tax', align: 'right', hideBelow: 'md', render: (l) => <span className="text-slate-600 text-xs">{l.taxName ? `${l.taxName} (${l.taxRate}%)` : '-'}</span> },
    { key: 'amount', header: 'Amount', align: 'right', render: (l) => <span className="tabular font-medium">{formatMoney(l.amount, po.currencyCode)}</span> },
  ];

  const totalsRow = (label: string, value: string, strong = false) => (
    <div className={`flex justify-between gap-6 py-1.5 ${strong ? 'border-t border-slate-200 mt-1 pt-3 text-base font-semibold text-slate-900' : 'text-sm text-slate-700'}`}>
      <span>{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2 space-y-4">
        <Card>
          <CardBody className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <AddressCard
                title="Vendor Address"
                name={po.vendor.companyName ?? po.vendor.displayName}
                address={po.vendor.billingAddress}
                extra={
                  <div className="text-xs text-slate-500 mt-1 space-y-0.5">
                    <p>
                      <Link to={`/purchases/vendors/${po.vendor.id}`} className="text-brand-700 hover:underline">{po.vendor.displayName}</Link>
                      {po.vendor.status === 'INACTIVE' && <span className="ml-2 text-amber-700">(inactive)</span>}
                    </p>
                    {po.vendor.gstin && <p className="font-mono">GSTIN {po.vendor.gstin}</p>}
                    {po.vendor.sourceOfSupply && <p>Source of supply: {po.vendor.sourceOfSupply.name} ({po.vendor.sourceOfSupply.code})</p>}
                  </div>
                }
              />
              <AddressCard title="Deliver To" name={po.deliveryAddress?.name ?? po.deliveryLocation?.name ?? null} address={po.deliveryAddress} extra={<p className="text-xs text-slate-500 mt-1">Source of supply: {po.sourceOfSupplyCode ?? '-'} &middot; Destination: {po.placeOfSupplyCode ?? '-'} &middot; {po.isIntraState ? 'Intra-state (CGST + SGST)' : 'Inter-state (IGST)'}</p>} />
            </div>
            <DescriptionList
              columns={3}
              items={[
                { label: 'Order Date', value: formatDate(po.orderDate) },
                { label: 'Expected Delivery', value: po.expectedDeliveryDate ? formatDate(po.expectedDeliveryDate) : null },
                { label: 'Reference#', value: po.referenceNumber },
                { label: 'Payment Terms', value: po.paymentTerm?.name ?? null },
                { label: 'Shipment Preference', value: po.shipmentPreference },
                { label: 'Location', value: po.location?.name ?? null },
              ]}
            />
          </CardBody>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Items" description={`${po.lines.length} line${po.lines.length === 1 ? '' : 's'}`} />
          <DataTable columns={columns} rows={po.lines} rowKey={(l) => l.id} dense />
          <div className="px-5 py-4 border-t border-slate-100 flex justify-end">
            <div className="w-full max-w-sm">
              {totalsRow('Sub Total', formatMoney(po.subTotal, po.currencyCode))}
              {po.discountAmount > 0 && totalsRow(`Discount${po.discountType === 'PERCENT' ? ` (${po.discountValue}%)` : ''}`, `- ${formatMoney(po.discountAmount, po.currencyCode)}`)}
              {po.taxBreakup.map((b, i) => (
                <div key={`${b.label}-${b.rate}-${i}`}>{totalsRow(`${b.label} ${b.rate}%`, formatMoney(b.amount, po.currencyCode))}</div>
              ))}
              {po.taxDeductionType !== 'NONE' && totalsRow(`${po.taxDeductionType}${po.taxDeductionLabel ? ` - ${po.taxDeductionLabel}` : ''} (${po.taxDeductionRate}%)`, `${po.taxDeductionType === 'TDS' ? '- ' : '+ '}${formatMoney(po.taxDeductionAmount, po.currencyCode)}`)}
              {po.adjustment !== 0 && totalsRow(po.adjustmentLabel ?? 'Adjustment', formatMoney(po.adjustment, po.currencyCode))}
              {totalsRow('Total', formatMoney(po.total, po.currencyCode), true)}
            </div>
          </div>
        </Card>

        {(po.notes || po.terms) && (
          <Card>
            <CardBody className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Notes</p>
                <p className="text-sm text-slate-800 whitespace-pre-wrap">{po.notes ?? <span className="text-slate-400">None</span>}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Terms & Conditions</p>
                <p className="text-sm text-slate-800 whitespace-pre-wrap">{po.terms ?? <span className="text-slate-400">None</span>}</p>
              </div>
            </CardBody>
          </Card>
        )}
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader title="Receipt Progress" />
          <CardBody className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">Status</span>
              <ReceiveStateText state={po.receiveState} />
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${po.orderedQuantity ? Math.min(100, (po.receivedQuantity / po.orderedQuantity) * 100) : 0}%` }} />
            </div>
            <p className="text-xs text-slate-500 tabular">
              {formatQty(po.receivedQuantity)} of {formatQty(po.orderedQuantity)} units received across {po.counts.receives} receive{po.counts.receives === 1 ? '' : 's'}
            </p>
          </CardBody>
        </Card>
        {po.customFields.length > 0 && (
          <Card>
            <CardHeader title="Additional Fields" />
            <CardBody>
              <DescriptionList columns={1} items={po.customFields.map((cf) => ({ label: cf.label, value: cf.fieldType === 'BOOLEAN' ? (cf.value ? 'Yes' : 'No') : cf.fieldType === 'DATE' && typeof cf.value === 'string' ? formatDate(cf.value) : String(cf.value ?? '') }))} />
            </CardBody>
          </Card>
        )}
        <Card>
          <CardBody className="text-xs text-slate-500 space-y-1">
            <p>Created {formatDateTime(po.createdAt)}</p>
            {po.issuedAt && <p>Issued {formatDateTime(po.issuedAt)}</p>}
            {po.closedAt && <p>Closed {formatDateTime(po.closedAt)}</p>}
            {po.cancelledAt && <p>Cancelled {formatDateTime(po.cancelledAt)}{po.cancelReason ? `: ${po.cancelReason}` : ''}</p>}
            <p>Last modified {formatDateTime(po.updatedAt)}</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Activity({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const q = usePurchaseOrderActivity(id, page);
  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-4 w-56" /><Skeleton className="h-3 w-80" /><Skeleton className="h-4 w-48" /></div>;
  if (q.isError) return <ErrorState message={toApiError(q.error).message} onRetry={() => void q.refetch()} />;
  return <ActivityTimeline items={q.data!.data} pagination={q.data!.pagination} onPageChange={setPage} />;
}

export function PurchaseOrderDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const perms = usePermission();
  const q = usePurchaseOrder(id);
  const action = usePurchaseOrderAction();
  const [tab, setTab] = useState<Tab>('overview');
  const [confirm, setConfirm] = useState<'issue' | 'cancel' | 'close' | 'reopen' | 'delete' | null>(null);
  const [reason, setReason] = useState('');

  if (q.isLoading) return <DetailSkeleton />;
  if (q.isError || !q.data) {
    const err = toApiError(q.error);
    return (
      <>
        <PageHeader title="Purchase Order" breadcrumbs={[{ label: 'Purchases' }, { label: 'Purchase Orders', to: '/purchases/purchase-orders' }]} />
        <Card>
          <ErrorState title={err.status === 404 ? 'Purchase order not found' : 'Could not load purchase order'} message={err.status === 404 ? 'It may have been deleted, or it belongs to another organization.' : err.message} onRetry={err.status === 404 ? undefined : () => void q.refetch()} />
        </Card>
      </>
    );
  }
  const po = q.data;
  const canEdit = perms.canEditPurchaseOrder && PURCHASE_ORDER_EDITABLE_STATUSES.includes(po.status);
  const canReceive = perms.canCreateReceive && PURCHASE_ORDER_RECEIVABLE_STATUSES.includes(po.status);

  const run = async () => {
    if (!confirm) return;
    try {
      await action.mutateAsync({ id: po.id, action: confirm, reason: reason || undefined });
      const verb = { issue: 'issued', cancel: 'cancelled', close: 'closed', reopen: 'reopened', delete: 'deleted' }[confirm];
      toast.success(`${po.purchaseOrderNumber} ${verb}`);
      if (confirm === 'delete') navigate('/purchases/purchase-orders', { replace: true });
    } catch (err) {
      toast.error(toApiError(err).message);
    } finally {
      setConfirm(null);
      setReason('');
    }
  };

  const receiveColumns: Column<PoDetail['receives'][number]>[] = [
    { key: 'date', header: 'Date', render: (r) => <span className="tabular">{formatDate(r.receivedDate)}</span> },
    { key: 'number', header: 'Purchase Receive#', render: (r) => <Link to={`/purchases/purchase-receives/${r.id}`} className="font-mono text-[13px] text-brand-700 hover:underline">{r.receiveNumber}</Link> },
    { key: 'status', header: 'Status', render: (r) => <ReceiveStatusBadge status={r.status} /> },
    { key: 'qty', header: 'Quantity', align: 'right', render: (r) => <span className="tabular">{formatQty(r.totalQuantity)}</span> },
  ];

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            <span className="font-mono">{po.purchaseOrderNumber}</span>
            <PoStatusBadge status={po.status} />
          </span>
        }
        subtitle={<span>{po.vendor.displayName} &middot; {formatMoney(po.total, po.currencyCode)}</span>}
        breadcrumbs={[{ label: 'Purchases' }, { label: 'Purchase Orders', to: '/purchases/purchase-orders' }, { label: po.purchaseOrderNumber }]}
        actions={
          <>
            {canEdit && (
              <Button variant="secondary" icon={Pencil} onClick={() => navigate(`/purchases/purchase-orders/${po.id}/edit`)}>
                Edit
              </Button>
            )}
            {po.status === 'DRAFT' && perms.canIssuePurchaseOrder && (
              <Button icon={Send} onClick={() => setConfirm('issue')}>
                Mark as Issued
              </Button>
            )}
            {canReceive && (
              <Button icon={PackageCheck} onClick={() => navigate(`/purchases/purchase-receives/new?po=${po.id}`)}>
                Receive Goods
              </Button>
            )}
            <Dropdown
              trigger={({ toggle }) => (
                <Button variant="secondary" iconRight={ChevronDown} onClick={toggle}>
                  More
                </Button>
              )}
              items={[
                { key: 'close', label: 'Mark as Closed', icon: Lock, onSelect: () => setConfirm('close'), hidden: !perms.canIssuePurchaseOrder || !['ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(po.status) },
                { key: 'reopen', label: 'Reopen', icon: RotateCcw, onSelect: () => setConfirm('reopen'), hidden: !perms.canIssuePurchaseOrder || !['CLOSED', 'CANCELLED'].includes(po.status) },
                { key: 'vendor', label: 'View Vendor', icon: Pencil, onSelect: () => navigate(`/purchases/vendors/${po.vendor.id}`) },
                { key: 'cancel', label: 'Cancel Order', icon: XCircle, tone: 'danger', onSelect: () => setConfirm('cancel'), hidden: !perms.canCancelPurchaseOrder || !['DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED', 'CLOSED'].includes(po.status) || po.counts.receives > 0 },
                { key: 'delete', label: 'Delete', icon: Trash2, tone: 'danger', onSelect: () => setConfirm('delete'), hidden: !perms.canDeletePurchaseOrder || !['DRAFT', 'CANCELLED'].includes(po.status) || po.counts.receives > 0 },
              ]}
            />
          </>
        }
      >
        {po.status === 'DRAFT' && <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">This purchase order is a draft. Issue it to send it to the vendor and start receiving goods.</div>}
        {po.status === 'CANCELLED' && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">This purchase order was cancelled{po.cancelReason ? `: ${po.cancelReason}` : ''}.</div>}
        <Tabs className="mt-3" value={tab} onChange={setTab} tabs={[{ key: 'overview', label: 'Overview' }, { key: 'receives', label: 'Purchase Receives', count: po.counts.receives }, { key: 'attachments', label: 'Attachments', count: po.counts.documents }, { key: 'activity', label: 'Activity' }]} />
      </PageHeader>

      {tab === 'overview' && <Overview po={po} />}
      {tab === 'receives' && (
        <Card className="overflow-hidden">
          <CardHeader title="Purchase Receives" description="Goods received against this order." actions={canReceive && <Button size="sm" icon={PackageCheck} onClick={() => navigate(`/purchases/purchase-receives/new?po=${po.id}`)}>New Receive</Button>} />
          <DataTable columns={receiveColumns} rows={po.receives} rowKey={(r) => r.id} onRowClick={(r) => navigate(`/purchases/purchase-receives/${r.id}`)} empty={<EmptyState icon={PackageCheck} title="Nothing received yet" hint={PURCHASE_ORDER_RECEIVABLE_STATUSES.includes(po.status) ? 'Record a purchase receive when the goods arrive.' : 'Issue the order to start receiving goods against it.'} />} />
        </Card>
      )}
      {tab === 'attachments' && (
        <Card>
          <CardHeader title="Attachments" />
          <CardBody>
            <PoAttachments poId={po.id} pending={[]} onPendingChange={() => undefined} canEdit={perms.canEditPurchaseOrder} />
          </CardBody>
        </Card>
      )}
      {tab === 'activity' && (
        <Card>
          <CardHeader title="Activity" description="Every change to this purchase order, who made it and when." />
          <CardBody>
            <Activity id={po.id} />
          </CardBody>
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => void run()}
        loading={action.isPending}
        tone={confirm === 'issue' || confirm === 'reopen' || confirm === 'close' ? 'primary' : 'danger'}
        title={{ issue: 'Issue this purchase order?', cancel: 'Cancel this purchase order?', close: 'Close this purchase order?', reopen: 'Reopen this purchase order?', delete: 'Delete this purchase order?' }[confirm ?? 'issue']}
        confirmLabel={{ issue: 'Mark as Issued', cancel: 'Cancel Order', close: 'Close Order', reopen: 'Reopen', delete: 'Delete' }[confirm ?? 'issue']}
        message={
          <div className="space-y-3">
            <p>
              {confirm === 'issue' && <>Once issued, <strong>{po.purchaseOrderNumber}</strong> can be sent to {po.vendor.displayName} and goods can be received against it.</>}
              {confirm === 'cancel' && <>The order will be marked cancelled. It stays in the list for reference and can be reopened.</>}
              {confirm === 'close' && <>No further goods can be received against a closed order. Use this to short-close a partially received order.</>}
              {confirm === 'reopen' && <>The order becomes active again and receiving resumes where it left off.</>}
              {confirm === 'delete' && <>The order will be removed from lists. Its history is preserved in the audit log.</>}
            </p>
            {confirm === 'cancel' && <Textarea rows={2} placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />}
          </div>
        }
      />
    </>
  );
}
