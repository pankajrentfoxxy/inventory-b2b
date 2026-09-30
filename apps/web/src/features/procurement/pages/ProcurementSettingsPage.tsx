import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Save } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, Checkbox, ErrorState, Field, FormSkeleton, Input, PageHeader } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useProcurementSettings, useUpdateProcurementSettings } from '../hooks';
import type { ProcurementSettings } from '../types';

interface FormState {
  approverMustDiffer: boolean;
  approvalLimit: string;
  closeRequiresQc: boolean;
  overReceiptTolerancePct: string;
}

const toForm = (s: ProcurementSettings): FormState => ({ approverMustDiffer: s.approverMustDiffer, approvalLimit: s.approvalLimit === null ? '' : String(s.approvalLimit), closeRequiresQc: s.closeRequiresQc, overReceiptTolerancePct: String(s.overReceiptTolerancePct) });

/** /settings/procurement: approval and receiving rules (read: purchase.view, edit: settings.manage). */
export function ProcurementSettingsPage() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('settings.manage');
  const settings = useProcurementSettings();
  const update = useUpdateProcurementSettings();
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (settings.data) setForm(toForm(settings.data));
  }, [settings.data]);

  const save = async () => {
    if (!form) return;
    setErrors({});
    try {
      const saved = await update.mutateAsync({
        approverMustDiffer: form.approverMustDiffer,
        approvalLimit: form.approvalLimit.trim() === '' ? null : Number(form.approvalLimit),
        closeRequiresQc: form.closeRequiresQc,
        overReceiptTolerancePct: Number(form.overReceiptTolerancePct),
      });
      setForm(toForm(saved));
      toast.success('Procurement settings saved');
    } catch (err) {
      const e = toApiError(err);
      setErrors(e.fieldErrors);
      toast.error(e.message);
    }
  };

  const crumbs = [{ label: 'Settings' }, { label: 'Procurement' }];

  return (
    <>
      <PageHeader title="Procurement settings" subtitle="Approval rules and receiving tolerances for purchase orders and goods receipts." breadcrumbs={crumbs} />
      <Card className="max-w-3xl">
        <CardHeader title="Approvals and receiving" description={canEdit ? undefined : 'You can view these settings; changing them needs the settings.manage permission.'} />
        <CardBody>
          {settings.isLoading || !form ? (
            settings.isError ? (
              <ErrorState message={toApiError(settings.error).message} onRetry={() => void settings.refetch()} />
            ) : (
              <FormSkeleton />
            )
          ) : (
            <form
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <Checkbox label="Approver must differ from the submitter" description="Blocks self-approval (PO_SELF_APPROVAL). Recommended for every organisation with more than one buyer." checked={form.approverMustDiffer} disabled={!canEdit} onChange={(e) => setForm({ ...form, approverMustDiffer: e.target.checked })} />
              <Field label="Approval limit" hint="Orders above this total can only be approved by members with settings.manage. Leave blank for no limit." error={errors.approvalLimit}>
                <Input sanitize="decimal" value={form.approvalLimit} disabled={!canEdit} prefix="INR" placeholder="No limit" onChange={(e) => setForm({ ...form, approvalLimit: e.target.value })} error={Boolean(errors.approvalLimit)} className="max-w-xs tabular" />
              </Field>
              <Checkbox label="Closing requires completed QC" description="A fully received order closes automatically once every receipt completes QC; manual close is refused while QC is pending." checked={form.closeRequiresQc} disabled={!canEdit} onChange={(e) => setForm({ ...form, closeRequiresQc: e.target.checked })} />
              <Field label="Over-receipt tolerance" hint="Percentage of the ordered quantity that may be received above the open quantity (0-100)." error={errors.overReceiptTolerancePct}>
                <Input sanitize="decimal" value={form.overReceiptTolerancePct} disabled={!canEdit} suffix="%" onChange={(e) => setForm({ ...form, overReceiptTolerancePct: e.target.value })} error={Boolean(errors.overReceiptTolerancePct)} className="max-w-[160px] tabular" />
              </Field>
              {canEdit && (
                <div className="flex justify-end pt-2">
                  <Button type="submit" icon={Save} loading={update.isPending}>
                    Save settings
                  </Button>
                </div>
              )}
            </form>
          )}
        </CardBody>
      </Card>
    </>
  );
}
