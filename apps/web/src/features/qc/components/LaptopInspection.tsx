import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Hand, Laptop, PauseCircle, Save, X } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Field, Input } from '../../../components/ui';
import { LAPTOP_SPEC_FIELDS, LaptopSpecsView, type LaptopSpecs } from '../../../components/LaptopSpecs';
import { toApiError } from '../../../lib/api';
import { cn, formatDateTime, humanize } from '../../../lib/utils';
import { useConditionGrades, useDefectCodes, useSaveResults } from '../hooks';
import { LAPTOP_MISSING_PARTS, LAPTOP_SYSTEM_DEFECTS, type LaptopCheck, type LaptopMissingPart, type LaptopSpecKey, type QcLotDetail, type QcResultValue, type QcUnitResult, type UnitResultInput } from '../types';
import { ChecklistAnswers, DefectCodeChips, GradeSelect } from './inputs';

/* ---- state ------------------------------------------------------------------------------------ */

interface SpecCheckState {
  match: boolean;
  actual: string;
}

export interface LaptopRowState {
  serialNo: string;
  result: QcResultValue | '';
  gradeCode: string;
  /** Manually picked defect codes only; the server adds SPEC_MISMATCH / NO_POWER / MISSING_PARTS itself. */
  defectCodes: string[];
  remarks: string;
  checklistAnswers: Record<string, unknown>;
  specChecks: Record<LaptopSpecKey, SpecCheckState>;
  powersOn: boolean;
  missingParts: LaptopMissingPart[];
  assetTag: string;
  dirty: boolean;
  saved: QcUnitResult | null;
}

/** Field errors of one serial keyed by the path after `results.N.` ("result", "remarks", "laptop.specChecks.ram.actual", ...). */
type RowErrors = Record<string, string>;

const SYSTEM_DEFECTS: readonly string[] = LAPTOP_SYSTEM_DEFECTS;
const SPEC_KEYS = LAPTOP_SPEC_FIELDS.map((f) => f.key) as LaptopSpecKey[];

function defaultSpecChecks(): Record<LaptopSpecKey, SpecCheckState> {
  return Object.fromEntries(SPEC_KEYS.map((k) => [k, { match: true, actual: '' }])) as Record<LaptopSpecKey, SpecCheckState>;
}

function rowFrom(serialNo: string, r: QcUnitResult | null): LaptopRowState {
  const check: LaptopCheck | null = r?.laptopCheck ?? null;
  const specChecks = defaultSpecChecks();
  if (check?.specChecks) {
    for (const k of SPEC_KEYS) {
      const c = check.specChecks[k];
      if (c) specChecks[k] = { match: c.match !== false, actual: c.actual ?? '' };
    }
  }
  return {
    serialNo,
    result: r?.result ?? '',
    gradeCode: r?.gradeCode ?? '',
    defectCodes: (r?.defectCodes ?? []).filter((d) => !SYSTEM_DEFECTS.includes(d)),
    remarks: r?.remarks ?? '',
    checklistAnswers: (r?.checklistAnswers as Record<string, unknown> | null) ?? {},
    specChecks,
    powersOn: check ? check.powersOn !== false : true,
    missingParts: check?.missingParts ?? [],
    assetTag: check?.assetTag ?? '',
    dirty: false,
    saved: r,
  };
}

function rowsFrom(serials: string[], results: QcUnitResult[]): LaptopRowState[] {
  return serials.map((s) => rowFrom(s, results.find((r) => r.serialNo === s) ?? null));
}

/** Why a laptop cannot PASS (client-side guidance; the server enforces the same rule). */
function passBlockers(row: LaptopRowState): string[] {
  const mismatched = LAPTOP_SPEC_FIELDS.filter((f) => !row.specChecks[f.key].match).map((f) => f.label);
  return [
    mismatched.length ? `${mismatched.join(', ')} ${mismatched.length === 1 ? 'does' : 'do'} not match` : null,
    !row.powersOn ? 'it does not power on' : null,
    row.missingParts.length ? `parts are missing (${row.missingParts.map(humanize).join(', ')})` : null,
  ].filter((x): x is string => Boolean(x));
}

/** Defect codes the server will add automatically for a FAIL. */
function autoDefects(row: LaptopRowState): string[] {
  return [SPEC_KEYS.some((k) => !row.specChecks[k].match) ? 'SPEC_MISMATCH' : null, !row.powersOn ? 'NO_POWER' : null, row.missingParts.length ? 'MISSING_PARTS' : null].filter((x): x is string => Boolean(x));
}

function toPayload(row: LaptopRowState): UnitResultInput {
  const specChecks = Object.fromEntries(SPEC_KEYS.map((k) => [k, row.specChecks[k].match ? { match: true } : { match: false, actual: row.specChecks[k].actual.trim() || undefined }])) as LaptopCheck['specChecks'];
  return {
    serialNo: row.serialNo,
    result: row.result as QcResultValue,
    gradeCode: row.gradeCode || null,
    defectCodes: row.defectCodes,
    remarks: row.remarks.trim() || null,
    checklistAnswers: row.checklistAnswers,
    laptop: { specChecks, powersOn: row.powersOn, missingParts: row.missingParts, assetTag: row.assetTag.trim() || null },
  };
}

/* ---- small controls (segmented toggles with 44px targets on phones) ------------------------------ */

function Segmented<T extends string>({ value, onChange, options, disabled, label }: { value: T | ''; onChange: (v: T) => void; options: { value: T; label: string; tone: 'green' | 'red' | 'amber' | 'slate'; icon?: typeof Check; disabled?: boolean; title?: string }[]; disabled?: boolean; label: string }) {
  const on = { green: 'bg-emerald-600 text-white shadow-sm', red: 'bg-red-600 text-white shadow-sm', amber: 'bg-amber-500 text-white shadow-sm', slate: 'bg-slate-700 text-white shadow-sm' };
  const off = { green: 'hover:bg-emerald-50 hover:text-emerald-700', red: 'hover:bg-red-50 hover:text-red-700', amber: 'hover:bg-amber-50 hover:text-amber-700', slate: 'hover:bg-slate-100' };
  return (
    <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 gap-0.5" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const Icon = o.icon;
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled || o.disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn('inline-flex items-center justify-center gap-1.5 rounded-md font-semibold transition-colors h-11 sm:h-9 px-3 text-xs sm:text-[13px] min-w-[44px] disabled:opacity-40 disabled:cursor-not-allowed', active ? on[o.tone] : cn('text-slate-600', off[o.tone]))}
          >
            {Icon && <Icon className="w-4 h-4" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function StatusChip({ row }: { row: LaptopRowState }) {
  const r = row.saved?.result;
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      {r === 'PASS' ? (
        <Badge tone="green" dot>
          Pass
        </Badge>
      ) : r === 'FAIL' ? (
        <Badge tone="red" dot>
          Fail
        </Badge>
      ) : r === 'HOLD' ? (
        <Badge tone="amber" dot>
          Hold
        </Badge>
      ) : (
        <Badge tone="gray" dot>
          Not inspected
        </Badge>
      )}
      {row.dirty && <Badge tone="blue">Unsaved{row.result ? `: ${humanize(row.result)}` : ''}</Badge>}
    </span>
  );
}

/* ---- one laptop ------------------------------------------------------------------------------- */

function LaptopForm({ row, expected, onChange, onSave, saving, disabled, errors, grades, defects, checklist }: { row: LaptopRowState; expected: LaptopSpecs; onChange: (patch: Partial<LaptopRowState>) => void; onSave: () => void; saving: boolean; disabled: boolean; errors: RowErrors; grades: ReturnType<typeof useConditionGrades>['data']; defects: ReturnType<typeof useDefectCodes>['data']; checklist: QcLotDetail['checklist'] }) {
  const [checklistOpen, setChecklistOpen] = useState(false);
  const blockers = passBlockers(row);
  const auto = autoDefects(row);
  const needsManualDefect = row.result === 'FAIL' && auto.length === 0;
  const holdNeedsRemarks = row.result === 'HOLD' && !row.remarks.trim();
  const manualCodes = (defects ?? []).filter((d) => !SYSTEM_DEFECTS.includes(d.code));
  const rootError = errors._row ?? errors.laptop ?? errors.serialNo;

  const setSpec = (k: LaptopSpecKey, patch: Partial<SpecCheckState>) => {
    const next = { ...row.specChecks, [k]: { ...row.specChecks[k], ...patch } };
    const probe = { ...row, specChecks: next };
    onChange({ specChecks: next, ...(row.result === 'PASS' && passBlockers(probe).length ? { result: '' as const } : {}) });
  };
  const setPower = (on: boolean) => onChange({ powersOn: on, ...(!on && row.result === 'PASS' ? { result: '' as const } : {}) });
  const toggleMissing = (p: LaptopMissingPart) => {
    const next = row.missingParts.includes(p) ? row.missingParts.filter((x) => x !== p) : [...row.missingParts, p];
    onChange({ missingParts: next, ...(next.length && row.result === 'PASS' ? { result: '' as const } : {}) });
  };

  return (
    <div className="space-y-5 pt-3">
      {rootError && (
        <p className="text-sm text-red-600 flex items-start gap-1.5" role="alert">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {rootError}
        </p>
      )}

      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">1. Verify specifications</h4>
        <ul className="rounded-lg border border-slate-200 divide-y divide-slate-100 bg-white">
          {LAPTOP_SPEC_FIELDS.map((f) => {
            const c = row.specChecks[f.key];
            const err = errors[`laptop.specChecks.${f.key}.actual`] ?? errors[`laptop.specChecks.${f.key}`];
            return (
              <li key={f.key} className={cn('px-3 py-2.5', !c.match && 'bg-red-50/40')}>
                <div className="grid grid-cols-1 sm:grid-cols-[130px_minmax(0,1fr)_auto] gap-2 sm:items-center">
                  <span className="text-xs font-medium text-slate-500">{f.label}</span>
                  <span className="text-sm font-medium text-slate-900 break-words">{expected[f.key] || <span className="text-slate-400">-</span>}</span>
                  <Segmented
                    label={`${f.label} check`}
                    value={c.match ? 'MATCH' : 'MISMATCH'}
                    disabled={disabled}
                    onChange={(v) => setSpec(f.key, { match: v === 'MATCH' })}
                    options={[
                      { value: 'MATCH', label: 'Match', tone: 'green', icon: Check },
                      { value: 'MISMATCH', label: 'Mismatch', tone: 'red', icon: X },
                    ]}
                  />
                </div>
                {!c.match && (
                  <div className="mt-2 sm:pl-[138px]">
                    <Field label={`Actual ${f.label.toLowerCase()} found`} required error={err}>
                      <Input value={c.actual} maxLength={100} sanitize="singleLine" disabled={disabled} onChange={(e) => setSpec(f.key, { actual: e.target.value })} error={Boolean(err) || !c.actual.trim()} placeholder="What the laptop really has" aria-label={`Actual ${f.label}`} className="h-11 sm:h-9" />
                    </Field>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">2. Powers on</h4>
          <Segmented
            label="Powers on"
            value={row.powersOn ? 'YES' : 'NO'}
            disabled={disabled}
            onChange={(v) => setPower(v === 'YES')}
            options={[
              { value: 'YES', label: 'Yes', tone: 'green' },
              { value: 'NO', label: 'No', tone: 'red' },
            ]}
          />
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Asset tag</h4>
          <Field error={errors['laptop.assetTag']}>
            <Input value={row.assetTag} sanitize="upper" maxLength={40} disabled={disabled} onChange={(e) => onChange({ assetTag: e.target.value })} placeholder="Optional, e.g. TTSPL6047" className="font-mono h-11 sm:h-9" error={Boolean(errors['laptop.assetTag'])} aria-label="Asset tag" />
          </Field>
        </div>
      </section>

      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">3. Missing parts</h4>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Missing parts">
          {LAPTOP_MISSING_PARTS.map((p) => {
            const on = row.missingParts.includes(p);
            return (
              <button key={p} type="button" disabled={disabled} aria-pressed={on} onClick={() => toggleMissing(p)} className={cn('h-11 sm:h-8 px-3 rounded-full text-xs font-medium ring-1 ring-inset transition-colors disabled:opacity-50', on ? 'bg-red-600 text-white ring-red-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50')}>
                {humanize(p)}
              </button>
            );
          })}
        </div>
        {errors['laptop.missingParts'] && <p className="text-xs text-red-600 mt-1">{errors['laptop.missingParts']}</p>}
        {row.missingParts.length === 0 && <p className="text-[11px] text-slate-500 mt-1">Nothing selected means the laptop is complete.</p>}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4">
        <Field label="Condition grade" error={errors.gradeCode}>
          <GradeSelect grades={grades ?? []} value={row.gradeCode} onChange={(v) => onChange({ gradeCode: v })} disabled={disabled} className="h-11 sm:h-9" />
        </Field>
        <Field label="Remarks" required={row.result === 'HOLD'} error={errors.remarks ?? (holdNeedsRemarks ? 'Say why the laptop is on hold' : undefined)}>
          <Input value={row.remarks} maxLength={500} disabled={disabled} onChange={(e) => onChange({ remarks: e.target.value })} placeholder={row.result === 'HOLD' ? 'Why is it on hold?' : 'Optional'} error={Boolean(errors.remarks) || holdNeedsRemarks} aria-label={`Remarks for ${row.serialNo}`} className="h-11 sm:h-9" />
        </Field>
      </section>

      {checklist && checklist.items.length > 0 && (
        <section>
          <button type="button" onClick={() => setChecklistOpen((o) => !o)} className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline min-h-[44px] sm:min-h-0">
            {checklistOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            Checklist ({Object.keys(row.checklistAnswers).length}/{checklist.items.length} answered)
          </button>
          {checklistOpen && (
            <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3">
              <ChecklistAnswers items={checklist.items} value={row.checklistAnswers} onChange={(v) => onChange({ checklistAnswers: v })} disabled={disabled} />
            </div>
          )}
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">4. Result</h4>
        <Segmented
          label={`Result for ${row.serialNo}`}
          value={row.result}
          disabled={disabled}
          onChange={(v) => onChange({ result: v })}
          options={[
            { value: 'PASS', label: 'Pass', tone: 'green', icon: Check, disabled: blockers.length > 0, title: blockers.length ? `Cannot pass: ${blockers.join('; ')}` : undefined },
            { value: 'FAIL', label: 'Fail', tone: 'red', icon: X },
            { value: 'HOLD', label: 'Hold', tone: 'amber', icon: PauseCircle },
          ]}
        />
        {blockers.length > 0 && <p className="text-xs text-red-700">Pass is not allowed: {blockers.join('; ')}.</p>}
        {row.result === 'FAIL' && auto.length > 0 && (
          <p className="text-xs text-slate-600">
            Defect codes added automatically: <span className="font-mono">{auto.join(', ')}</span>. Add more below if needed.
          </p>
        )}
        {row.result === 'HOLD' && <p className="text-xs text-amber-700">A laptop on hold stays in QC hold and blocks the lot decision until it is passed or failed.</p>}
        {(row.result === 'FAIL' || row.defectCodes.length > 0) && (
          <Field label={needsManualDefect ? 'Defect codes (required: everything matched, so say what is wrong)' : 'Additional defect codes'} error={errors.defectCodes}>
            <DefectCodeChips codes={manualCodes} value={row.defectCodes} onChange={(v) => onChange({ defectCodes: v })} disabled={disabled} required={needsManualDefect} />
          </Field>
        )}
        {errors.result && (
          <p className="text-xs text-red-600" role="alert">
            {errors.result}
          </p>
        )}
        {!disabled && (
          <div className="flex justify-end">
            <Button icon={Save} size="lg" loading={saving} disabled={!row.dirty || !row.result} onClick={onSave} className="w-full sm:w-auto">
              Save {row.serialNo}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

/* ---- panel ------------------------------------------------------------------------------------ */

/**
 * Per-laptop inspection for laptop lots: each serial is verified against the ordered configuration
 * (8 specs), power and missing parts, then PASS / FAIL / HOLD. One serial is open at a time.
 */
export function LaptopInspectionPanel({ lot, canInspect }: { lot: QcLotDetail; canInspect: boolean }) {
  const grades = useConditionGrades();
  const defects = useDefectCodes();
  const save = useSaveResults();
  const [rows, setRows] = useState<LaptopRowState[]>(() => rowsFrom(lot.serials, lot.results));
  const [errors, setErrors] = useState<Record<string, RowErrors>>({});
  const [openSerial, setOpenSerial] = useState<string | null>(() => lot.serials.find((s) => !lot.results.some((r) => r.serialNo === s)) ?? null);
  const [savingSerials, setSavingSerials] = useState<string[]>([]);
  const editable = canInspect && (lot.status === 'OPEN' || lot.status === 'IN_INSPECTION');
  const expected = lot.expectedSpecs;

  // Re-sync from the server when results change, keeping local unsaved edits.
  useEffect(() => {
    setRows((prev) =>
      rowsFrom(lot.serials, lot.results).map((fresh) => {
        const local = prev.find((p) => p.serialNo === fresh.serialNo);
        return local?.dirty ? local : fresh;
      }),
    );
  }, [lot.serials, lot.results]);

  const update = (serialNo: string, patch: Partial<LaptopRowState>) => {
    setRows((prev) => prev.map((r) => (r.serialNo === serialNo ? { ...r, ...patch, dirty: true } : r)));
    setErrors((prev) => (prev[serialNo] ? { ...prev, [serialNo]: {} } : prev));
  };

  const dirty = rows.filter((r) => r.dirty && r.result !== '');
  const counts = useMemo(() => {
    const p = lot.progress;
    return { total: p?.total ?? lot.serials.length, inspected: p?.inspected ?? lot.results.length, passed: p?.passed ?? 0, failed: p?.failed ?? 0, onHold: p?.onHold ?? 0 };
  }, [lot.progress, lot.serials.length, lot.results.length]);

  const persist = async (targets: LaptopRowState[]) => {
    if (targets.length === 0) return;
    const sent = targets.map((r) => r.serialNo);
    setSavingSerials(sent);
    setErrors((prev) => {
      const next = { ...prev };
      for (const s of sent) delete next[s];
      return next;
    });
    try {
      const saved = await save.mutateAsync({ id: lot.id, results: targets.map(toPayload) });
      setRows((prev) =>
        rowsFrom(saved.serials, saved.results).map((fresh) => {
          const local = prev.find((p) => p.serialNo === fresh.serialNo);
          return local?.dirty && !sent.includes(local.serialNo) ? local : fresh;
        }),
      );
      toast.success(targets.length === 1 ? `${targets[0].serialNo} saved as ${humanize(targets[0].result || 'result')}` : `${targets.length} laptops saved`);
      // Move on to the next laptop that still needs a result.
      if (openSerial && sent.includes(openSerial)) {
        const next = saved.serials.find((s) => !saved.results.some((r) => r.serialNo === s));
        setOpenSerial(next ?? null);
      }
    } catch (err) {
      const e = toApiError(err);
      const map: Record<string, RowErrors> = {};
      for (const d of e.details) {
        const m = /^results\.(\d+)(?:\.(.+))?$/.exec(d.path);
        const serial = m ? sent[Number(m[1])] : undefined;
        if (!serial) continue;
        const field = m?.[2] ?? '_row';
        map[serial] = { ...(map[serial] ?? {}), [field]: d.message };
      }
      if (Object.keys(map).length === 0 && sent.length === 1) map[sent[0]] = { _row: e.message };
      setErrors((prev) => ({ ...prev, ...map }));
      const first = sent.find((s) => map[s]);
      if (first) setOpenSerial(first);
      toast.error(e.message);
    } finally {
      setSavingSerials([]);
    }
  };

  if (!expected) return null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Expected configuration" description={<span>Every laptop in this lot must match <span className="font-mono font-medium text-slate-700">{lot.item.sku}</span> - {lot.item.name}</span>} />
        <CardBody>
          <LaptopSpecsView specs={expected} variant="grid" />
        </CardBody>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title="Laptops to inspect"
          description={
            <span className="tabular">
              Inspected {counts.inspected} of {counts.total} - <span className="text-emerald-700">{counts.passed} passed</span> - <span className="text-red-700">{counts.failed} failed</span> - <span className="text-amber-700">{counts.onHold} on hold</span>
              {dirty.length ? ` - ${dirty.length} unsaved` : ''}
            </span>
          }
          actions={
            editable ? (
              <Button size="sm" icon={Save} loading={save.isPending && savingSerials.length > 1} disabled={dirty.length === 0 || save.isPending} onClick={() => void persist(dirty)}>
                Save all changes{dirty.length ? ` (${dirty.length})` : ''}
              </Button>
            ) : undefined
          }
        />
        <div className="px-5 pb-3">
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex" aria-hidden="true">
            <div className="bg-emerald-500" style={{ width: `${counts.total ? (counts.passed / counts.total) * 100 : 0}%` }} />
            <div className="bg-red-500" style={{ width: `${counts.total ? (counts.failed / counts.total) * 100 : 0}%` }} />
            <div className="bg-amber-400" style={{ width: `${counts.total ? (counts.onHold / counts.total) * 100 : 0}%` }} />
          </div>
        </div>
        {grades.isError || defects.isError ? (
          <ErrorState
            message="Could not load condition grades or defect codes"
            onRetry={() => {
              void grades.refetch();
              void defects.refetch();
            }}
          />
        ) : null}
        {rows.length === 0 ? (
          <EmptyState icon={Laptop} title="No laptops in this lot" hint="The lot has no serial numbers to inspect." />
        ) : (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {rows.map((row) => {
              const open = openSerial === row.serialNo;
              const rowErrors = errors[row.serialNo] ?? {};
              const hasError = Object.keys(rowErrors).length > 0;
              const tag = row.assetTag || row.saved?.laptopCheck?.assetTag;
              return (
                <li key={row.serialNo} className={cn(open && 'bg-slate-50/50', hasError && 'bg-red-50/40')}>
                  <button type="button" onClick={() => setOpenSerial(open ? null : row.serialNo)} aria-expanded={open} className="w-full flex items-center gap-3 px-5 py-3 min-h-[56px] text-left hover:bg-slate-50">
                    {open ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-sm text-slate-900 break-all">{row.serialNo}</span>
                      <span className="block text-[11px] text-slate-500">
                        {row.saved ? `Inspected ${formatDateTime(row.saved.inspectedAt)}` : 'Not inspected yet'}
                        {tag ? ` - asset ${tag}` : ''}
                        {row.saved?.result === 'HOLD' && row.saved.remarks ? ` - ${row.saved.remarks}` : ''}
                      </span>
                    </span>
                    {hasError && <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" aria-label="Has errors" />}
                    <StatusChip row={row} />
                  </button>
                  {open && (
                    <div className="px-5 pb-5">
                      <LaptopForm
                        row={row}
                        expected={expected}
                        onChange={(patch) => update(row.serialNo, patch)}
                        onSave={() => void persist([row])}
                        saving={save.isPending && savingSerials.includes(row.serialNo)}
                        disabled={!editable}
                        errors={rowErrors}
                        grades={grades.data}
                        defects={defects.data}
                        checklist={lot.checklist}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {!editable && (lot.status === 'OPEN' || lot.status === 'IN_INSPECTION') && (
          <p className="px-5 py-3 text-xs text-slate-500 border-t border-slate-100 flex items-center gap-1.5">
            <Hand className="w-3.5 h-3.5" /> You can view results but need the QC inspect permission to record them.
          </p>
        )}
      </Card>
    </div>
  );
}

/** Why the laptop lot cannot be decided yet (null when it can). */
export function laptopDecideBlocker(lot: QcLotDetail): string | null {
  const p = lot.progress;
  if (!p) return null;
  const missing = p.total - p.inspected;
  if (missing > 0) return `${missing} laptop${missing === 1 ? '' : 's'} not inspected yet`;
  if (p.onHold > 0) return `${p.onHold} laptop${p.onHold === 1 ? ' is' : 's are'} on hold; pass or fail ${p.onHold === 1 ? 'it' : 'them'} first`;
  return null;
}
