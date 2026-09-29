import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClipboardList, Link2Off, PackageCheck, Plus } from 'lucide-react';
import type { PurchaseOrderStatus } from '@b2b/shared';
import { Button, DataTable, EmptyState, ErrorState, Skeleton, Tabs, type Column } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { usePermission } from '../../../lib/auth';
import { formatDate, formatMoney, formatQty } from '../../../lib/utils';
import { PoStatusBadge, ReceiveStatusBadge } from '../../purchase-orders/components/PoStatusBadge';
import { useVendorTransactions } from '../hooks';

type ModuleKey = 'purchaseOrders' | 'purchaseReceives' | 'bills' | 'paymentsMade' | 'vendorCredits' | 'returns';
const MODULES: { key: ModuleKey; label: string; hint: string }[] = [
  { key: 'purchaseOrders', label: 'Purchase Orders', hint: '' },
  { key: 'purchaseReceives', label: 'Receives / GRN', hint: '' },
  { key: 'bills', label: 'Bills', hint: 'Vendor bills and their payment status will be listed here after the Billing module ships.' },
  { key: 'paymentsMade', label: 'Payments Made', hint: 'Payments recorded against this vendor will be listed here after the Payments module ships.' },
  { key: 'vendorCredits', label: 'Vendor Credits', hint: 'Credit notes issued by this vendor will be listed here after the Vendor Credits module ships.' },
  { key: 'returns', label: 'Returns', hint: 'Purchase returns to this vendor will be listed here after the Returns module ships.' },
];

interface PoRow { id: string; number: string; reference: string | null; date: string; expectedDeliveryDate: string | null; status: PurchaseOrderStatus; amount: number; currencyCode: string }
interface ReceiveRow { id: string; number: string; date: string; status: 'RECEIVED' | 'CANCELLED'; quantity: number; purchaseOrder: { id: string; purchaseOrderNumber: string } }

function money(value: number | null, currency: string) {
  if (value === null) return <span className="text-slate-400">Not available</span>;
  return formatMoney(value, currency);
}

export function VendorTransactions({ vendorId }: { vendorId: string }) {
  const q = useVendorTransactions(vendorId);
  const navigate = useNavigate();
  const perms = usePermission();
  const [tab, setTab] = useState<ModuleKey>('purchaseOrders');

  if (q.isLoading) return <Skeleton className="h-48" />;
  if (q.isError) return <ErrorState message={toApiError(q.error).message} onRetry={() => void q.refetch()} />;
  const data = q.data!;
  const current = MODULES.find((m) => m.key === tab)!;
  const mod = data.modules[tab];

  const poColumns: Column<PoRow>[] = [
    { key: 'date', header: 'Date', render: (r) => <span className="tabular">{formatDate(r.date)}</span> },
    { key: 'number', header: 'Purchase Order#', render: (r) => <Link to={`/purchases/purchase-orders/${r.id}`} className="font-mono text-[13px] text-brand-700 hover:underline">{r.number}</Link> },
    { key: 'ref', header: 'Reference#', hideBelow: 'md', render: (r) => <span className="text-slate-700">{r.reference ?? ''}</span> },
    { key: 'status', header: 'Status', render: (r) => <PoStatusBadge status={r.status} /> },
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => <span className="tabular font-medium">{formatMoney(r.amount, r.currencyCode)}</span> },
  ];
  const receiveColumns: Column<ReceiveRow>[] = [
    { key: 'date', header: 'Date', render: (r) => <span className="tabular">{formatDate(r.date)}</span> },
    { key: 'number', header: 'Purchase Receive#', render: (r) => <Link to={`/purchases/purchase-receives/${r.id}`} className="font-mono text-[13px] text-brand-700 hover:underline">{r.number}</Link> },
    { key: 'po', header: 'Purchase Order#', hideBelow: 'md', render: (r) => <Link to={`/purchases/purchase-orders/${r.purchaseOrder.id}`} className="font-mono text-[13px] text-slate-700 hover:text-brand-700">{r.purchaseOrder.purchaseOrderNumber}</Link> },
    { key: 'status', header: 'Status', render: (r) => <ReceiveStatusBadge status={r.status} /> },
    { key: 'qty', header: 'Quantity', align: 'right', render: (r) => <span className="tabular font-medium">{formatQty(r.quantity)}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: 'Opening Balance', value: data.summary.openingBalance },
          { label: 'Outstanding Payables', value: data.summary.outstandingPayables },
          { label: 'Unused Credits', value: data.summary.unusedCredits },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3">
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className="text-base font-semibold text-slate-900 mt-0.5 tabular">{money(s.value, data.currencyCode)}</p>
          </div>
        ))}
      </div>
      <Tabs tabs={MODULES.map((m) => ({ key: m.key, label: m.label, count: data.modules[m.key].available ? data.modules[m.key].total : undefined }))} value={tab} onChange={setTab} />
      {!mod.available ? (
        <div className="text-center py-10 px-4 rounded-lg border border-dashed border-slate-300">
          <Link2Off className="w-6 h-6 text-slate-400 mx-auto" />
          <p className="text-sm font-medium text-slate-700 mt-2">{current.label} not connected yet</p>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">{current.hint}</p>
        </div>
      ) : tab === 'purchaseOrders' ? (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <DataTable columns={poColumns} rows={mod.items as PoRow[]} rowKey={(r) => r.id} dense onRowClick={(r) => navigate(`/purchases/purchase-orders/${r.id}`)} empty={<EmptyState icon={ClipboardList} title="No purchase orders for this vendor" action={perms.canCreatePurchaseOrder ? <Button size="sm" icon={Plus} onClick={() => navigate(`/purchases/purchase-orders/new?vendor=${vendorId}`)}>New Purchase Order</Button> : undefined} className="py-8" />} />
          {mod.total > mod.items.length && <p className="px-4 py-2 text-xs text-slate-500 border-t border-slate-100">Showing the latest {mod.items.length} of {mod.total}. <Link to={`/purchases/purchase-orders?vendorId=${vendorId}`} className="text-brand-700 hover:underline">View all</Link></p>}
        </div>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <DataTable columns={receiveColumns} rows={mod.items as ReceiveRow[]} rowKey={(r) => r.id} dense onRowClick={(r) => navigate(`/purchases/purchase-receives/${r.id}`)} empty={<EmptyState icon={PackageCheck} title="Nothing received from this vendor yet" className="py-8" />} />
          {mod.total > mod.items.length && <p className="px-4 py-2 text-xs text-slate-500 border-t border-slate-100">Showing the latest {mod.items.length} of {mod.total}. <Link to={`/purchases/purchase-receives?vendorId=${vendorId}`} className="text-brand-700 hover:underline">View all</Link></p>}
        </div>
      )}
    </div>
  );
}
