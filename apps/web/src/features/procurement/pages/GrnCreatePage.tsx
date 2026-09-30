import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { PackageCheck, Save } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Field, FormSkeleton, Input, PageHeader, SearchSelect, Select, Textarea } from '../../../components/ui';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { toApiError } from '../../../lib/api';
import { cn, formatMoney, formatQty, humanize, todayISO } from '../../../lib/utils';
import { LineSpecs } from '../components/LineSpecs';
import { WarehouseSelect } from '../components/pickers';
import { SerialCapturePanel, type CapturedSerial } from '../components/SerialCapturePanel';
import { useCreateGrn, usePurchaseOrders, useReceivableLines, useScopedWarehouses, useWarehouseDetail } from '../hooks';
import type { GrnInput, PoLine } from '../types';

interface LineState {
  include: boolean;
  qty: string;
  unitCost: string;
  binId: string;
  conditionNote: string;
  serials: CapturedSerial[];
}

const initialLine = (l: PoLine): LineState => ({ include: true, qty: String(l.remainingQty), unitCost: String(l.unitPrice), binId: '', conditionNote: '', serials: [] });

/**
 * New goods receipt: pick a receivable PO -> receivable lines -> warehouse + header -> lines with
 * quantities, cost, bin and serial capture -> save as draft or receive now (Idempotency-Key on both).
 */
export function GrnCreatePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const poId = params.get('po') ?? '';
  const [poTerm, setPoTerm] = useState('');
  const debouncedTerm = useDebouncedValue(poTerm, 250);
  const issued = usePurchaseOrders({ status: 'ISSUED', q: debouncedTerm || undefined, limit: 50 });
  const partial = usePurchaseOrders({ status: 'PARTIALLY_RECEIVED', q: debouncedTerm || undefined, limit: 50 });
  const receivable = useReceivableLines(poId || undefined);
  const { warehouses, defaultId, byId, isLoading: whLoading } = useScopedWarehouses();
  const create = useCreateGrn();

  const [warehouseId, setWarehouseId] = useState('');
  const warehouse = useWarehouseDetail(warehouseId || undefined);
  const [header, setHeader] = useState({ receivedDate: todayISO(), supplierInvoiceNo: '', supplierInvoiceDate: '', deliveryNoteNo: '', vehicleNo: '', remarks: '' });
  const [lines, setLines] = useState<Record<string, LineState>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverDuplicates, setServerDuplicates] = useState<string[]>([]);

  // Reset the line state when the PO changes.
  useEffect(() => {
    if (!receivable.data) return;
    setLines(Object.fromEntries(receivable.data.lines.map((l) => [l.id, initialLine(l)])));
    setErrors({});
    setServerDuplicates([]);
    setWarehouseId('');
  }, [receivable.data]);
  // Default the warehouse to the PO ship-to when it is in scope, otherwise the first scoped warehouse.
  useEffect(() => {
    if (!receivable.data || warehouseId || warehouses.length === 0) return;
    const shipTo = receivable.data.shipToWarehouseId;
    setWarehouseId(warehouses.some((w) => w.id === shipTo) ? shipTo : defaultId);
  }, [receivable.data, warehouses, defaultId, warehouseId]);

  const poOptions = useMemo(() => {
    const all = [...(issued.data ?? []), ...(partial.data ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return all.map((o) => ({ value: o.id, label: `${o.number} - ${o.supplier.displayName}`, description: `${humanize(o.status)} - ${o.lines.length} line${o.lines.length === 1 ? '' : 's'} - ${formatMoney(o.total, o.currency)}` }));
  }, [issued.data, partial.data]);

  const bins = useMemo(() => (warehouse.data?.locations ?? []).flatMap((loc) => loc.bins.filter((b) => b.status === 'ACTIVE').map((b) => ({ value: b.id, label: `${loc.code} / ${b.code}` }))), [warehouse.data]);

  const update = (lineId: string, patch: Partial<LineState>) => setLines((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }));

  const included = (receivable.data?.lines ?? []).filter((l) => lines[l.id]?.include && Number(lines[l.id]?.qty) > 0);

  const buildPayload = (): { payload: GrnInput; order: string[] } => {
    const order = included.map((l) => l.id);
    const payload: GrnInput = {
      poId,
      warehouseId: warehouseId || null,
      receivedDate: header.receivedDate,
      supplierInvoiceNo: header.supplierInvoiceNo.trim() || null,
      supplierInvoiceDate: header.supplierInvoiceDate || null,
      deliveryNoteNo: header.deliveryNoteNo.trim() || null,
      vehicleNo: header.vehicleNo.trim() || null,
      remarks: header.remarks.trim() || null,
      lines: included.map((l) => {
        const s = lines[l.id];
        return { poLineId: l.id, qty: Number(s.qty), unitCost: s.unitCost.trim() === '' ? null : Number(s.unitCost), binId: s.binId || null, conditionNote: s.conditionNote.trim() || null, serials: l.item.isSerialized ? s.serials.map((x) => ({ serialNo: x.serialNo, imei: x.imei || null })) : [] };
      }),
    };
    return { payload, order };
  };

  const submit = async (receive: boolean) => {
    if (!receivable.data) return;
    if (included.length === 0) {
      setErrors({ lines: 'Include at least one line with a quantity above zero.' });
      toast.error('Nothing to receive');
      return;
    }
    const { payload, order } = buildPayload();
    setErrors({});
    setServerDuplicates([]);
    try {
      const saved = await create.mutateAsync({ payload, receive });
      toast.success(receive ? `${saved.number} received; posting to inventory` : `${saved.number} saved as draft`);
      navigate(`/purchases/receipts/${saved.id}`, { replace: true });
    } catch (err) {
      const e = toApiError(err);
      const map: Record<string, string> = {};
      for (const d of e.details) {
        const m = /^lines\.(\d+)(?:\.(.+))?$/.exec(d.path);
        if (m) {
          const lineId = order[Number(m[1])] ?? d.path;
          map[`${lineId}.${m[2] ?? 'line'}`] = d.message;
        } else if (d.path) map[d.path] = d.message;
        const dups = (d as { duplicates?: unknown }).duplicates;
        if (Array.isArray(dups)) setServerDuplicates(dups.filter((x): x is string => typeof x === 'string'));
      }
      if (e.code === 'OVER_RECEIPT') {
        const d = e.details[0] as { remaining?: number; requested?: number; poLineId?: string } | undefined;
        if (d?.poLineId) map[`${d.poLineId}.qty`] = `Requested ${formatQty(d.requested ?? 0)} but only ${formatQty(d.remaining ?? 0)} remain open`;
      }
      if (e.code === 'GRN_WAREHOUSE_SCOPE') map.warehouseId = e.message;
      setErrors(map);
      toast.error(e.message);
    }
  };

  const crumbs = [{ label: 'Purchases' }, { label: 'Goods receipts', to: '/purchases/receipts' }, { label: 'New' }];
  const selectedPo = poOptions.find((o) => o.value === poId);
  const scopedWarehouseMissing = Boolean(receivable.data) && warehouses.length > 0 && !warehouses.some((w) => w.id === receivable.data!.shipToWarehouseId);

  return (
    <>
      <PageHeader title="New goods receipt" subtitle="Record what arrived against an issued purchase order." breadcrumbs={crumbs} />
      <div className="space-y-5">
        <Card>
          <CardBody className="py-5 space-y-4">
            <Field label="Purchase order" required inline error={errors.poId} className="md:grid-cols-[180px_minmax(0,560px)]">
              <SearchSelect
                value={poId}
                selectedLabel={selectedPo?.label ?? (receivable.data ? receivable.data.number : poId ? 'Loading...' : undefined)}
                onChange={(v) => setParams(v ? { po: v } : {}, { replace: true })}
                onSearch={setPoTerm}
                loading={issued.isFetching || partial.isFetching}
                placeholder="Select an issued or partially received order"
                emptyText={issued.isError || partial.isError ? 'Could not load purchase orders' : 'No receivable purchase orders'}
                options={poOptions}
              />
            </Field>
            {receivable.data && (
              <div className="grid grid-cols-1 md:grid-cols-[180px_minmax(0,560px)] gap-1 md:gap-4">
                <div />
                <div className="text-xs text-slate-600 rounded-md bg-slate-50 border border-slate-200 px-3 py-2 space-y-0.5">
                  <p>
                    <span className="text-slate-500">Order:</span>{' '}
                    <Link to={`/purchases/orders/${receivable.data.poId}`} className="text-brand-700 hover:underline font-mono">
                      {receivable.data.number}
                    </Link>{' '}
                    ({humanize(receivable.data.status)})
                  </p>
                  <p>
                    <span className="text-slate-500">Open lines:</span> {receivable.data.lines.length}
                  </p>
                </div>
              </div>
            )}
            <Field label="Warehouse" required inline error={errors.warehouseId} className="md:grid-cols-[180px_minmax(0,420px)]" hint="Defaults to the order ship-to; only warehouses in your scope are listed">
              <WarehouseSelect value={warehouseId} onChange={setWarehouseId} error={Boolean(errors.warehouseId)} disabled={!poId} />
              {scopedWarehouseMissing && <p className="text-xs text-amber-700 mt-1">The order ship-to warehouse is outside your scope; pick one you can receive into.</p>}
            </Field>
            <div className="grid grid-cols-1 md:grid-cols-[180px_minmax(0,560px)] gap-1 md:gap-4">
              <div className="text-xs font-medium text-slate-600 md:pt-2.5">Delivery details</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Received date" required error={errors.receivedDate} htmlFor="grn-date">
                  <Input id="grn-date" type="date" value={header.receivedDate} onChange={(e) => setHeader({ ...header, receivedDate: e.target.value })} error={Boolean(errors.receivedDate)} />
                </Field>
                <Field label="Vendor invoice no." error={errors.supplierInvoiceNo}>
                  <Input value={header.supplierInvoiceNo} sanitize="singleLine" maxLength={60} onChange={(e) => setHeader({ ...header, supplierInvoiceNo: e.target.value })} error={Boolean(errors.supplierInvoiceNo)} />
                </Field>
                <Field label="Vendor invoice date" error={errors.supplierInvoiceDate} htmlFor="grn-inv-date">
                  <Input id="grn-inv-date" type="date" value={header.supplierInvoiceDate} onChange={(e) => setHeader({ ...header, supplierInvoiceDate: e.target.value })} error={Boolean(errors.supplierInvoiceDate)} />
                </Field>
                <Field label="Delivery note no." error={errors.deliveryNoteNo}>
                  <Input value={header.deliveryNoteNo} sanitize="singleLine" maxLength={60} onChange={(e) => setHeader({ ...header, deliveryNoteNo: e.target.value })} error={Boolean(errors.deliveryNoteNo)} />
                </Field>
                <Field label="Vehicle no." error={errors.vehicleNo}>
                  <Input value={header.vehicleNo} sanitize="upper" maxLength={20} onChange={(e) => setHeader({ ...header, vehicleNo: e.target.value })} error={Boolean(errors.vehicleNo)} className="font-mono" />
                </Field>
                <Field label="Remarks" error={errors.remarks} className="sm:col-span-2">
                  <Textarea rows={2} value={header.remarks} maxLength={1000} onChange={(e) => setHeader({ ...header, remarks: e.target.value })} error={Boolean(errors.remarks)} />
                </Field>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader
            title="Laptops to receive"
            description={receivable.data ? 'Check each SKU and its specs against the delivery. Quantity defaults to what is still open; untick a line to leave it out. Received laptops go into QC hold and are not available until QC passes.' : 'Select a purchase order to load its open lines.'}
          />
          {!poId ? (
            <EmptyState icon={PackageCheck} title="No purchase order selected" hint="Pick an issued or partially received order above." />
          ) : receivable.isLoading || whLoading ? (
            <CardBody>
              <FormSkeleton />
            </CardBody>
          ) : receivable.isError || !receivable.data ? (
            <ErrorState message={receivable.error ? toApiError(receivable.error).message : 'Purchase order not found'} onRetry={() => void receivable.refetch()} />
          ) : !receivable.data.receivable ? (
            <EmptyState icon={PackageCheck} title={`This order is ${humanize(receivable.data.status).toLowerCase()}`} hint="Only issued or partially received orders can receive goods." action={<Button variant="secondary" size="sm" onClick={() => navigate(`/purchases/orders/${poId}`)}>Open purchase order</Button>} />
          ) : receivable.data.lines.length === 0 ? (
            <EmptyState icon={PackageCheck} title="Nothing left to receive" hint="Every line on this order has been fully received." />
          ) : (
            <div className="divide-y divide-slate-100">
              {receivable.data.lines.map((l) => {
                const s = lines[l.id] ?? initialLine(l);
                const err = (k: string) => errors[`${l.id}.${k}`];
                const qty = Number(s.qty) || 0;
                const over = qty > l.remainingQty + 1e-9;
                return (
                  <div key={l.id} className={cn('px-5 py-4 space-y-3', !s.include && 'opacity-60')}>
                    <div className="flex flex-col lg:flex-row lg:items-start gap-3">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <input type="checkbox" className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600 cursor-pointer" checked={s.include} onChange={(e) => update(l.id, { include: e.target.checked })} aria-label={`Include ${l.item.sku} ${l.item.name}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">
                            <span className="font-mono font-semibold text-slate-900">{l.item.sku}</span> <span className="text-slate-700">{l.item.name}</span>
                          </p>
                          <LineSpecs specs={l.item.specs} className="mt-0.5" />
                          <p className="text-xs text-slate-500 mt-0.5">
                            {[l.item.isSerialized ? 'Serialized' : null, l.item.requiresImei ? 'IMEI required' : null, l.item.qcRequired ? 'QC required' : null].filter(Boolean).join(' - ')}
                          </p>
                          <p className="text-xs text-slate-500 tabular mt-0.5">
                            Ordered {formatQty(l.orderedQty)} - received {formatQty(l.receivedQty)} - <span className="font-medium text-slate-700">remaining {formatQty(l.remainingQty)}</span> {l.item.unitCode}
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 lg:w-[560px] shrink-0">
                        <Field label="Qty to receive" error={err('qty')}>
                          <Input sanitize="decimal" value={s.qty} disabled={!s.include} onChange={(e) => update(l.id, { qty: e.target.value })} className="text-right tabular" error={Boolean(err('qty')) || over} aria-label="Quantity to receive" />
                          {over && !err('qty') && <p className="text-[11px] text-amber-700 mt-1">Above remaining; allowed only within the over-receipt tolerance.</p>}
                        </Field>
                        <Field label="Unit cost" error={err('unitCost')}>
                          <Input sanitize="decimal" value={s.unitCost} disabled={!s.include} onChange={(e) => update(l.id, { unitCost: e.target.value })} className="text-right tabular" error={Boolean(err('unitCost'))} aria-label="Unit cost" />
                        </Field>
                        <Field label="Bin" error={err('binId')}>
                          <Select value={s.binId} disabled={!s.include || !warehouseId} onChange={(e) => update(l.id, { binId: e.target.value })} placeholder={warehouse.isLoading ? 'Loading...' : bins.length ? 'No bin' : 'No bins defined'} options={bins} error={Boolean(err('binId'))} aria-label="Bin" />
                        </Field>
                        <Field label="Condition note" error={err('conditionNote')}>
                          <Input value={s.conditionNote} disabled={!s.include} maxLength={300} sanitize="singleLine" onChange={(e) => update(l.id, { conditionNote: e.target.value })} error={Boolean(err('conditionNote'))} aria-label="Condition note" placeholder="Damaged box..." />
                        </Field>
                      </div>
                    </div>
                    {err('line') && <p className="text-xs text-red-600">{err('line')}</p>}
                    {l.item.isSerialized && s.include && (
                      <div>
                        <SerialCapturePanel serials={s.serials} onChange={(next) => update(l.id, { serials: next })} expectedQty={qty} serialPattern={l.item.serialPattern} requiresImei={l.item.requiresImei} serverDuplicates={serverDuplicates} itemLabel={l.item.sku} />
                        {err('serials') && <p className="text-xs text-red-600 mt-1">{err('serials')}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
        {errors.lines && <p className="text-sm text-red-600">{errors.lines}</p>}

        {receivable.data?.receivable && receivable.data.lines.length > 0 && (
          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-xs text-slate-500">
              {included.length} of {receivable.data.lines.length} lines included into {byId(warehouseId)?.code ?? 'the selected warehouse'}.
            </p>
            <div className="flex items-center gap-2 justify-end">
              <Button variant="ghost" onClick={() => navigate('/purchases/receipts')} disabled={create.isPending}>
                Cancel
              </Button>
              <Button variant="secondary" icon={Save} loading={create.isPending} onClick={() => void submit(false)} disabled={!warehouseId}>
                Save as draft
              </Button>
              <Button icon={PackageCheck} loading={create.isPending} onClick={() => void submit(true)} disabled={!warehouseId}>
                Receive now
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
