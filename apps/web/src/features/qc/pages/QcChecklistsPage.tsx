import { useState } from 'react';
import toast from 'react-hot-toast';
import { ClipboardList, Plus, Tag } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Input, PageHeader, StatusBadge, TableSkeleton } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { ChecklistFormModal } from '../components/ChecklistFormModal';
import { useChecklistStatus, useChecklists, useDefectCodeStatus, useDefectCodes, useUpsertDefectCode } from '../hooks';

function ChecklistsCard({ canManage }: { canManage: boolean }) {
  const list = useChecklists();
  const setStatus = useChecklistStatus();
  const [open, setOpen] = useState(false);
  const toggle = async (id: string, name: string, status: 'ACTIVE' | 'INACTIVE') => {
    try {
      await setStatus.mutateAsync({ id, status });
      toast.success(`${name} ${status === 'ACTIVE' ? 'activated' : 'deactivated'}`);
    } catch (err) {
      toast.error(toApiError(err).message);
    }
  };
  return (
    <Card>
      <CardHeader title="Checklists" description="A product-specific checklist wins over the default one." actions={canManage ? <Button size="sm" icon={Plus} onClick={() => setOpen(true)}>New checklist</Button> : undefined} />
      <CardBody className="p-0">
        {list.isLoading ? (
          <TableSkeleton rows={3} cols={3} />
        ) : list.isError ? (
          <ErrorState message={toApiError(list.error).message} onRetry={() => void list.refetch()} />
        ) : (list.data ?? []).length === 0 ? (
          <EmptyState icon={ClipboardList} title="No checklists" hint="Lots without a checklist are inspected with a plain pass / fail per unit." action={canManage ? <Button size="sm" icon={Plus} onClick={() => setOpen(true)}>New checklist</Button> : undefined} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.data!.map((c) => (
              <li key={c.id} className="px-5 py-4 flex flex-col sm:flex-row sm:items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-slate-900">{c.name}</p>
                    <StatusBadge status={c.status} />
                    {c.appliesTo?.isDefault && <Badge tone="blue">default</Badge>}
                    <span className="text-xs text-slate-500">v{c.version}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {c.items.length} item{c.items.length === 1 ? '' : 's'}
                    {c.items.some((i) => i.critical) ? ` (${c.items.filter((i) => i.critical).length} critical)` : ''} - applies to {(c.appliesTo?.itemIds ?? []).length ? `${(c.appliesTo?.itemIds ?? []).length} product(s)` : c.appliesTo?.isDefault ? 'all products by default' : 'nothing yet'}
                  </p>
                  <ol className="mt-2 text-xs text-slate-700 space-y-0.5">
                    {c.items.map((it) => (
                      <li key={it.id}>
                        {it.seq}. {it.label} <span className="text-slate-400">({it.kind.toLowerCase().replace('_', '/')}{it.kind === 'NUMERIC' && (it.minValue !== null || it.maxValue !== null) ? ` ${it.minValue ?? '-'} to ${it.maxValue ?? '-'}` : ''})</span>
                        {it.critical && <span className="ml-1 text-red-700 font-medium">critical</span>}
                      </li>
                    ))}
                  </ol>
                </div>
                {canManage && (
                  <Button size="sm" variant="secondary" loading={setStatus.isPending && setStatus.variables?.id === c.id} onClick={() => void toggle(c.id, c.name, c.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE')}>
                    {c.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <ChecklistFormModal open={open} onClose={() => setOpen(false)} />
    </Card>
  );
}

function DefectCodesCard({ canManage }: { canManage: boolean }) {
  const list = useDefectCodes();
  const upsert = useUpsertDefectCode();
  const setStatus = useDefectCodeStatus();
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const add = async () => {
    setErrors({});
    try {
      const saved = await upsert.mutateAsync({ code: code.trim(), description: description.trim() });
      toast.success(`Defect code ${saved.code} saved`);
      setCode('');
      setDescription('');
    } catch (err) {
      const e = toApiError(err);
      setErrors(e.fieldErrors);
      toast.error(e.message);
    }
  };
  const toggle = async (c: string, status: 'ACTIVE' | 'INACTIVE') => {
    try {
      await setStatus.mutateAsync({ code: c, status });
      toast.success(`${c} ${status === 'ACTIVE' ? 'activated' : 'deactivated'}`);
    } catch (err) {
      toast.error(toApiError(err).message);
    }
  };

  return (
    <Card>
      <CardHeader title="Defect codes" description="Required on every failed unit. Re-adding an existing code updates its description." />
      <CardBody className="p-0">
        {canManage && (
          <form
            className="px-5 py-4 border-b border-slate-100 grid grid-cols-1 sm:grid-cols-[140px_1fr_auto] gap-2 items-start"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <div>
              <Input value={code} onChange={(e) => setCode(e.target.value)} sanitize="code" maxLength={20} placeholder="CODE" aria-label="Defect code" className="font-mono" error={Boolean(errors.code)} />
              {errors.code && <p className="text-xs text-red-600 mt-1">{errors.code}</p>}
            </div>
            <div>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} sanitize="singleLine" maxLength={200} placeholder="Description" aria-label="Description" error={Boolean(errors.description)} />
              {errors.description && <p className="text-xs text-red-600 mt-1">{errors.description}</p>}
            </div>
            <Button type="submit" icon={Plus} loading={upsert.isPending} disabled={!code.trim() || !description.trim()}>
              Add
            </Button>
          </form>
        )}
        {list.isLoading ? (
          <TableSkeleton rows={4} cols={3} />
        ) : list.isError ? (
          <ErrorState message={toApiError(list.error).message} onRetry={() => void list.refetch()} />
        ) : (list.data ?? []).length === 0 ? (
          <EmptyState icon={Tag} title="No defect codes" hint="Add codes such as SCRATCH, DEAD_PIXEL or MISSING_PART." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.data!.map((d) => (
              <li key={d.code} className="px-5 py-3 flex items-center gap-3">
                <span className="font-mono text-sm font-medium text-slate-900 w-32 shrink-0">{d.code}</span>
                <span className="text-sm text-slate-700 flex-1 min-w-0 truncate">{d.description}</span>
                <StatusBadge status={d.status} />
                {canManage && (
                  <Button size="xs" variant="ghost" loading={setStatus.isPending && setStatus.variables?.code === d.code} onClick={() => void toggle(d.code, d.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE')}>
                    {d.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/** /qc/checklists: checklists and defect codes (qc.view to read, qc.manage to edit). */
export function QcChecklistsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('qc.manage');
  return (
    <>
      <PageHeader title="Checklists and defect codes" subtitle={canManage ? 'Define what inspectors check and how failures are classified.' : 'Read-only: editing needs the qc.manage permission.'} breadcrumbs={[{ label: 'Quality' }, { label: 'Checklists' }]} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ChecklistsCard canManage={canManage} />
        <DefectCodesCard canManage={canManage} />
      </div>
    </>
  );
}
