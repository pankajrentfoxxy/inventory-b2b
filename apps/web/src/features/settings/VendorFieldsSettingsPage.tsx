import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Plus, Tags, ToggleLeft, ToggleRight } from 'lucide-react';
import { reportingTagSchema } from '@b2b/shared';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Skeleton } from '../../components/ui';
import { api, toApiError } from '../../lib/api';
import { usePermission } from '../../lib/auth';
import { applyServerErrors, applyZodIssues, summarizeErrors } from '../../lib/validation';
import { CustomFieldsCard } from './CustomFieldsCard';

interface ReportingTagDef { id: string; name: string; isActive: boolean; usageCount: number; options: { id: string; name: string; isActive: boolean }[] }
type TagForm = { name: string; optionsText: string };
const splitOptions = (text: string) => text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

export function VendorFieldsSettingsPage() {
  const qc = useQueryClient();
  const { canManageSettings } = usePermission();
  const tags = useQuery({ queryKey: ['settings', 'reporting-tags'], queryFn: () => api.get<{ data: ReportingTagDef[] }>('/settings/reporting-tags').then((r) => r.data.data) });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['settings'] });
    void qc.invalidateQueries({ queryKey: ['vendors', 'form-options'] });
  };
  const [tagModal, setTagModal] = useState<{ id: string | null } | null>(null);
  const saveTag = useMutation({ mutationFn: ({ id, body }: { id: string | null; body: unknown }) => (id ? api.patch(`/settings/reporting-tags/${id}`, body) : api.post('/settings/reporting-tags', body)), onSuccess: invalidate });
  const tagForm = useForm<TagForm>({ defaultValues: { name: '', optionsText: '' } });

  const submitTag = tagForm.handleSubmit(async (v) => {
    const parsed = reportingTagSchema.safeParse({ name: v.name, options: splitOptions(v.optionsText) });
    if (!parsed.success) {
      applyZodIssues(tagForm.setError, parsed.error, { mapPath: (p) => (p.startsWith('options') ? 'optionsText' : p) });
      return;
    }
    try {
      await saveTag.mutateAsync({ id: tagModal?.id ?? null, body: parsed.data });
      toast.success(tagModal?.id ? 'Tag updated' : 'Tag added');
      setTagModal(null);
    } catch (err) {
      const e = toApiError(err);
      toast.error(summarizeErrors(applyServerErrors(tagForm.setError, e, { mapPath: (p) => (p.startsWith('options') ? 'optionsText' : p) }), e.message));
    }
  });

  return (
    <>
      <PageHeader title="Vendor Fields & Tags" subtitle="Custom fields and reporting tags available on every vendor in this organization." breadcrumbs={[{ label: 'Settings' }, { label: 'Vendor Fields & Tags' }]} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <CustomFieldsCard entityType="VENDOR" title="Custom Fields" description="Stored per vendor without schema changes. Types cannot be changed after creation." entityLabel="vendor" />

        <Card>
          <CardHeader title="Reporting Tags" description="Dimensions for purchase reporting. Options are deactivated, never deleted, so history stays intact." actions={canManageSettings && <Button size="sm" icon={Plus} onClick={() => { tagForm.reset({ name: '', optionsText: '' }); setTagModal({ id: null }); }}>Add Tag</Button>} />
          <CardBody className="p-0">
            {tags.isLoading ? <div className="p-4 space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : tags.isError ? <ErrorState message={toApiError(tags.error).message} onRetry={() => void tags.refetch()} /> : tags.data!.length === 0 ? <EmptyState icon={Tags} title="No reporting tags" className="py-10" /> : (
              <ul className="divide-y divide-slate-100">
                {tags.data!.map((t) => (
                  <li key={t.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 flex items-center gap-2">
                        {t.name}
                        {!t.isActive && <Badge tone="gray">Inactive</Badge>}
                        <span className="text-xs text-slate-400 font-normal tabular">{t.usageCount} vendor{t.usageCount === 1 ? '' : 's'}</span>
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {t.options.map((o) => (
                          <Badge key={o.id} tone={o.isActive ? 'purple' : 'gray'}>{o.name}</Badge>
                        ))}
                      </div>
                    </div>
                    {canManageSettings && (
                      <>
                        <Button size="xs" variant="ghost" onClick={() => { tagForm.reset({ name: t.name, optionsText: t.options.filter((o) => o.isActive).map((o) => o.name).join('\n') }); setTagModal({ id: t.id }); }}>Edit</Button>
                        <Button size="xs" variant="ghost" icon={t.isActive ? ToggleRight : ToggleLeft} onClick={() => saveTag.mutateAsync({ id: t.id, body: { isActive: !t.isActive } }).catch((e) => toast.error(toApiError(e).message))}>{t.isActive ? 'Deactivate' : 'Activate'}</Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Modal open={Boolean(tagModal)} onClose={() => setTagModal(null)} title={tagModal?.id ? 'Edit Reporting Tag' : 'Add Reporting Tag'} footer={<><Button variant="secondary" onClick={() => setTagModal(null)}>Cancel</Button><Button onClick={() => void submitTag()} loading={saveTag.isPending}>Save</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); void submitTag(); }} className="space-y-3" noValidate>
          <Field label="Tag name" required error={tagForm.formState.errors.name?.message}><Input autoFocus sanitize="singleLine" maxLength={100} placeholder="e.g. Region" error={Boolean(tagForm.formState.errors.name)} {...tagForm.register('name')} /></Field>
          <Field label="Options" hint="One per line or comma separated. Removing an option deactivates it." error={tagForm.formState.errors.optionsText?.message}>
            <textarea rows={5} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder={'North\nSouth\nEast\nWest'} {...tagForm.register('optionsText')} />
          </Field>
        </form>
      </Modal>
    </>
  );
}
