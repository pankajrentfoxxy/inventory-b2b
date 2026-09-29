import { useEffect, useMemo, useState } from 'react';
import { Controller, FormProvider, useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { purchaseOrderSchema } from '@b2b/shared';
import { Button, Card, CardBody, CardHeader, Checkbox, Field, Input, Select, Textarea } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { usePermission } from '../../../lib/auth';
import { poApi } from '../api';
import type { PoDetail, PoFormOptions } from '../types';
import { applyServerErrors, computeFormTotals, defaultPoValues, poToFormValues, toPoPayload, type PoFormValues } from './poForm.model';
import { PoHeaderFields } from './PoHeaderFields';
import { PoLineItems } from './PoLineItems';
import { PoTotals } from './PoTotals';
import { PoAttachments } from '../components/PoAttachments';

export type PoSubmitMode = 'draft' | 'issue' | 'save';

export interface PurchaseOrderFormProps {
  options: PoFormOptions;
  po?: PoDetail;
  preset?: { vendorId?: string; vendorName?: string };
  onSubmit: (payload: ReturnType<typeof toPoPayload>, mode: PoSubmitMode) => Promise<PoDetail>;
  submitting: boolean;
}

export function PurchaseOrderForm({ options, po, preset, onSubmit, submitting }: PurchaseOrderFormProps) {
  const navigate = useNavigate();
  const { canIssuePurchaseOrder, canManageSettings } = usePermission();
  const defaults = useMemo(() => (po ? poToFormValues(po, options) : defaultPoValues(options, preset)), [po, options, preset]);
  const form = useForm<PoFormValues>({
    defaultValues: defaults,
    resolver: zodResolver(purchaseOrderSchema) as unknown as Resolver<PoFormValues>,
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });
  const { handleSubmit, formState, setError, reset, getValues, watch, control } = form;
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  useEffect(() => reset(defaults), [defaults, reset]);

  useEffect(() => {
    if (!formState.isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [formState.isDirty]);

  // Live totals: same math as the server, intra/inter-state decided by vendor state vs delivery state.
  const values = watch();
  const vendorState = values.sourceOfSupplyCode || null;
  const deliveryState = values.destinationOfSupplyCode || null;
  const intraState = Boolean(vendorState && deliveryState && vendorState === deliveryState);
  const totals = useMemo(() => computeFormTotals(values, options.taxes, intraState), [values, options.taxes, intraState]);

  const hasReceives = Boolean(po && po.lines.some((l) => l.receivedQuantity > 0));

  const submit = (mode: PoSubmitMode) =>
    handleSubmit(
      async () => {
        try {
          const payload = toPoPayload(getValues());
          const saved = await onSubmit(payload, mode);
          for (const file of pendingFiles) {
            try {
              await poApi.uploadDocument(saved.id, file);
            } catch (err) {
              toast.error(`${file.name}: ${toApiError(err).message}`);
            }
          }
          setPendingFiles([]);
          navigate(`/purchases/purchase-orders/${saved.id}`, { replace: true });
        } catch (err) {
          const apiErr = toApiError(err);
          if (apiErr.details.length) {
            const unmapped = applyServerErrors(apiErr, setError);
            toast.error(unmapped[0] ?? apiErr.message);
          } else {
            toast.error(apiErr.message);
          }
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      },
      () => {
        toast.error('Please fix the highlighted fields');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
    );

  return (
    <FormProvider {...form}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(po ? 'save' : 'draft')(); }} noValidate className="space-y-5">
        <Card>
          <CardBody className="py-5">
            <PoHeaderFields options={options} editing={Boolean(po)} locked={{ vendor: hasReceives }} poId={po?.id} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Item Table" description={intraState ? 'Taxes will be split into CGST and SGST.' : 'Taxes will be charged as IGST unless the vendor and delivery state match.'} />
          <CardBody>
            <PoLineItems options={options} totals={totals} />
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-6 mt-6">
              <Field label="Notes" htmlFor="notes" error={formState.errors.notes?.message}>
                <Textarea id="notes" rows={4} placeholder="Will be displayed on purchase order" {...form.register('notes')} />
              </Field>
              <PoTotals options={options} totals={totals} intraState={intraState} vendorState={vendorState} deliveryState={deliveryState} />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
            <Field label="Terms & Conditions" htmlFor="terms" error={formState.errors.terms?.message}>
              <Textarea id="terms" rows={5} placeholder="Enter the terms and conditions of your business to be displayed in your transaction" {...form.register('terms')} />
            </Field>
            <div>
              <p className="text-xs font-medium text-slate-600 mb-1">Attach File(s) to Purchase Order</p>
              <PoAttachments poId={po?.id} pending={pendingFiles} onPendingChange={setPendingFiles} canEdit />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            {options.customFields.length === 0 ? (
              <p className="text-sm text-slate-600">
                <span className="font-semibold text-slate-800">Additional Fields:</span> Start adding custom fields for your purchase orders by going to{' '}
                {canManageSettings ? (
                  <Link to="/settings/purchases" className="text-brand-700 hover:underline">
                    Settings &rarr; Purchases &rarr; Purchase Orders
                  </Link>
                ) : (
                  <em>Settings &rarr; Purchases &rarr; Purchase Orders</em>
                )}
                .
              </p>
            ) : (
              <div className="space-y-4 max-w-3xl">
                <h3 className="text-sm font-semibold text-slate-900">Additional Fields</h3>
                {options.customFields.map((def, i) => {
                  const error = formState.errors.customFields?.[i]?.value?.message;
                  return (
                    <Controller
                      key={def.id}
                      control={control}
                      name={`customFields.${i}.value`}
                      render={({ field }) => (
                        <Field label={def.label} required={def.isRequired} inline error={error}>
                          {def.fieldType === 'TEXT' && <Input value={(field.value as string | null) ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)} onBlur={field.onBlur} error={Boolean(error)} />}
                          {def.fieldType === 'NUMBER' && <Input type="number" step="any" inputMode="decimal" className="sm:max-w-xs tabular" value={field.value === null || field.value === undefined ? '' : String(field.value)} onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))} onBlur={field.onBlur} error={Boolean(error)} />}
                          {def.fieldType === 'DATE' && <Input type="date" className="sm:max-w-xs" value={(field.value as string | null) ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)} onBlur={field.onBlur} error={Boolean(error)} />}
                          {def.fieldType === 'DROPDOWN' && <Select placeholder="Select" className="sm:max-w-xs" value={(field.value as string | null) ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)} onBlur={field.onBlur} options={def.options.map((o) => ({ value: o, label: o }))} error={Boolean(error)} />}
                          {def.fieldType === 'BOOLEAN' && <Checkbox label="Yes" checked={Boolean(field.value)} onChange={(e) => field.onChange(e.target.checked)} onBlur={field.onBlur} />}
                        </Field>
                      )}
                    />
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>

        <div className="sticky bottom-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-white/95 backdrop-blur border-t border-slate-200 flex flex-wrap items-center gap-2">
          {po ? (
            <Button type="submit" loading={submitting}>
              Save
            </Button>
          ) : (
            <>
              <Button type="submit" loading={submitting}>
                Save as Draft
              </Button>
              {canIssuePurchaseOrder && (
                <Button type="button" variant="primary" className="bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800" disabled={submitting} onClick={() => void submit('issue')()}>
                  Save and Issue
                </Button>
              )}
            </>
          )}
          <Button type="button" variant="ghost" disabled={submitting} onClick={() => navigate(po ? `/purchases/purchase-orders/${po.id}` : '/purchases/purchase-orders')}>
            Cancel
          </Button>
          <span className="ml-auto text-xs text-slate-500 tabular">
            {formState.isDirty && <span className="mr-3">Unsaved changes</span>}
            Total: <strong className="text-slate-800">{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(totals.total)}</strong>
          </span>
        </div>
      </form>
    </FormProvider>
  );
}
