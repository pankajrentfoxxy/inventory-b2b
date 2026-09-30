import { Check, X } from 'lucide-react';
import { Input, Select } from '../../../components/ui';
import { cn } from '../../../lib/utils';
import type { ConditionGrade, QcChecklistItem, QcDefectCode, QcResultValue } from '../types';

/** Large-tap PASS / FAIL toggle (min 44px targets for handheld inspection). */
export function PassFailToggle({ value, onChange, disabled, size = 'lg', name }: { value: QcResultValue | ''; onChange: (v: QcResultValue) => void; disabled?: boolean; size?: 'md' | 'lg'; name?: string }) {
  const h = size === 'lg' ? 'h-11 px-4 text-sm' : 'h-9 px-3 text-xs';
  return (
    <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 gap-0.5" role="radiogroup" aria-label={name ?? 'Result'}>
      <button type="button" role="radio" aria-checked={value === 'PASS'} disabled={disabled} onClick={() => onChange('PASS')} className={cn('inline-flex items-center gap-1.5 rounded-md font-semibold transition-colors disabled:opacity-50', h, value === 'PASS' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:bg-emerald-50 hover:text-emerald-700')}>
        <Check className="w-4 h-4" /> Pass
      </button>
      <button type="button" role="radio" aria-checked={value === 'FAIL'} disabled={disabled} onClick={() => onChange('FAIL')} className={cn('inline-flex items-center gap-1.5 rounded-md font-semibold transition-colors disabled:opacity-50', h, value === 'FAIL' ? 'bg-red-600 text-white shadow-sm' : 'text-slate-600 hover:bg-red-50 hover:text-red-700')}>
        <X className="w-4 h-4" /> Fail
      </button>
    </div>
  );
}

/** Defect codes as toggle chips (multi-select) with the description on hover. */
export function DefectCodeChips({ codes, value, onChange, disabled, required, error }: { codes: QcDefectCode[]; value: string[]; onChange: (v: string[]) => void; disabled?: boolean; required?: boolean; error?: string }) {
  const active = codes.filter((c) => c.status === 'ACTIVE' || value.includes(c.code));
  const toggle = (code: string) => onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code]);
  return (
    <div>
      {active.length === 0 ? (
        <p className="text-xs text-slate-500">No defect codes defined. Add them under Quality / Checklists.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Defect codes">
          {active.map((c) => {
            const on = value.includes(c.code);
            return (
              <button key={c.code} type="button" disabled={disabled} title={c.description} aria-pressed={on} onClick={() => toggle(c.code)} className={cn('h-8 px-2.5 rounded-full text-xs font-medium ring-1 ring-inset transition-colors disabled:opacity-50', on ? 'bg-red-600 text-white ring-red-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50', required && !on && value.length === 0 && 'ring-red-300')}>
                {c.code}
              </button>
            );
          })}
        </div>
      )}
      {error && (
        <p className="text-xs text-red-600 mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function GradeSelect({ grades, value, onChange, disabled, className }: { grades: ConditionGrade[]; value: string; onChange: (v: string) => void; disabled?: boolean; className?: string }) {
  const rows = [...grades].filter((g) => g.status === 'ACTIVE' || g.code === value).sort((a, b) => a.sortOrder - b.sortOrder);
  return <Select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder="No grade" options={rows.map((g) => ({ value: g.code, label: `${g.code} - ${g.name}${g.sellable ? '' : ' (not sellable)'}` }))} aria-label="Condition grade" className={className} />;
}

/**
 * Checklist answers keyed by item id: PASS_FAIL -> 'PASS' | 'FAIL', NUMERIC -> number, TEXT / PHOTO ->
 * string. Critical items are flagged; the server forces the unit to FAIL when a critical item fails.
 */
export function ChecklistAnswers({ items, value, onChange, disabled }: { items: QcChecklistItem[]; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; disabled?: boolean }) {
  const set = (id: string, v: unknown) => onChange({ ...value, [id]: v });
  if (items.length === 0) return null;
  return (
    <ul className="space-y-2">
      {items.map((it) => {
        const v = value[it.id];
        const min = it.minValue === null ? null : Number(it.minValue);
        const max = it.maxValue === null ? null : Number(it.maxValue);
        const numeric = typeof v === 'number' ? v : NaN;
        const outOfRange = it.kind === 'NUMERIC' && !Number.isNaN(numeric) && ((min !== null && numeric < min) || (max !== null && numeric > max));
        return (
          <li key={it.id} className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 sm:items-center">
            <div className="min-w-0">
              <p className="text-sm text-slate-800">
                {it.seq}. {it.label}
                {it.critical && <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-red-700 bg-red-50 ring-1 ring-inset ring-red-200 rounded px-1.5 py-0.5">critical</span>}
              </p>
              {it.kind === 'NUMERIC' && (min !== null || max !== null) && (
                <p className={cn('text-[11px]', outOfRange ? 'text-red-600' : 'text-slate-500')}>
                  Range {min ?? '-'} to {max ?? '-'}
                  {outOfRange ? ' (out of range)' : ''}
                </p>
              )}
            </div>
            <div className="sm:w-56">
              {it.kind === 'PASS_FAIL' && <PassFailToggle size="md" name={it.label} value={v === 'PASS' || v === 'FAIL' ? v : ''} onChange={(r) => set(it.id, r)} disabled={disabled} />}
              {it.kind === 'NUMERIC' && <Input sanitize="signedDecimal" value={v === undefined || v === null ? '' : String(v)} onChange={(e) => set(it.id, e.target.value.trim() === '' ? undefined : Number(e.target.value))} disabled={disabled} className="text-right tabular" aria-label={it.label} error={outOfRange} />}
              {(it.kind === 'TEXT' || it.kind === 'PHOTO') && <Input value={typeof v === 'string' ? v : ''} onChange={(e) => set(it.id, e.target.value)} disabled={disabled} placeholder={it.kind === 'PHOTO' ? 'Photo reference / URL' : 'Observation'} aria-label={it.label} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
