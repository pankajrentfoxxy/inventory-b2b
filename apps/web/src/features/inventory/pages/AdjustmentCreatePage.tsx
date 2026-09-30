import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, EmptyState, Field, IconButton, Input, PageHeader, Select, Textarea } from '../../../components/ui';
import { shouldRetryWithSameKey, useIdempotencyKey } from '../../../hooks/useIdempotencyKey';
import { toApiError } from '../../../lib/api';
import { humanize } from '../../../lib/utils';
import { BinSelect } from '../components/BinSelect';
import { ProductPicker } from '../components/ProductPicker';
import { SerialsTextarea, parseSerials } from '../components/SerialsTextarea';
import { WarehousePicker } from '../components/WarehousePicker';
import { describeInventoryError, lineIndexOf } from '../components/errors';
import { useCreateAdjustment, useProductRefs, useScopedWarehouses, useSubmitAdjustment } from '../hooks';
import { ADJUSTMENT_BUCKETS, ADJUSTMENT_REASONS, type AdjustmentInput, type AdjustmentLineInput, type ProductLookup } from '../types';

interface LineDraft {
  key: string;
  itemId: string;
  product: ProductLookup | null;
  bucket: (typeof ADJUSTMENT_BUCKETS)[number];
  binId: string;
  qtyDelta: string;
  unitCost: string;
  serialsText: string;
}

let seq = 0;
const newLine = (itemId = ''): LineDraft => ({ key: `l${++seq}`, itemId, product: null, bucket: 'AVAILABLE', binId: '', qtyDelta: '', unitCost: '', serialsText: '' });

type LineErrors = Record<string, string>;

export function AdjustmentCreatePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const scoped = useScopedWarehouses();
  const create = useCreateAdjustment();
  const submit = useSubmitAdjustment();
  const idempotency = useIdempotencyKey();

  const [warehouseId, setWarehouseId] = useState('');
  const [reasonCode, setReasonCode] = useState<string>('COUNT_CORRECTION');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>(() => [newLine(params.get('itemId') ?? '')]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lineErrors, setLineErrors] = useState<Record<string, LineErrors>>({});

  // Default to the first scoped warehouse.
  useEffect(() => {
    if (!warehouseId && scoped.defaultId) setWarehouseId(scoped.defaultId);
  }, [scoped.defaultId, warehouseId]);

  // An item preselected through the URL (from the stock page) needs a label until the picker resolves it.
  const prefilled = useProductRefs(lines.filter((l) => l.itemId && !l.product).map((l) => l.itemId));
  useEffect(() => {
    if (prefilled.map.size === 0) return;
    setLines((ls) => {
      const needs = ls.some((l) => l.itemId && !l.product && prefilled.map.has(l.itemId));
      return needs ? ls.map((l) => (l.itemId && !l.product && prefilled.map.get(l.itemId) ? { ...l, product: prefilled.map.get(l.itemId)! } : l)) : ls;
    });
  }, [prefilled.map]);

  const updateLine = (key: string, patch: Partial<LineDraft>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setLineErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  };
  const removeLine = (key: string) => setLines((ls) => (ls.length === 1 ? [newLine()] : ls.filter((l) => l.key !== key)));

  const payload = useMemo<AdjustmentInput>(
    () => ({
      warehouseId,
      reasonCode: reasonCode as AdjustmentInput['reasonCode'],
      notes: notes.trim() || null,
      lines: lines.map<AdjustmentLineInput>((l) => ({
        itemId: l.itemId,
        binId: l.binId || null,
        bucket: l.bucket,
        qtyDelta: l.qtyDelta === '' || l.qtyDelta === '-' ? 0 : Number(l.qtyDelta),
        unitCost: l.unitCost === '' ? null : Number(l.unitCost),
        serialNumbers: l.product?.isSerialized ? parseSerials(l.serialsText) : [],
      })),
    }),
    [warehouseId, reasonCode, notes, lines],
  );

  const applyError = (err: unknown) => {
    const e = toApiError(err);
    const top: Record<string, string> = {};
    const perLine: Record<string, LineErrors> = {};
    for (const d of e.details) {
      const idx = lineIndexOf(d.path);
      if (idx !== null && lines[idx]) {
        // `lines.0.serialNumbers.3` -> serialNumbers: nested paths land on the line's field.
        const field = d.path.split('.')[2] ?? 'line';
        perLine[lines[idx].key] = { ...(perLine[lines[idx].key] ?? {}), [field]: d.message };
      } else if (d.path) top[d.path] = d.message;
    }
    setErrors(top);
    setLineErrors(perLine);
    toast.error(describeInventoryError(e));
    return e;
  };

  const save = async (andSubmit: boolean) => {
    setErrors({});
    setLineErrors({});
    let created;
    try {
      created = await create.mutateAsync({ payload, idempotencyKey: idempotency.keyFor(payload) });
      idempotency.reset();
    } catch (err) {
      const e = applyError(err);
      if (!shouldRetryWithSameKey(e.status)) idempotency.reset();
      return;
    }
    if (!andSubmit) {
      toast.success(`${created.number} saved as draft`);
      navigate(`/inventory/adjustments/${created.id}`, { replace: true });
      return;
    }
    try {
      const submitted = await submit.mutateAsync(created.id);
      toast.success(submitted.status === 'POSTED' ? `${submitted.number} posted` : `${submitted.number} submitted for approval`);
    } catch (err) {
      // The draft exists; the detail page shows the problem and lets the user retry the submit.
      toast.error(`${created.number} saved as draft, but could not be submitted: ${describeInventoryError(toApiError(err))}`);
    }
    navigate(`/inventory/adjustments/${created.id}`, { replace: true });
  };

  const pending = create.isPending || submit.isPending;
  const ready = Boolean(warehouseId) && lines.some((l) => l.itemId && Number(l.qtyDelta) !== 0);
  const crumbs = [{ label: 'Inventory' }, { label: 'Adjustments', to: '/inventory/adjustments' }, { label: 'New' }];

  return (
    <>
      <PageHeader title="New stock adjustment" breadcrumbs={crumbs} subtitle="Positive quantities add stock, negative quantities remove it. Adjustments above the approval threshold wait for a second person." />
      <div className="space-y-5">
        <Card>
          <CardBody className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Warehouse" required error={errors.warehouseId} htmlFor="adj-warehouse">
              <WarehousePicker id="adj-warehouse" value={warehouseId} onChange={(v) => { setWarehouseId(v); setLines((ls) => ls.map((l) => ({ ...l, binId: '' }))); }} error={Boolean(errors.warehouseId)} />
            </Field>
            <Field label="Reason" required error={errors.reasonCode} htmlFor="adj-reason">
              <Select id="adj-reason" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} options={ADJUSTMENT_REASONS.map((r) => ({ value: r, label: humanize(r) }))} error={Boolean(errors.reasonCode)} />
            </Field>
            <Field label="Notes" error={errors.notes} htmlFor="adj-notes" className="md:col-span-3">
              <Textarea id="adj-notes" rows={2} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder="Count sheet reference, who counted, why the stock differs" error={Boolean(errors.notes)} />
            </Field>
          </CardBody>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Lines" description="One line per item and bucket. Serialized items need one serial per unit." actions={<Button size="sm" variant="secondary" icon={Plus} onClick={() => setLines((ls) => [...ls, newLine()])}>Add line</Button>} />
          {errors.lines && <p className="px-5 pt-3 text-xs text-red-600" role="alert">{errors.lines}</p>}
          {!warehouseId ? (
            <EmptyState title="Choose a warehouse first" hint="Bins and stock checks depend on the warehouse." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200 bg-slate-50/60">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-semibold w-[28%]">Item</th>
                    <th className="text-left px-3 py-2.5 font-semibold w-36">Bucket</th>
                    <th className="text-left px-3 py-2.5 font-semibold w-44">Bin</th>
                    <th className="text-right px-3 py-2.5 font-semibold w-32">Qty change</th>
                    <th className="text-right px-3 py-2.5 font-semibold w-32">Unit cost</th>
                    <th className="text-left px-3 py-2.5 font-semibold">Serials</th>
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((l) => {
                    const le = lineErrors[l.key] ?? {};
                    const qty = Number(l.qtyDelta) || 0;
                    return (
                      <tr key={l.key} className="align-top">
                        <td className="px-4 py-3">
                          <ProductPicker value={l.itemId} onChange={(id, p) => updateLine(l.key, { itemId: id, product: p, serialsText: p?.isSerialized ? l.serialsText : '' })} selectedLabel={l.itemId ? prefilled.label(l.itemId) : undefined} error={Boolean(le.itemId)} />
                          {le.itemId && <p className="text-xs text-red-600 mt-1">{le.itemId}</p>}
                          {l.product && <p className="text-xs text-slate-500 mt-1">{l.product.unitCode}{l.product.isSerialized ? ' - serialized' : ''}</p>}
                        </td>
                        <td className="px-3 py-3">
                          <Select value={l.bucket} onChange={(e) => updateLine(l.key, { bucket: e.target.value as LineDraft['bucket'] })} options={ADJUSTMENT_BUCKETS.map((b) => ({ value: b, label: humanize(b) }))} error={Boolean(le.bucket)} />
                          {le.bucket && <p className="text-xs text-red-600 mt-1">{le.bucket}</p>}
                        </td>
                        <td className="px-3 py-3">
                          <BinSelect warehouseId={warehouseId} value={l.binId} onChange={(v) => updateLine(l.key, { binId: v })} error={Boolean(le.binId)} />
                          {le.binId && <p className="text-xs text-red-600 mt-1">{le.binId}</p>}
                        </td>
                        <td className="px-3 py-3">
                          <Input sanitize="signedDecimal" aria-label="Quantity change" value={l.qtyDelta} onChange={(e) => updateLine(l.key, { qtyDelta: e.target.value })} placeholder="-5 or 5" error={Boolean(le.qtyDelta || le.qty)} className="text-right tabular" />
                          {(le.qtyDelta || le.qty) && <p className="text-xs text-red-600 mt-1 text-right">{le.qtyDelta ?? le.qty}</p>}
                        </td>
                        <td className="px-3 py-3">
                          <Input sanitize="decimal" aria-label="Unit cost" value={l.unitCost} onChange={(e) => updateLine(l.key, { unitCost: e.target.value })} placeholder="Avg cost" error={Boolean(le.unitCost)} className="text-right tabular" disabled={qty < 0} />
                          {le.unitCost && <p className="text-xs text-red-600 mt-1 text-right">{le.unitCost}</p>}
                        </td>
                        <td className="px-3 py-3">
                          {l.product?.isSerialized ? (
                            <SerialsTextarea value={l.serialsText} onChange={(t) => updateLine(l.key, { serialsText: t })} expected={Math.abs(Math.trunc(qty))} error={le.serialNumbers} rows={2} />
                          ) : (
                            <span className="text-xs text-slate-400">{l.product ? 'Not serialized' : '-'}</span>
                          )}
                        </td>
                        <td className="px-2 py-3 text-right">
                          <IconButton icon={Trash2} label="Remove line" onClick={() => removeLine(l.key)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="sticky bottom-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-white/95 backdrop-blur border-t border-slate-200 flex items-center gap-2">
          <Button onClick={() => void save(false)} loading={create.isPending && !submit.isPending} disabled={!ready || pending} variant="secondary">
            Save draft
          </Button>
          <Button onClick={() => void save(true)} loading={submit.isPending} disabled={!ready || pending}>
            Save and submit
          </Button>
          <Button variant="ghost" onClick={() => navigate('/inventory/adjustments')} disabled={pending}>
            Cancel
          </Button>
        </div>
      </div>
    </>
  );
}
