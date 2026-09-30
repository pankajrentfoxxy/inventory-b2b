import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Input } from '../../../components/ui';
import { cn, formatDateTime } from '../../../lib/utils';
import type { ConditionGrade, QcChecklistItem, QcDefectCode, QcResultValue, QcUnitResult } from '../types';
import { ChecklistAnswers, DefectCodeChips, GradeSelect, PassFailToggle } from './inputs';

export interface SerialRowState {
  serialNo: string;
  result: QcResultValue | '';
  gradeCode: string;
  defectCodes: string[];
  remarks: string;
  checklistAnswers: Record<string, unknown>;
  /** Edited since the last save. */
  dirty: boolean;
  /** A result exists on the server. */
  saved: QcUnitResult | null;
}

export function rowsFromLot(serials: string[], results: QcUnitResult[]): SerialRowState[] {
  return serials.map((serialNo) => {
    const r = results.find((x) => x.serialNo === serialNo) ?? null;
    return { serialNo, result: r?.result ?? '', gradeCode: r?.gradeCode ?? '', defectCodes: r?.defectCodes ?? [], remarks: r?.remarks ?? '', checklistAnswers: (r?.checklistAnswers as Record<string, unknown> | null) ?? {}, dirty: false, saved: r };
  });
}

function Row({ row, onChange, grades, defects, checklist, disabled, error }: { row: SerialRowState; onChange: (patch: Partial<SerialRowState>) => void; grades: ConditionGrade[]; defects: QcDefectCode[]; checklist: QcChecklistItem[]; disabled?: boolean; error?: string }) {
  const [open, setOpen] = useState(false);
  const needsDefect = row.result === 'FAIL' && row.defectCodes.length === 0;
  return (
    <li className={cn('px-4 py-3 space-y-3', row.dirty && 'bg-amber-50/40', error && 'bg-red-50/40')}>
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="min-w-0 md:w-56">
          <p className="font-mono text-sm text-slate-900 break-all">{row.serialNo}</p>
          <p className="text-[11px] text-slate-500">{row.saved ? `Inspected ${formatDateTime(row.saved.inspectedAt)}` : 'No result yet'}{row.dirty ? ' - unsaved' : ''}</p>
        </div>
        <PassFailToggle value={row.result} onChange={(r) => onChange({ result: r, defectCodes: r === 'PASS' ? row.defectCodes : row.defectCodes })} disabled={disabled} name={`Result for ${row.serialNo}`} />
        <div className="md:w-52">
          <GradeSelect grades={grades} value={row.gradeCode} onChange={(v) => onChange({ gradeCode: v })} disabled={disabled} />
        </div>
        <div className="flex-1 min-w-0">
          <Input value={row.remarks} onChange={(e) => onChange({ remarks: e.target.value })} placeholder="Remarks" maxLength={500} disabled={disabled} aria-label={`Remarks for ${row.serialNo}`} />
        </div>
      </div>
      {(row.result === 'FAIL' || row.defectCodes.length > 0) && (
        <div>
          <p className="text-xs font-medium text-slate-600 mb-1">Defect codes{row.result === 'FAIL' ? ' (required for a failed unit)' : ''}</p>
          <DefectCodeChips codes={defects} value={row.defectCodes} onChange={(v) => onChange({ defectCodes: v })} disabled={disabled} required={needsDefect} />
        </div>
      )}
      {checklist.length > 0 && (
        <div>
          <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline">
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            Checklist ({Object.keys(row.checklistAnswers).length}/{checklist.length} answered)
          </button>
          {open && (
            <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3">
              <ChecklistAnswers items={checklist} value={row.checklistAnswers} onChange={(v) => onChange({ checklistAnswers: v })} disabled={disabled} />
            </div>
          )}
        </div>
      )}
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/** One card per serial: PASS/FAIL, grade, defects, remarks and checklist answers. Single column on phones. */
export function SerialResultsTable({ rows, onChange, grades, defects, checklist, disabled, errors }: { rows: SerialRowState[]; onChange: (index: number, patch: Partial<SerialRowState>) => void; grades: ConditionGrade[]; defects: QcDefectCode[]; checklist: QcChecklistItem[]; disabled?: boolean; errors: Record<string, string> }) {
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((row, i) => (
        <Row key={row.serialNo} row={row} onChange={(patch) => onChange(i, patch)} grades={grades} defects={defects} checklist={checklist} disabled={disabled} error={errors[row.serialNo]} />
      ))}
    </ul>
  );
}
