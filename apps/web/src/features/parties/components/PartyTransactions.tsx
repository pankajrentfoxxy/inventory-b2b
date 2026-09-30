import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClipboardList, Link2Off, Plus, ShoppingCart } from 'lucide-react';
import { Button, DataTable, EmptyState, ErrorState, Skeleton, StatusBadge, Tabs, type Column } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatDate, formatMoney } from '../../../lib/utils';
import { usePartyPurchaseOrders } from '../hooks';
import type { PartyDetail, PartyPurchaseOrderRow, PartyType } from '../types';

type ModuleKey = 'purchaseOrders' | 'purchaseReceives' | 'bills' | 'paymentsMade';
const MODULES: { key: ModuleKey; label: string; hint: string }[] = [
  { key: 'purchaseOrders', label: 'Purchase Orders', hint: '' },
  { key: 'purchaseReceives', label: 'Receives / GRN', hint: 'Goods receipts are listed on each purchase order and under Purchases > Receipts.' },
  { key: 'bills', label: 'Bills', hint: 'Vendor bills and their payment status will be listed here after the Billing module ships.' },
  { key: 'paymentsMade', label: 'Payments Made', hint: 'Payments recorded against this vendor will be listed here after the Payments module ships.' },
];

function money(value: number | null, currency: string) {
  if (value === null) return <span className="text-slate-400">Not available</span>;
  return formatMoney(value, currency);
}

function SupplierTransactions({ party }: { party: PartyDetail }) {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canView = hasPermission('purchase.view');
  const q = usePartyPurchaseOrders(party.id, canView);
  const [tab, setTab] = useState<ModuleKey>('purchaseOrders');
  const current = MODULES.find((m) => m.key === tab)!;
  const currency = party.currencyCode ?? 'INR';

  const poColumns: Column<PartyPurchaseOrderRow>[] = [
    { key: 'date', header: 'Date', render: (r) => <span className="tabular">{formatDate(r.orderDate)}</span> },
    { key: 'number', header: 'Purchase Order#', render: (r) => <Link to={`/purchases/orders/${r.id}`} className="font-mono text-[13px] text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>{r.number}</Link> },
    { key: 'expected', header: 'Expected', hideBelow: 'md', render: (r) => <span className="tabular text-slate-700">{r.expectedDate ? formatDate(r.expectedDate) : ''}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => <span className="tabular font-medium">{formatMoney(r.total, r.currency)}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: 'Opening Balance', value: party.openingBalance },
          { label: 'Outstanding Payables', value: null },
          { label: 'Unused Credits', value: null },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3">
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className="text-base font-semibold text-slate-900 mt-0.5 tabular">{money(s.value, currency)}</p>
          </div>
        ))}
      </div>
      <Tabs tabs={MODULES.map((m) => ({ key: m.key, label: m.label, count: m.key === 'purchaseOrders' && q.data ? q.data.length : undefined }))} value={tab} onChange={setTab} />
      {tab !== 'purchaseOrders' ? (
        <div className="text-center py-10 px-4 rounded-lg border border-dashed border-slate-300">
          <Link2Off className="w-6 h-6 text-slate-400 mx-auto" />
          <p className="text-sm font-medium text-slate-700 mt-2">{current.label} not connected yet</p>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">{current.hint}</p>
        </div>
      ) : !canView ? (
        <EmptyState icon={ClipboardList} title="No access to purchase orders" hint="You need the purchase view permission to see this vendor's purchase orders." className="py-8" />
      ) : q.isLoading ? (
        <Skeleton className="h-48" />
      ) : q.isError ? (
        <ErrorState message={toApiError(q.error).message} onRetry={() => void q.refetch()} />
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <DataTable
            columns={poColumns}
            rows={q.data ?? []}
            rowKey={(r) => r.id}
            dense
            onRowClick={(r) => navigate(`/purchases/orders/${r.id}`)}
            empty={<EmptyState icon={ClipboardList} title="No purchase orders for this vendor" action={hasPermission('purchase.create') && party.status === 'ACTIVE' ? <Button size="sm" icon={Plus} onClick={() => navigate('/purchases/orders/new')}>New Purchase Order</Button> : undefined} className="py-8" />}
          />
          {(q.data?.length ?? 0) >= 50 && (
            <p className="px-4 py-2 text-xs text-slate-500 border-t border-slate-100">
              Showing the latest {q.data?.length}. <Link to="/purchases/orders" className="text-brand-700 hover:underline">View all</Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Documents linked to the party. Vendors: purchase orders (svc-procurement); customers: later phase. */
export function PartyTransactions({ type, party }: { type: PartyType; party: PartyDetail }) {
  if (type === 'SUPPLIER') return <SupplierTransactions party={party} />;
  return <EmptyState icon={ShoppingCart} title="No transactions yet" hint="Sales documents arrive in a later phase." className="py-10 border border-dashed border-slate-300 rounded-lg" />;
}
