import { useMemo } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Save, Send } from 'lucide-react';
import { Button, Card, CardBody, CardHeader } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { cn } from '../../../lib/utils';
import { applyServerErrors, sanitizeChange, summarizeErrors } from '../../../lib/validation';
import { useCreatePurchaseOrder, usePatchPurchaseOrder, usePoCommand } from '../hooks';
import type { PurchaseOrder } from '../types';
import { PoHeaderFields } from './PoHeaderFields';
import { PoLineItems } from './PoLineItems';
import { PoTotals } from './PoTotals';
import { formToPayload, isIntraState, previewTotals, type PoFormValues } from './poForm.model';

/**
 * Create / edit a DRAFT purchase order. Create POSTs with an Idempotency-Key; edit PATCHes with
 * If-Match: version. "Save and submit" chains the submit command after the save.
 */
export function PurchaseOrderForm({ initial, editing }: { initial: PoFormValues; editing: PurchaseOrder | null }) {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const form = useForm<PoFormValues>({ defaultValues: initial, mode: 'onBlur' });
  const { register, watch, handleSubmit, setError, formState: { errors, isSubmitting } } = form;
  const create = useCreatePurchaseOrder();
  const patch = usePatchPurchaseOrder();
  const command = usePoCommand();
  const values = watch();
  const totals = useMemo(() => previewTotals(values), [values]);
  const canSubmitForApproval = hasPermission('purchase.create');
  const pending = isSubmitting || create.isPending || patch.isPending || command.isPending;

  const save = async (v: PoFormValues, andSubmit: boolean) => {
    const payload = formToPayload(v);
    let saved: PurchaseOrder;
    try {
      saved = editing ? await patch.mutateAsync({ id: editing.id, payload, version: editing.version }) : await create.mutateAsync(payload);
    } catch (err) {
      const e = toApiError(err);
      const unmapped = applyServerErrors(setError, e);
      toast.error(summarizeErrors(unmapped));
      return;
    }
    if (andSubmit) {
      try {
        saved = await command.mutateAsync({ id: saved.id, command: 'submit' });
        toast.success(`${saved.number} submitted for approval`);
      } catch (err) {
        toast.error(`Saved as draft, but could not submit: ${toApiError(err).message}`);
      }
    } else {
      toast.success(`${saved.number} saved as draft`);
    }
    navigate(`/purchases/orders/${saved.id}`, { replace: true });
  };

  const discountField = register('discountValue');
  const discountControl = (
    <div className="flex items-stretch rounded-lg border border-slate-300 bg-white overflow-hidden max-w-[200px]">
      <input inputMode="decimal" aria-label="Discount value" className={cn('w-24 px-2 text-sm text-right tabular outline-none', errors.discountValue && 'text-red-600')} {...discountField} onChange={sanitizeChange('decimal', discountField.onChange)} />
      <select aria-label="Discount type" className="border-l border-slate-200 bg-slate-50 px-2 text-xs outline-none" {...register('discountType')}>
        <option value="PERCENT">%</option>
        <option value="AMOUNT">INR</option>
      </select>
    </div>
  );

  return (
    <FormProvider {...form}>
      <form onSubmit={handleSubmit((v) => save(v, false))} noValidate className="space-y-5">
        <Card>
          <CardHeader title="Order details" description="Vendor, delivery warehouse and terms. GST treatment follows the vendor state and the warehouse state." />
          <CardBody>
            <PoHeaderFields />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Lines" description="Tax rate defaults from the product; override it per line for concessional supplies." />
          <CardBody>
            <PoLineItems totals={totals} />
          </CardBody>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2" />
          <div className="space-y-1">
            <PoTotals totals={totals} intraState={isIntraState(values.supplierStateCode, values.shipToStateCode)} discountControl={discountControl} note="Preview only: final figures are computed by the server when the order is saved." />
            {errors.discountValue?.message && <p className="text-xs text-red-600">{errors.discountValue.message}</p>}
          </div>
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-1">
          <Button variant="ghost" type="button" onClick={() => navigate(editing ? `/purchases/orders/${editing.id}` : '/purchases/orders')} disabled={pending}>
            Cancel
          </Button>
          <Button variant="secondary" type="submit" icon={Save} loading={pending}>
            Save draft
          </Button>
          {canSubmitForApproval && (
            <Button type="button" icon={Send} loading={pending} onClick={handleSubmit((v) => save(v, true))}>
              Save and submit
            </Button>
          )}
        </div>
      </form>
    </FormProvider>
  );
}
