import { useState } from 'react';
import toast from 'react-hot-toast';
import { Check, Hash, Pencil, X } from 'lucide-react';
import { Badge, Button, Card, Checkbox, DataTable, EmptyState, ErrorState, Field, IconButton, Input, PageHeader, type Column } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useNumbering, useSetNumbering } from '../hooks';
import { DOC_TYPE_LABELS, type DocType, type NumberingConfig } from '../types';

/** Indian financial year label for a date, e.g. 2026-05-01 -> "26-27" (April start). */
function financialYear(date = new Date()): string {
  const y = date.getFullYear();
  const start = date.getMonth() + 1 >= 4 ? y : y - 1;
  return `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
}

/** Display-only preview of the next number: `{FY}` -> current FY, sequence 1 padded. */
export function previewNumber(prefixTemplate: string, padding: number, seq = 1): string {
  const fy = financialYear();
  const prefix = prefixTemplate.replace(/\{FY\}/g, fy).replace(/\{YYYY\}/g, String(new Date().getFullYear())).replace(/\{YY\}/g, String(new Date().getFullYear()).slice(-2));
  return `${prefix}${String(seq).padStart(Math.max(1, padding), '0')}`;
}

function EditRow({ row, onDone }: { row: NumberingConfig; onDone: () => void }) {
  const save = useSetNumbering();
  const [prefixTemplate, setPrefix] = useState(row.prefixTemplate);
  const [padding, setPadding] = useState(String(row.padding));
  const [resetEachFy, setResetEachFy] = useState(row.resetEachFy);
  const [error, setError] = useState<{ prefixTemplate?: string; padding?: string }>({});

  const submit = async () => {
    setError({});
    try {
      await save.mutateAsync({ docType: row.docType, payload: { prefixTemplate: prefixTemplate.trim(), padding: Number(padding), resetEachFy } });
      toast.success(`${DOC_TYPE_LABELS[row.docType]} numbering updated`);
      onDone();
    } catch (err) {
      const e = toApiError(err);
      setError({ prefixTemplate: e.fieldErrors.prefixTemplate, padding: e.fieldErrors.padding });
      toast.error(e.message);
    }
  };
  const pad = Number(padding) || 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_120px_auto_auto] gap-3 items-end px-4 py-3 bg-brand-50/40 border-b border-brand-100">
      <Field label="Prefix template" htmlFor={`pt-${row.docType}`} error={error.prefixTemplate} hint="Placeholders: {FY} financial year, {YYYY}, {YY}">
        <Input id={`pt-${row.docType}`} value={prefixTemplate} onChange={(e) => setPrefix(e.target.value)} sanitize="upper" maxLength={40} className="font-mono" error={Boolean(error.prefixTemplate)} autoFocus />
      </Field>
      <Field label="Padding" htmlFor={`pd-${row.docType}`} error={error.padding}>
        <Input id={`pd-${row.docType}`} value={padding} onChange={(e) => setPadding(e.target.value)} sanitize="integer" maxLength={1} className="tabular" error={Boolean(error.padding)} />
      </Field>
      <Checkbox label="Reset each FY" checked={resetEachFy} onChange={(e) => setResetEachFy(e.target.checked)} className="pb-2" />
      <div className="flex items-center gap-2 pb-0.5">
        <span className="text-xs text-slate-500 font-mono tabular hidden lg:inline">{previewNumber(prefixTemplate, pad)}</span>
        <Button size="sm" icon={Check} loading={save.isPending} onClick={() => void submit()}>
          Save
        </Button>
        <IconButton icon={X} label="Cancel" size="sm" onClick={onDone} disabled={save.isPending} />
      </div>
    </div>
  );
}

export function NumberingPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('settings.manage');
  const query = useNumbering();
  const [editing, setEditing] = useState<DocType | null>(null);
  const rows = query.data ?? [];
  const editingRow = rows.find((r) => r.docType === editing) ?? null;

  const columns: Column<NumberingConfig>[] = [
    { key: 'docType', header: 'Document', render: (r) => <div className="min-w-0"><p className="font-medium text-slate-900">{DOC_TYPE_LABELS[r.docType] ?? r.docType}</p><p className="text-xs text-slate-500 font-mono">{r.docType}</p></div> },
    { key: 'prefixTemplate', header: 'Prefix template', render: (r) => <span className="font-mono text-[13px]">{r.prefixTemplate}</span> },
    { key: 'padding', header: 'Padding', align: 'right', width: '90px', render: (r) => <span className="tabular">{r.padding}</span> },
    { key: 'resetEachFy', header: 'Reset each FY', width: '130px', hideBelow: 'md', render: (r) => (r.resetEachFy ? <Badge tone="green">Yes</Badge> : <Badge tone="gray">No</Badge>) },
    { key: 'preview', header: 'Next number looks like', hideBelow: 'sm', render: (r) => <span className="font-mono text-[13px] tabular text-slate-800">{previewNumber(r.prefixTemplate, r.padding, (r.lastSeq ?? 0) + 1)}</span> },
  ];

  return (
    <>
      <PageHeader title="Document Numbering" subtitle="Prefix, padding and yearly reset per document type. Numbers are issued by the owning service inside the creating transaction; existing documents never change." breadcrumbs={[{ label: 'Masters' }, { label: 'Numbering' }]} />
      <Card className="overflow-hidden">
        {editingRow && <EditRow key={editingRow.docType} row={editingRow} onDone={() => setEditing(null)} />}
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.docType}
          loading={query.isLoading}
          error={query.isError ? <ErrorState message={toApiError(query.error).message} onRetry={() => void query.refetch()} /> : undefined}
          empty={<EmptyState icon={Hash} title="No numbering configured" hint="Numbering rows are seeded when the organisation is activated." />}
          rowActions={canManage ? (r) => <IconButton icon={Pencil} label={`Edit ${r.docType} numbering`} size="sm" onClick={() => setEditing(r.docType)} disabled={editing === r.docType} /> : undefined}
        />
      </Card>
    </>
  );
}
