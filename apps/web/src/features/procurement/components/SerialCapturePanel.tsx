import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { AlertTriangle, ScanLine, Trash2, X } from 'lucide-react';
import { Button, Input } from '../../../components/ui';
import { cn, formatQty } from '../../../lib/utils';

export interface CapturedSerial {
  serialNo: string;
  imei: string;
}

export interface SerialCapturePanelProps {
  serials: CapturedSerial[];
  onChange: (next: CapturedSerial[]) => void;
  /** Quantity being received; the counter reads "n of qty". */
  expectedQty: number;
  /** The item's own serial pattern from the API (never a UI-invented regex). */
  serialPattern: string | null;
  requiresImei: boolean;
  /** Serials flagged by the server (SERIAL_DUPLICATE details[0].duplicates) shown in red. */
  serverDuplicates?: string[];
  disabled?: boolean;
  itemLabel?: string;
}

function compilePattern(pattern: string | null): RegExp | null {
  if (!pattern) return null;
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

/** Splits a pasted blob of serials on newline / comma / whitespace. */
export function splitSerials(text: string): string[] {
  return text
    .split(/[\r\n,;\t ]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Focus-keeping serial capture for barcode scanners and keyboards: Enter adds a serial (with an
 * optional IMEI for items that need it), paste splits many, duplicates are blocked (red) and pattern
 * mismatches are highlighted (amber). The server re-validates everything on submit.
 */
export function SerialCapturePanel({ serials, onChange, expectedQty, serialPattern, requiresImei, serverDuplicates = [], disabled, itemLabel }: SerialCapturePanelProps) {
  const [serialInput, setSerialInput] = useState('');
  const [imeiInput, setImeiInput] = useState('');
  const [rejected, setRejected] = useState<string | null>(null);
  const serialRef = useRef<HTMLInputElement>(null);
  const imeiRef = useRef<HTMLInputElement>(null);
  const regex = useMemo(() => compilePattern(serialPattern), [serialPattern]);

  const keys = useMemo(() => new Set(serials.map((s) => s.serialNo.toUpperCase())), [serials]);
  const mismatches = useMemo(() => (regex ? serials.filter((s) => !regex.test(s.serialNo)).length : 0), [serials, regex]);
  const serverDupSet = useMemo(() => new Set(serverDuplicates.map((s) => s.toUpperCase())), [serverDuplicates]);
  const complete = serials.length === expectedQty;
  const over = serials.length > expectedQty;

  useEffect(() => {
    if (!disabled) serialRef.current?.focus();
  }, [disabled]);

  const add = (values: string[], imei = '') => {
    if (disabled) return;
    const next = [...serials];
    const seen = new Set(keys);
    let blocked: string | null = null;
    for (const raw of values) {
      const serialNo = raw.trim();
      if (!serialNo) continue;
      const key = serialNo.toUpperCase();
      if (seen.has(key)) {
        blocked = serialNo;
        continue;
      }
      seen.add(key);
      next.push({ serialNo, imei: imei.trim() });
    }
    if (next.length !== serials.length) onChange(next);
    setRejected(blocked);
    setSerialInput('');
    setImeiInput('');
    serialRef.current?.focus();
  };

  const onSerialKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!serialInput.trim()) return;
    if (requiresImei && !imeiInput.trim()) {
      imeiRef.current?.focus();
      return;
    }
    add([serialInput], imeiInput);
  };
  const onImeiKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!serialInput.trim()) {
      serialRef.current?.focus();
      return;
    }
    add([serialInput], imeiInput);
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    const parts = splitSerials(text);
    if (parts.length <= 1) return;
    e.preventDefault();
    add(parts);
  };

  const remove = (index: number) => {
    onChange(serials.filter((_, i) => i !== index));
    serialRef.current?.focus();
  };

  return (
    <div className={cn('rounded-lg border bg-slate-50/60 p-3 space-y-3', over ? 'border-red-300' : complete ? 'border-emerald-300' : 'border-slate-200')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <ScanLine className="w-4 h-4 text-slate-500" />
          <span className="font-medium text-slate-800">Serials{itemLabel ? ` for ${itemLabel}` : ''}</span>
          <span className={cn('tabular text-xs px-2 py-0.5 rounded-full ring-1 ring-inset', over ? 'bg-red-50 text-red-700 ring-red-200' : complete ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-700 ring-slate-200')}>
            {serials.length} of {formatQty(expectedQty)}
          </span>
          {mismatches > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-700">
              <AlertTriangle className="w-3.5 h-3.5" /> {mismatches} pattern mismatch{mismatches === 1 ? '' : 'es'}
            </span>
          )}
        </div>
        {serials.length > 0 && !disabled && (
          <Button variant="ghost" size="xs" icon={Trash2} onClick={() => onChange([])}>
            Clear all
          </Button>
        )}
      </div>

      <div className={cn('grid gap-2', requiresImei ? 'grid-cols-1 sm:grid-cols-[1fr_1fr_auto]' : 'grid-cols-[1fr_auto]')}>
        <Input
          ref={serialRef}
          value={serialInput}
          onChange={(e) => {
            setSerialInput(e.target.value);
            if (rejected) setRejected(null);
          }}
          onKeyDown={onSerialKey}
          onPaste={onPaste}
          placeholder={serialPattern ? `Scan or type a serial (pattern ${serialPattern})` : 'Scan or type a serial, press Enter'}
          aria-label="Serial number"
          autoComplete="off"
          disabled={disabled}
          error={Boolean(rejected)}
          className="font-mono"
        />
        {requiresImei && <Input ref={imeiRef} value={imeiInput} onChange={(e) => setImeiInput(e.target.value)} onKeyDown={onImeiKey} placeholder="IMEI" aria-label="IMEI" sanitize="digits" maxLength={20} autoComplete="off" disabled={disabled} className="font-mono" />}
        <Button variant="secondary" onClick={() => serialInput.trim() && add([serialInput], imeiInput)} disabled={disabled || !serialInput.trim() || (requiresImei && !imeiInput.trim())}>
          Add
        </Button>
      </div>
      {rejected && (
        <p className="text-xs text-red-600" role="alert">
          {rejected} is already in this list.
        </p>
      )}
      <p className="text-[11px] text-slate-500">Paste many serials at once; they are split on new lines, commas or spaces.{requiresImei ? ' This item needs an IMEI for every unit.' : ''}</p>

      {serials.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto" aria-label="Captured serials">
          {serials.map((s, i) => {
            const key = s.serialNo.toUpperCase();
            const dupOnServer = serverDupSet.has(key);
            const mismatch = regex ? !regex.test(s.serialNo) : false;
            const missingImei = requiresImei && !s.imei;
            return (
              <li
                key={`${key}-${i}`}
                title={dupOnServer ? 'Already exists in stock' : mismatch ? 'Does not match the item serial pattern' : missingImei ? 'IMEI missing' : undefined}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-mono ring-1 ring-inset',
                  dupOnServer ? 'bg-red-50 text-red-700 ring-red-300' : mismatch || missingImei ? 'bg-amber-50 text-amber-800 ring-amber-300' : 'bg-white text-slate-800 ring-slate-200',
                )}
              >
                <span>{s.serialNo}</span>
                {s.imei && <span className="text-slate-400">/ {s.imei}</span>}
                {!disabled && (
                  <button type="button" onClick={() => remove(i)} aria-label={`Remove ${s.serialNo}`} className="text-slate-400 hover:text-red-600">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
