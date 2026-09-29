import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { formatDocumentNumber } from '@b2b/shared';
import { Button, Field, Input, Modal } from '../../../components/ui';
import { api, toApiError } from '../../../lib/api';
import { usePermission } from '../../../lib/auth';
import type { PoFormOptions } from '../types';

/**
 * Zoho's gear next to "Purchase Order#": choose auto-numbering (and adjust prefix / next number
 * when allowed) or type a number manually for this order only.
 */
export function PoNumberSettingsModal({ open, onClose, sequence, manualValue, onApply }: { open: boolean; onClose: () => void; sequence: PoFormOptions['nextNumber']; manualValue: string; onApply: (value: string) => void }) {
  const { canManageSettings } = usePermission();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'auto' | 'manual'>(manualValue ? 'manual' : 'auto');
  const [prefix, setPrefix] = useState(sequence.prefix);
  const [next, setNext] = useState(String(sequence.nextNumber));
  const [padding, setPadding] = useState(String(sequence.padding));
  const [manual, setManual] = useState(manualValue);

  useEffect(() => {
    if (!open) return;
    setMode(manualValue ? 'manual' : 'auto');
    setPrefix(sequence.prefix);
    setNext(String(sequence.nextNumber));
    setPadding(String(sequence.padding));
    setManual(manualValue);
  }, [open, manualValue, sequence]);

  const save = useMutation({
    mutationFn: () => api.put('/settings/document-sequences/PURCHASE_ORDER', { prefix, nextNumber: Number(next), padding: Number(padding) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchase-orders', 'form-options'] });
      void qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const apply = async () => {
    if (mode === 'manual') {
      if (!manual.trim()) {
        toast.error('Enter a purchase order number');
        return;
      }
      onApply(manual.trim());
      onClose();
      return;
    }
    const changed = prefix !== sequence.prefix || Number(next) !== sequence.nextNumber || Number(padding) !== sequence.padding;
    if (changed && canManageSettings) {
      try {
        await save.mutateAsync();
        toast.success('Numbering updated');
      } catch (err) {
        toast.error(toApiError(err).message);
        return;
      }
    }
    onApply('');
    onClose();
  };

  const preview = formatDocumentNumber(prefix, Number(next) || 1, Number(padding) || 0);

  return (
    <Modal open={open} onClose={onClose} title="Configure Purchase Order Number Preferences" size="md" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => void apply()} loading={save.isPending}>Save</Button></>}>
      <p className="text-sm text-slate-600 mb-4">Your purchase order numbers are set on auto-generate mode to save your time. Are you sure about changing this setting?</p>
      <div className="space-y-4">
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input type="radio" name="po-number-mode" className="mt-1 h-4 w-4 text-brand-600" checked={mode === 'auto'} onChange={() => setMode('auto')} />
          <span className="text-sm">
            <span className="font-medium text-slate-900">Continue auto-generating purchase order numbers</span>
            <span className="block text-xs text-slate-500">Next number: <span className="font-mono">{preview}</span></span>
          </span>
        </label>
        {mode === 'auto' && (
          <div className="grid grid-cols-3 gap-3 pl-7">
            <Field label="Prefix" htmlFor="seq-prefix">
              <Input id="seq-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} disabled={!canManageSettings} className="font-mono" />
            </Field>
            <Field label="Next Number" htmlFor="seq-next">
              <Input id="seq-next" inputMode="numeric" value={next} onChange={(e) => setNext(e.target.value.replace(/\D/g, ''))} disabled={!canManageSettings} className="font-mono tabular" />
            </Field>
            <Field label="Digits" htmlFor="seq-pad">
              <Input id="seq-pad" inputMode="numeric" value={padding} onChange={(e) => setPadding(e.target.value.replace(/\D/g, '').slice(0, 2))} disabled={!canManageSettings} className="font-mono tabular" />
            </Field>
            {!canManageSettings && <p className="col-span-3 text-xs text-slate-500">Only administrators can change the numbering sequence.</p>}
          </div>
        )}
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input type="radio" name="po-number-mode" className="mt-1 h-4 w-4 text-brand-600" checked={mode === 'manual'} onChange={() => setMode('manual')} />
          <span className="text-sm">
            <span className="font-medium text-slate-900">Enter purchase order numbers manually</span>
            <span className="block text-xs text-slate-500">Applies to this order only. The number must be unique.</span>
          </span>
        </label>
        {mode === 'manual' && (
          <div className="pl-7">
            <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="e.g. PO/26-27/0117" className="font-mono sm:max-w-xs" autoFocus />
          </div>
        )}
      </div>
    </Modal>
  );
}
