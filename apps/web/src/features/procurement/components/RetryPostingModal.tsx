import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Modal } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useRetryPosting } from '../hooks';
import type { Grn, RetrySerials } from '../types';
import { SerialCapturePanel, type CapturedSerial } from './SerialCapturePanel';

/**
 * POSTING_FAILED recovery: edit the serials of serialized lines (typically duplicates rejected by
 * inventory) and re-emit the receipt. Lines left untouched keep their serials.
 */
export function RetryPostingModal({ grn, open, onClose }: { grn: Grn; open: boolean; onClose: () => void }) {
  const retry = useRetryPosting();
  const [serials, setSerials] = useState<Record<string, CapturedSerial[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverDuplicates, setServerDuplicates] = useState<string[]>([]);
  const serialized = grn.lines.filter((l) => l.item.isSerialized);

  useEffect(() => {
    if (!open) return;
    setSerials(Object.fromEntries(serialized.map((l) => [l.id, l.serials.map((s) => ({ serialNo: s.serialNo, imei: s.imei ?? '' }))])));
    setErrors({});
    // Serials named in the failure reason are highlighted so the inspector sees what to replace.
    const m = /\[([^\]]+)\]/.exec(grn.statusReason ?? '');
    setServerDuplicates(m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : []);
  }, [open, grn]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const changed: RetrySerials = {};
    for (const l of serialized) {
      const next = serials[l.id] ?? [];
      const same = next.length === l.serials.length && next.every((s, i) => s.serialNo === l.serials[i].serialNo && (s.imei || null) === (l.serials[i].imei ?? null));
      if (!same) changed[l.id] = next.map((s) => ({ serialNo: s.serialNo, imei: s.imei || null }));
    }
    try {
      const saved = await retry.mutateAsync({ id: grn.id, serials: Object.keys(changed).length ? changed : null });
      toast.success(`${saved.number} re-submitted for posting`);
      onClose();
    } catch (err) {
      const e = toApiError(err);
      const map: Record<string, string> = {};
      for (const d of e.details) {
        const m = /^lines\.(\d+)/.exec(d.path);
        if (m && grn.lines[Number(m[1])]) map[grn.lines[Number(m[1])].id] = d.message;
        const dups = (d as { duplicates?: unknown }).duplicates;
        if (Array.isArray(dups)) setServerDuplicates(dups.filter((x): x is string => typeof x === 'string'));
      }
      setErrors(map);
      toast.error(e.message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Fix serials and retry ${grn.number}`}
      description={grn.statusReason ?? 'Inventory rejected the posting. Correct the serials below and retry.'}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={retry.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={retry.isPending}>
            Retry posting
          </Button>
        </>
      }
    >
      {serialized.length === 0 ? (
        <p className="text-sm text-slate-600">This receipt has no serialized lines. Retrying re-sends it to inventory unchanged.</p>
      ) : (
        <div className="space-y-4">
          {serialized.map((l) => (
            <div key={l.id} className="space-y-1">
              <p className="text-sm font-medium text-slate-900">
                {l.item.name} <span className="text-xs text-slate-500 font-mono">{l.item.sku}</span>
              </p>
              <SerialCapturePanel serials={serials[l.id] ?? []} onChange={(next) => setSerials((prev) => ({ ...prev, [l.id]: next }))} expectedQty={l.qty} serialPattern={l.item.serialPattern} requiresImei={l.item.requiresImei} serverDuplicates={serverDuplicates} />
              {errors[l.id] && <p className="text-xs text-red-600">{errors[l.id]}</p>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
