import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { PackageCheck } from 'lucide-react';
import { purchaseReceiveSchema } from '@b2b/shared';
import { Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Field, FormSkeleton, Input, PageHeader, SearchSelect, Textarea } from '../../../components/ui';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { toApiError } from '../../../lib/api';
import { cn, formatQty, todayISO } from '../../../lib/utils';
import { usePurchaseOrder, usePurchaseOrders } from '../../purchase-orders/hooks';
import { useCreatePurchaseReceive, useNextReceiveNumber } from '../hooks';

export function PurchaseReceiveCreatePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const poId = params.get('po') ?? '';
  const po = usePurchaseOrder(poId || undefined);
  const [poTerm, setPoTerm] = useState('');
  const openOrders = usePurchaseOrders({ page: 1, limit: 20, search: useDebouncedValue(poTerm, 250), status: 'OPEN', sortBy: 'createdAt', sortOrder: 'desc' });
  const next = useNextReceiveNumber(true);
  const create = useCreatePurchaseReceive();

  const [receiveNumber, setReceiveNumber] = useState('');
  const [receivedDate, setReceivedDate] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Default every line to "receive everything that is still outstanding".
  useEffect(() => {
    if (!po.data) return;
    setQuantities(Object.fromEntries(po.data.lines.map((l) => [l.id, String(l.remainingQuantity)])));
    setErrors({});
  }, [po.data]);

  const receivable = po.data ? ['ISSUED', 'PARTIALLY_RECEIVED'].includes(po.data.status) : false;
  const totalReceiving = useMemo(() => Object.values(quantities).reduce((s, v) => s + (Number(v) || 0), 0), [quantities]);

  const submit = async () => {
    if (!po.data) return;
    const payload = purchaseReceiveSchema.safeParse({
      purchaseOrderId: po.data.id,
      receiveNumber,
      receivedDate,
      notes,
      lines: po.data.lines.map((l) => ({ purchaseOrderLineId: l.id, quantity: quantities[l.id] === '' ? 0 : quantities[l.id] })),
    });
    if (!payload.success) {
      const map: Record<string, string> = {};
      payload.error.issues.forEach((i) => {
        const p = i.path.join('.');
        if (p.startsWith('lines.') && po.data) {
          const idx = Number(i.path[1]);
          map[po.data.lines[idx]?.id ?? p] = i.message;
        } else map[p || 'form'] = i.message;
      });
      setErrors(map);
      toast.error(map.lines ?? map.form ?? 'Please fix the highlighted fields');
      return;
    }
    const over = po.data.lines.find((l) => Number(quantities[l.id] || 0) > l.remainingQuantity + 1e-9);
    if (over) {
      setErrors({ [over.id]: `Only ${formatQty(over.remainingQuantity)} remain to be received` });
      toast.error('Some quantities exceed what is outstanding');
      return;
    }
    try {
      const saved = await create.mutateAsync(payload.data);
      toast.success(`${saved.receiveNumber} recorded`);
      navigate(`/purchases/purchase-receives/${saved.id}`, { replace: true });
    } catch (err) {
      const e = toApiError(err);
      const map: Record<string, string> = {};
      e.details.forEach((d) => {
        if (d.path.startsWith('lines.') && po.data) map[po.data.lines[Number(d.path.split('.')[1])]?.id ?? d.path] = d.message;
        else if (d.path) map[d.path] = d.message;
      });
      setErrors(map);
      toast.error(e.message);
    }
  };

  const crumbs = [{ label: 'Purchases' }, { label: 'Purchase Receives', to: '/purchases/purchase-receives' }, { label: 'New' }];

  return (
    <>
      <PageHeader title="New Purchase Receive" breadcrumbs={crumbs} />
      <div className="space-y-5">
        <Card>
          <CardBody className="py-5 space-y-4">
            <Field label="Purchase Order" required inline error={errors.purchaseOrderId} className="md:grid-cols-[180px_minmax(0,560px)]">
              <SearchSelect
                value={poId}
                selectedLabel={po.data ? `${po.data.purchaseOrderNumber} - ${po.data.vendor.displayName}` : 'Loading...'}
                onChange={(v) => setParams(v ? { po: v } : {}, { replace: true })}
                onSearch={setPoTerm}
                loading={openOrders.isFetching}
                placeholder="Select an issued purchase order"
                emptyText="No open purchase orders. Issue an order first."
                options={(openOrders.data?.data ?? []).map((o) => ({ value: o.id, label: `${o.purchaseOrderNumber} - ${o.vendor.displayName}`, description: `${o.status === 'PARTIALLY_RECEIVED' ? 'Partially received' : 'Issued'} - ${o.lineCount} line${o.lineCount === 1 ? '' : 's'}` }))}
              />
            </Field>
            {po.data && (
              <div className="grid grid-cols-1 md:grid-cols-[180px_minmax(0,560px)] gap-1 md:gap-4">
                <div />
                <div className="text-xs text-slate-600 rounded-md bg-slate-50 border border-slate-200 px-3 py-2">
                  <p><span className="text-slate-500">Vendor:</span> <Link to={`/purchases/vendors/${po.data.vendor.id}`} className="text-brand-700 hover:underline">{po.data.vendor.displayName}</Link></p>
                  <p><span className="text-slate-500">Deliver to:</span> {po.data.deliveryAddress?.name ?? po.data.deliveryLocation?.name ?? [po.data.deliveryAddress?.city, po.data.deliveryAddress?.state].filter(Boolean).join(', ')}</p>
                  <p className="tabular"><span className="text-slate-500">Progress:</span> {formatQty(po.data.receivedQuantity)} of {formatQty(po.data.orderedQuantity)} received</p>
                </div>
              </div>
            )}
            <Field label="Purchase Receive#" required inline error={errors.receiveNumber} className="md:grid-cols-[180px_minmax(0,420px)]">
              <Input value={receiveNumber} sanitize="singleLine" maxLength={30} onChange={(e) => setReceiveNumber(e.target.value)} placeholder={next.data ? `Auto: ${next.data.preview}` : 'Auto-generated'} error={Boolean(errors.receiveNumber)} className="font-mono" />
              <p className="text-xs text-slate-500 mt-1">Leave blank to auto-generate.</p>
            </Field>
            <Field label="Received Date" required inline htmlFor="receivedDate" error={errors.receivedDate} className="md:grid-cols-[180px_minmax(0,240px)]">
              <Input id="receivedDate" type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} error={Boolean(errors.receivedDate)} />
            </Field>
          </CardBody>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Items to Receive" description={po.data ? 'Enter the quantity received for each line. Lines left at 0 are skipped.' : 'Select a purchase order to load its lines.'} />
          {!poId ? (
            <EmptyState icon={PackageCheck} title="No purchase order selected" hint="Pick an issued or partially received purchase order above." />
          ) : po.isLoading ? (
            <CardBody><FormSkeleton /></CardBody>
          ) : po.isError || !po.data ? (
            <ErrorState message={toApiError(po.error).message} onRetry={() => void po.refetch()} />
          ) : !receivable ? (
            <EmptyState icon={PackageCheck} title={`This order is ${po.data.status.toLowerCase().replace('_', ' ')}`} hint="Only issued or partially received purchase orders can receive goods." action={<Button variant="secondary" size="sm" onClick={() => navigate(`/purchases/purchase-orders/${po.data!.id}`)}>Open purchase order</Button>} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200 bg-slate-50/60">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-semibold">Item Details</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Ordered</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Received</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Remaining</th>
                    <th className="text-right px-4 py-2.5 font-semibold w-44">Quantity to Receive</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {po.data.lines.map((l) => (
                    <tr key={l.id} className={cn(l.remainingQuantity === 0 && 'opacity-60')}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{l.name}</p>
                        <p className="text-xs text-slate-500">{[l.sku, l.description].filter(Boolean).join(' - ')}</p>
                      </td>
                      <td className="px-4 py-3 text-right tabular">{formatQty(l.quantity)} {l.unit ?? ''}</td>
                      <td className="px-4 py-3 text-right tabular text-emerald-700">{formatQty(l.receivedQuantity)}</td>
                      <td className="px-4 py-3 text-right tabular">{formatQty(l.remainingQuantity)}</td>
                      <td className="px-4 py-3">
                        <Input sanitize="decimal" aria-label={`Quantity to receive for ${l.name}`} value={quantities[l.id] ?? ''} disabled={l.remainingQuantity === 0} onChange={(e) => { setQuantities((q) => ({ ...q, [l.id]: e.target.value })); setErrors((er) => { const n = { ...er }; delete n[l.id]; return n; }); }} error={Boolean(errors[l.id])} className="text-right tabular" />
                        {errors[l.id] && <p className="text-xs text-red-600 mt-1 text-right">{errors[l.id]}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200 bg-slate-50/60">
                    <td colSpan={4} className="px-4 py-2.5 text-right text-sm font-medium text-slate-700">Total receiving</td>
                    <td className="px-4 py-2.5 text-right tabular font-semibold text-slate-900">{formatQty(totalReceiving)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardBody>
            <Field label="Notes" htmlFor="notes" error={errors.notes}>
              <Textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery challan number, condition of goods, transporter details" />
            </Field>
          </CardBody>
        </Card>

        <div className="sticky bottom-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-white/95 backdrop-blur border-t border-slate-200 flex items-center gap-2">
          <Button onClick={() => void submit()} loading={create.isPending} disabled={!po.data || !receivable || totalReceiving <= 0}>
            Save as Received
          </Button>
          <Button variant="ghost" onClick={() => navigate(poId ? `/purchases/purchase-orders/${poId}` : '/purchases/purchase-receives')} disabled={create.isPending}>
            Cancel
          </Button>
        </div>
      </div>
    </>
  );
}
