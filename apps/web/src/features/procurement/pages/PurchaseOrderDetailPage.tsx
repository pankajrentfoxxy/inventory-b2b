import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ClipboardCheck, History, PackageCheck } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, DescriptionList, DetailSkeleton, EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge, Tabs, type Column } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { formatDate, formatDateTime, formatMoney, formatQty } from '../../../lib/utils';
import { LineSpecs } from '../components/LineSpecs';
import { PoActions } from '../components/PoActions';
import { PoTotals } from '../components/PoTotals';
import { ProgressBar } from '../components/ProgressBar';
import { RevisionDiff } from '../components/RevisionDiff';
import { AttachmentsCard } from '../components/AttachmentsCard';
import { usePoRevision, usePurchaseOrder, useScopedWarehouses } from '../hooks';
import type { PoLine, PurchaseOrderDetail } from '../types';

type Tab = 'overview' | 'approvals' | 'revisions' | 'receipts' | 'attachments';

function addressLines(a: Record<string, unknown> | null | undefined): string[] {
  if (!a) return [];
  const s = (k: string) => (typeof a[k] === 'string' && (a[k] as string).trim() ? (a[k] as string).trim() : null);
  return [s('attention'), s('line1'), s('line2'), [s('city'), s('state'), s('pincode')].filter(Boolean).join(', ') || null, s('phone') ? `Phone ${s('phone')}` : null].filter((x): x is string => Boolean(x));
}

function Overview({ po }: { po: PurchaseOrderDetail }) {
  const columns: Column<PoLine>[] = [
    { key: 'n', header: '#', width: '40px', render: (l) => <span className="text-slate-500 tabular">{l.lineNo}</span> },
    {
      key: 'item',
      header: 'Laptop (SKU)',
      render: (l) => (
        <div className="min-w-[220px] max-w-[440px]">
          <p className="font-mono text-[13px] font-semibold text-slate-900">{l.item.sku}</p>
          <p className="text-sm text-slate-700">{l.item.name}</p>
          {l.item.hsnCode || l.item.isSerialized ? (
            <p className="text-[11px] text-slate-500">
              {[l.item.hsnCode ? `HSN ${l.item.hsnCode}` : null, l.item.isSerialized ? 'serialized' : null].filter(Boolean).join(' - ')}
            </p>
          ) : null}
          <LineSpecs specs={l.item.specs} className="mt-1" />
        </div>
      ),
    },
    { key: 'ordered', header: 'Ordered', align: 'right', render: (l) => <span className="tabular">{formatQty(l.orderedQty)} {l.item.unitCode}</span> },
    { key: 'received', header: 'Received', align: 'right', hideBelow: 'md', render: (l) => <span className={l.receivedQty > 0 ? 'tabular text-emerald-700' : 'tabular text-slate-400'}>{formatQty(l.receivedQty)}</span> },
    { key: 'remaining', header: 'Remaining', align: 'right', hideBelow: 'md', render: (l) => <span className="tabular">{formatQty(l.remainingQty)}{l.cancelledQty > 0 ? <span className="text-xs text-slate-400"> ({formatQty(l.cancelledQty)} cancelled)</span> : null}</span> },
    { key: 'progress', header: 'Progress', hideBelow: 'lg', render: (l) => <ProgressBar value={l.receivedQty} total={l.orderedQty} /> },
    { key: 'price', header: 'Unit price', align: 'right', render: (l) => <span className="tabular">{formatMoney(l.unitPrice, po.currency)}</span> },
    { key: 'tax', header: 'GST', align: 'right', hideBelow: 'md', render: (l) => <span className="text-slate-600 text-xs tabular">{l.taxRate}%</span> },
    { key: 'total', header: 'Line total', align: 'right', render: (l) => <span className="tabular font-medium">{formatMoney(l.lineTotal, po.currency)}</span> },
  ];
  const supplierAddr = addressLines(po.supplier.billingAddress);
  const shipAddr = addressLines(po.shipTo.address);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader title="Vendor" description="Snapshot taken when the order was created" />
          <CardBody>
            <p className="text-sm font-semibold text-slate-900">{po.supplier.displayName}</p>
            {po.supplier.legalName !== po.supplier.displayName && <p className="text-xs text-slate-500">{po.supplier.legalName}</p>}
            <div className="mt-2 text-sm text-slate-700 space-y-0.5">{supplierAddr.length ? supplierAddr.map((l, i) => <p key={i}>{l}</p>) : <p className="text-slate-400">No billing address</p>}</div>
            <DescriptionList
              columns={1}
              items={[
                { label: 'GSTIN', value: po.supplier.gstin, mono: true },
                { label: 'GST treatment', value: po.supplier.gstTreatment },
                { label: 'State', value: po.supplier.stateCode },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Ship to" />
          <CardBody>
            <p className="text-sm font-semibold text-slate-900">
              {po.shipTo.code} - {po.shipTo.name}
            </p>
            <div className="mt-2 text-sm text-slate-700 space-y-0.5">{shipAddr.length ? shipAddr.map((l, i) => <p key={i}>{l}</p>) : <p className="text-slate-400">No address on file</p>}</div>
            <DescriptionList columns={1} items={[{ label: 'State', value: po.shipTo.stateCode }, { label: 'Warehouse GSTIN', value: po.shipTo.gstin, mono: true }]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Order" />
          <CardBody>
            <DescriptionList
              columns={1}
              items={[
                { label: 'Order date', value: formatDate(po.orderDate) },
                { label: 'Expected date', value: formatDate(po.expectedDate) },
                { label: 'Supply type', value: po.intraState ? 'Intra-state (CGST + SGST)' : 'Inter-state (IGST)' },
                { label: 'Discount', value: po.discountValue > 0 ? (po.discountType === 'PERCENT' ? `${po.discountValue}%` : formatMoney(po.discountValue, po.currency)) : 'None' },
                { label: 'Issued', value: po.issuedAt ? formatDateTime(po.issuedAt) : null },
                { label: 'Status note', value: po.statusReason },
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader title="Laptops ordered" description={`${po.lines.length} line${po.lines.length === 1 ? '' : 's'} - expand a line to see all specifications`} />
        <DataTable columns={columns} rows={po.lines} rowKey={(l) => l.id} empty={<EmptyState title="No lines" />} dense />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader title="Notes and terms" />
          <CardBody>
            <DescriptionList columns={1} items={[{ label: 'Notes', value: po.notes ? <span className="whitespace-pre-wrap">{po.notes}</span> : null }, { label: 'Terms and conditions', value: po.terms ? <span className="whitespace-pre-wrap">{po.terms}</span> : null }]} />
          </CardBody>
        </Card>
        <PoTotals totals={{ subTotal: po.subtotal, discountAmount: po.discountAmount, taxTotal: po.taxTotal, taxBreakup: po.taxBreakup ?? [], total: po.total }} intraState={po.intraState} currency={po.currency} />
      </div>
    </div>
  );
}

function Approvals({ po }: { po: PurchaseOrderDetail }) {
  if (po.approvals.length === 0) return <EmptyState icon={ClipboardCheck} title="No approval decisions yet" hint={po.status === 'PENDING_APPROVAL' ? 'This order is waiting for an approver.' : undefined} />;
  return (
    <ol className="relative border-l border-slate-200 ml-1">
      {po.approvals.map((a) => (
        <li key={a.id} className="relative pl-6 pb-5 last:pb-0">
          <span className={`absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-white -translate-x-1/2 ${a.decision === 'APPROVED' ? 'bg-emerald-500' : 'bg-red-500'}`} />
          <div className="flex flex-wrap items-baseline gap-x-2">
            <StatusBadge status={a.decision} />
            <span className="text-xs text-slate-500">
              revision {a.revision} - by <span className="font-mono">{a.actorId.slice(0, 8)}</span> on {formatDateTime(a.decidedAt)}
            </span>
          </div>
          {a.comment && <p className="text-sm text-slate-700 mt-1">{a.comment}</p>}
        </li>
      ))}
    </ol>
  );
}

function Revisions({ po }: { po: PurchaseOrderDetail }) {
  const [selected, setSelected] = useState<number | null>(po.revisions.length ? po.revisions[po.revisions.length - 1].revision : null);
  const snapshot = usePoRevision(po.id, selected);
  if (po.revisions.length === 0) return <EmptyState icon={History} title="No revisions" hint="Issued orders can be revised from the More menu; each revision is kept here." />;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
      <ul className="space-y-1">
        {po.revisions.map((r) => (
          <li key={r.revision}>
            <button type="button" onClick={() => setSelected(r.revision)} className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${selected === r.revision ? 'border-brand-300 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'}`}>
              <p className="text-sm font-medium text-slate-900">Revision {r.revision}</p>
              <p className="text-xs text-slate-500">{formatDateTime(r.createdAt)}</p>
              <p className="text-xs text-slate-600 mt-1 line-clamp-2">{r.reason}</p>
            </button>
          </li>
        ))}
      </ul>
      <div>
        {selected === null ? (
          <EmptyState title="Select a revision" />
        ) : snapshot.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-64" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : snapshot.isError || !snapshot.data ? (
          <ErrorState message={snapshot.error ? toApiError(snapshot.error).message : 'Revision not found'} onRetry={() => void snapshot.refetch()} />
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              <span className="font-medium">Reason:</span> {snapshot.data.reason}
            </p>
            <RevisionDiff snapshot={snapshot.data.snapshot} current={po} />
          </div>
        )}
      </div>
    </div>
  );
}

function Receipts({ po }: { po: PurchaseOrderDetail }) {
  const { byId } = useScopedWarehouses();
  if (po.grns.length === 0) return <EmptyState icon={PackageCheck} title="No goods receipts" hint={['ISSUED', 'PARTIALLY_RECEIVED'].includes(po.status) ? 'Use Receive goods to record a delivery against this order.' : undefined} />;
  return (
    <DataTable
      dense
      rows={po.grns}
      rowKey={(g) => g.id}
      columns={[
        { key: 'number', header: 'Receipt', render: (g) => <Link to={`/purchases/receipts/${g.id}`} className="font-mono text-[13px] text-brand-700 hover:underline">{g.number}</Link> },
        { key: 'date', header: 'Received date', render: (g) => <span className="tabular">{formatDate(g.receivedDate)}</span> },
        { key: 'warehouse', header: 'Warehouse', hideBelow: 'md', render: (g) => byId(g.warehouseId)?.code ?? <span className="font-mono text-xs text-slate-500">{g.warehouseId.slice(0, 8)}</span> },
        { key: 'status', header: 'Status', render: (g) => <StatusBadge status={g.status} /> },
      ]}
    />
  );
}

export function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const po = usePurchaseOrder(id);
  const [tab, setTab] = useState<Tab>('overview');
  const crumbs = [{ label: 'Purchases' }, { label: 'Purchase orders', to: '/purchases/orders' }, { label: po.data?.number ?? '...' }];

  if (po.isLoading) {
    return (
      <>
        <PageHeader title="Purchase order" breadcrumbs={crumbs} />
        <DetailSkeleton />
      </>
    );
  }
  if (po.isError || !po.data) {
    return (
      <>
        <PageHeader title="Purchase order" breadcrumbs={crumbs} />
        <Card>
          <ErrorState message={po.error ? toApiError(po.error).message : 'Purchase order not found'} onRetry={() => void po.refetch()} />
        </Card>
      </>
    );
  }
  const data = po.data;
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'approvals', label: 'Approvals', count: data.approvals.length },
    { key: 'revisions', label: 'Revisions', count: data.revisions.length },
    { key: 'receipts', label: 'Receipts', count: data.grns.length },
    { key: 'attachments', label: 'Attachments' },
  ];

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2 flex-wrap">
            <span className="font-mono">{data.number}</span>
            {data.revision > 0 && <Badge tone="purple">revision {data.revision}</Badge>}
            <StatusBadge status={data.status} />
          </span>
        }
        subtitle={
          <span>
            {data.supplier.displayName} - {formatMoney(data.total, data.currency)} - ordered {formatDate(data.orderDate)}
            {data.status === 'PENDING_APPROVAL' && data.revision > 0 ? ' - revision awaiting approval' : ''}
          </span>
        }
        breadcrumbs={crumbs}
        actions={<PoActions po={data} />}
      />
      {data.status === 'DRAFT' && data.statusReason && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">Returned to draft:</span> {data.statusReason}
        </div>
      )}
      <Tabs tabs={tabs} value={tab} onChange={setTab} className="mb-4" />
      {tab === 'overview' && <Overview po={data} />}
      {tab === 'approvals' && (
        <Card>
          <CardBody>
            <Approvals po={data} />
          </CardBody>
        </Card>
      )}
      {tab === 'revisions' && (
        <Card>
          <CardBody>
            <Revisions po={data} />
          </CardBody>
        </Card>
      )}
      {tab === 'receipts' && (
        <Card className="overflow-hidden">
          <CardHeader title="Goods receipts" actions={['ISSUED', 'PARTIALLY_RECEIVED'].includes(data.status) ? <Button size="sm" variant="secondary" icon={PackageCheck} onClick={() => navigate(`/purchases/receipts/new?po=${data.id}`)}>Receive goods</Button> : undefined} />
          <Receipts po={data} />
        </Card>
      )}
      {tab === 'attachments' && <AttachmentsCard entityType="PO" entityId={data.id} uploadPermission={['purchase.edit', 'grn.create']} />}
    </>
  );
}
