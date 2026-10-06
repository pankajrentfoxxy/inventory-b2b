import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Field, IconButton, Input, Modal, Textarea } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { formatMoney, formatQty } from '../../../lib/utils';
import { useRevisePurchaseOrder } from '../hooks';
import type { PurchaseOrder, ReviseInput } from '../types';
import { LineSpecs } from './LineSpecs';
import { ProductPicker } from './pickers';
import { PoTotals } from './PoTotals';
import { effectiveTaxRate, emptyLine, lineFromProduct, lineToPayload, previewTotals, rentalTermsToForm, type PoLineFormValues } from './poForm.model';

/**
 * Revise an ISSUED / PARTIALLY_RECEIVED order: lines with receipts keep item and price (qty may not
 * drop below what was received); new lines can be added; a reason is required. The order goes back
 * to PENDING_APPROVAL with revision + 1.
 */
export function ReviseModal({ po, open, onClose, onRevised }: { po: PurchaseOrder; open: boolean; onClose: () => void; onRevised: (po: PurchaseOrder) => void }) {
  const revise = useRevisePurchaseOrder();
  const [lines, setLines] = useState<PoLineFormValues[]>([]);
  const [reason, setReason] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setLines(
      po.lines.map((l) => ({
        poLineId: l.id,
        itemId: l.itemId,
        itemName: l.item.name,
        itemSku: l.item.sku,
        specs: l.item.specs ?? null,
        unitCode: l.item.unitCode,
        orderedQty: String(l.orderedQty),
        unitPrice: String(l.unitPrice),
        taxRate: String(l.taxRate),
        defaultTaxRate: l.item.taxRate === null ? '' : String(l.item.taxRate),
        isSerialized: l.item.isSerialized,
        receivedQty: l.receivedQty,
        ...rentalTermsToForm(l),
      })),
    );
    setReason('');
    setExpectedDate(po.expectedDate ? po.expectedDate.slice(0, 10) : '');
    setNotes(po.notes ?? '');
    setErrors({});
  }, [open, po]);

  const totals = useMemo(
    () => previewTotals({ supplierId: po.supplierId, supplierName: '', supplierGstin: '', supplierStateCode: po.supplier.stateCode ?? '', shipToWarehouseId: po.shipToWarehouseId, shipToStateCode: po.shipTo.stateCode, orderDate: '', expectedDate, paymentTermId: '', discountType: po.discountType, discountValue: String(po.discountValue), notes, terms: '', lines }),
    [po, lines, expectedDate, notes],
  );

  const update = (i: number, patch: Partial<PoLineFormValues>) => setLines((prev) => prev.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  const submit = async () => {
    const payload: ReviseInput = { reason: reason.trim(), lines: lines.map(lineToPayload), expectedDate: expectedDate || null, notes: notes.trim() || null };
    try {
      const saved = await revise.mutateAsync({ id: po.id, payload });
      toast.success(`${saved.number} revised to revision ${saved.revision}; awaiting approval`);
      onRevised(saved);
      onClose();
    } catch (err) {
      const e = toApiError(err);
      const map: Record<string, string> = {};
      e.details.forEach((d) => {
        if (d.path) map[d.path] = d.message;
      });
      setErrors(map);
      toast.error(e.message);
    }
  };

  const reasonOk = reason.trim().length >= 3;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Revise ${po.number}`}
      description={`Revision ${po.revision + 1} will need approval again. Lines with receipts keep their item and price.`}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={revise.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={revise.isPending} disabled={!reasonOk || lines.length === 0}>
            Submit revision
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Reason for revision" required error={errors.reason}>
          <Textarea rows={2} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="At least 3 characters; recorded on the revision" autoFocus />
        </Field>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm border-collapse">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-slate-500 border-y border-slate-200 bg-slate-50/60">
                <th className="text-left font-semibold px-3 py-2 w-[30%]">Laptop</th>
                <th className="text-right font-semibold px-3 py-2">Received</th>
                <th className="text-right font-semibold px-3 py-2 w-[10%]">Quantity</th>
                <th className="text-right font-semibold px-3 py-2 w-[13%]">Rate</th>
                <th className="text-right font-semibold px-3 py-2 w-[13%]">Monthly rental</th>
                <th className="text-right font-semibold px-3 py-2 w-[11%]">Tenure (months)</th>
                <th className="text-right font-semibold px-3 py-2 w-[8%]">GST %</th>
                <th className="text-right font-semibold px-3 py-2">Amount</th>
                <th className="w-9" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l, i) => {
                const locked = l.receivedQty > 0;
                const lineErr = errors[`lines.${i}`];
                return (
                  <tr key={l.poLineId ?? `new-${i}`} className="align-top">
                    <td className="px-3 py-2">
                      <ProductPicker
                        value={l.itemId}
                        selectedLabel={l.itemName ? `${l.itemName}${l.itemSku ? ` (${l.itemSku})` : ''}` : undefined}
                        disabled={locked}
                        excludeIds={lines.filter((x, k) => k !== i && x.itemId).map((x) => x.itemId)}
                        error={Boolean(errors[`lines.${i}.itemId`] || lineErr)}
                        onChange={(id, p) => (p ? update(i, lineFromProduct(p, l)) : update(i, { itemId: id }))}
                        size="sm"
                      />
                      <LineSpecs specs={l.specs} className="mt-1.5" />
                      {(errors[`lines.${i}.itemId`] || lineErr) && <p className="text-xs text-red-600 mt-1">{errors[`lines.${i}.itemId`] ?? lineErr}</p>}
                    </td>
                    <td className="px-3 py-2 text-right tabular text-slate-600">{locked ? formatQty(l.receivedQty) : <span className="text-slate-300">-</span>}</td>
                    <td className="px-3 py-2">
                      <Input sanitize="integer" aria-label="Quantity" className="text-right tabular h-8 text-xs" value={l.orderedQty} onChange={(e) => update(i, { orderedQty: e.target.value })} error={Boolean(errors[`lines.${i}.orderedQty`])} />
                      {errors[`lines.${i}.orderedQty`] ? <p className="text-xs text-red-600 mt-1">{errors[`lines.${i}.orderedQty`]}</p> : locked ? <p className="text-[11px] text-slate-400 mt-1">min {formatQty(l.receivedQty)}</p> : null}
                    </td>
                    <td className="px-3 py-2">
                      <Input sanitize="decimal" aria-label="Unit price" className="text-right tabular h-8 text-xs" value={l.unitPrice} disabled={locked} onChange={(e) => update(i, { unitPrice: e.target.value })} error={Boolean(errors[`lines.${i}.unitPrice`])} />
                      {errors[`lines.${i}.unitPrice`] && <p className="text-xs text-red-600 mt-1">{errors[`lines.${i}.unitPrice`]}</p>}
                    </td>
                    <td className="px-3 py-2">
                      <Input sanitize="decimal" aria-label="Monthly rental" className="text-right tabular h-8 text-xs" value={l.monthlyRentalAmount} onChange={(e) => update(i, { monthlyRentalAmount: e.target.value })} error={Boolean(errors[`lines.${i}.monthlyRentalAmount`])} />
                      {errors[`lines.${i}.monthlyRentalAmount`] && <p className="text-xs text-red-600 mt-1">{errors[`lines.${i}.monthlyRentalAmount`]}</p>}
                    </td>
                    <td className="px-3 py-2">
                      <Input sanitize="integer" aria-label="Tenure in months" className="text-right tabular h-8 text-xs" value={l.tenureMonths} onChange={(e) => update(i, { tenureMonths: e.target.value })} error={Boolean(errors[`lines.${i}.tenureMonths`])} />
                      {errors[`lines.${i}.tenureMonths`] && <p className="text-xs text-red-600 mt-1">{errors[`lines.${i}.tenureMonths`]}</p>}
                    </td>
                    <td className="px-3 py-2">
                      <Input sanitize="decimal" aria-label="Tax rate" className="text-right tabular h-8 text-xs" value={l.taxRate} placeholder={l.defaultTaxRate || '0'} onChange={(e) => update(i, { taxRate: e.target.value })} />
                      <p className="text-[11px] text-slate-400 mt-1 text-right">{effectiveTaxRate(l)}%</p>
                    </td>
                    <td className="px-3 py-2 text-right tabular font-medium text-slate-900 leading-8">{formatMoney(totals.lines[i]?.amount ?? 0)}</td>
                    <td className="px-1 py-2">
                      <IconButton icon={Trash2} label="Remove line" size="sm" disabled={locked || lines.length === 1} onClick={() => setLines((prev) => prev.filter((_, k) => k !== i))} className="text-slate-400 hover:text-red-600" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {errors.lines && <p className="text-sm text-red-600">{errors.lines}</p>}
        <Button variant="secondary" size="sm" icon={Plus} onClick={() => setLines((prev) => [...prev, emptyLine()])}>
          Add laptop
        </Button>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-3">
            <Field label="Expected date" error={errors.expectedDate} htmlFor="revise-expected">
              <Input id="revise-expected" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
            </Field>
            <Field label="Notes" error={errors.notes}>
              <Textarea rows={2} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
          <PoTotals totals={totals} intraState={po.intraState} note="Preview only; discount and tax treatment stay as on the original order." currency={po.currency} />
        </div>
      </div>
    </Modal>
  );
}
