import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Plus, Settings2, ToggleLeft, ToggleRight } from 'lucide-react';
import { CUSTOM_FIELD_TYPES, customFieldDefinitionSchema, type CustomFieldEntity } from '@b2b/shared';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, EmptyState, ErrorState, Field, Input, Modal, Select, Skeleton } from '../../components/ui';
import { api, toApiError } from '../../lib/api';
import { usePermission } from '../../lib/auth';
import { applyServerErrors, applyZodIssues, summarizeErrors } from '../../lib/validation';
import { humanize } from '../../lib/utils';

interface CustomFieldDef { id: string; key: string; label: string; fieldType: string; options: string[] | null; isRequired: boolean; isActive: boolean }
type FieldForm = { label: string; fieldType: (typeof CUSTOM_FIELD_TYPES)[number]; optionsText: string; isRequired: boolean };
const splitOptions = (text: string) => text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

/** Custom field definitions for one entity (vendor, purchase order). */
export function CustomFieldsCard({ entityType, title, description, entityLabel }: { entityType: CustomFieldEntity; title: string; description: string; entityLabel: string }) {
  const qc = useQueryClient();
  const { canManageSettings } = usePermission();
  const fields = useQuery({ queryKey: ['settings', 'custom-fields', entityType], queryFn: () => api.get<{ data: CustomFieldDef[] }>('/settings/custom-fields', { params: { entityType } }).then((r) => r.data.data) });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['settings'] });
    void qc.invalidateQueries({ queryKey: ['vendors', 'form-options'] });
    void qc.invalidateQueries({ queryKey: ['purchase-orders', 'form-options'] });
  };
  const [modal, setModal] = useState(false);
  const createField = useMutation({ mutationFn: (body: unknown) => api.post('/settings/custom-fields', body), onSuccess: invalidate });
  const patchField = useMutation({ mutationFn: ({ id, body }: { id: string; body: unknown }) => api.patch(`/settings/custom-fields/${id}`, body), onSuccess: invalidate });
  const form = useForm<FieldForm>({ defaultValues: { label: '', fieldType: 'TEXT', optionsText: '', isRequired: false } });
  const fieldType = form.watch('fieldType');

  const submit = form.handleSubmit(async (v) => {
    const parsed = customFieldDefinitionSchema.safeParse({ entityType, label: v.label, fieldType: v.fieldType, options: splitOptions(v.optionsText), isRequired: v.isRequired });
    if (!parsed.success) {
      applyZodIssues(form.setError, parsed.error, { mapPath: (p) => (p.startsWith('options') ? 'optionsText' : p) });
      return;
    }
    try {
      await createField.mutateAsync(parsed.data);
      toast.success('Custom field added');
      setModal(false);
      form.reset();
    } catch (err) {
      const e = toApiError(err);
      toast.error(summarizeErrors(applyServerErrors(form.setError, e, { mapPath: (p) => (p.startsWith('options') ? 'optionsText' : p) }), e.message));
    }
  });

  return (
    <Card>
      <CardHeader title={title} description={description} actions={canManageSettings && <Button size="sm" icon={Plus} onClick={() => setModal(true)}>Add Field</Button>} />
      <CardBody className="p-0">
        {fields.isLoading ? <div className="p-4 space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : fields.isError ? <ErrorState message={toApiError(fields.error).message} onRetry={() => void fields.refetch()} /> : fields.data!.length === 0 ? <EmptyState icon={Settings2} title="No custom fields" hint={`Add fields that appear on every ${entityLabel}.`} className="py-10" /> : (
          <ul className="divide-y divide-slate-100">
            {fields.data!.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 flex items-center gap-2">
                    {f.label}
                    {f.isRequired && <Badge tone="amber">Required</Badge>}
                    {!f.isActive && <Badge tone="gray">Inactive</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {humanize(f.fieldType)}
                    {f.fieldType === 'DROPDOWN' && f.options?.length ? ` - ${f.options.join(', ')}` : ''} <span className="font-mono">({f.key})</span>
                  </p>
                </div>
                {canManageSettings && (
                  <>
                    <Button size="xs" variant="ghost" onClick={() => patchField.mutateAsync({ id: f.id, body: { isRequired: !f.isRequired } }).catch((e) => toast.error(toApiError(e).message))}>{f.isRequired ? 'Make optional' : 'Make required'}</Button>
                    <Button size="xs" variant="ghost" icon={f.isActive ? ToggleRight : ToggleLeft} onClick={() => patchField.mutateAsync({ id: f.id, body: { isActive: !f.isActive } }).catch((e) => toast.error(toApiError(e).message))}>{f.isActive ? 'Deactivate' : 'Activate'}</Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>

      <Modal open={modal} onClose={() => setModal(false)} title={`Add ${entityLabel} field`} footer={<><Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button><Button onClick={() => void submit()} loading={createField.isPending}>Add Field</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-3" noValidate>
          <Field label="Label" required error={form.formState.errors.label?.message}><Input autoFocus sanitize="singleLine" maxLength={100} error={Boolean(form.formState.errors.label)} {...form.register('label')} /></Field>
          <Field label="Type" required><Select options={CUSTOM_FIELD_TYPES.map((t) => ({ value: t, label: humanize(t) }))} {...form.register('fieldType')} /></Field>
          {fieldType === 'DROPDOWN' && (
            <Field label="Options" required hint="One per line or comma separated" error={form.formState.errors.optionsText?.message}>
              <textarea rows={4} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" {...form.register('optionsText')} />
            </Field>
          )}
          <Checkbox label={`Required when creating or editing a ${entityLabel}`} {...form.register('isRequired')} />
        </form>
      </Modal>
    </Card>
  );
}
