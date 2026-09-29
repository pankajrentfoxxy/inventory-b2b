import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Hash, MapPin, Percent, Pencil, Plus, Star, ToggleLeft, ToggleRight } from 'lucide-react';
import { INDIAN_STATES, LOCATION_TYPES, LOCATION_TYPE_LABELS, formatDocumentNumber, locationSchema, taxSchema } from '@b2b/shared';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Select, Skeleton } from '../../components/ui';
import { api, toApiError } from '../../lib/api';
import { usePermission } from '../../lib/auth';
import { applyServerErrors, applyZodIssues, summarizeErrors } from '../../lib/validation';
import { formatAddress } from '../purchase-orders/form/poForm.model';
import type { PoFormOptions } from '../purchase-orders/types';
import { CustomFieldsCard } from './CustomFieldsCard';

type Location = PoFormOptions['locations'][number];
type Tax = PoFormOptions['taxes'][number];
interface Sequence { docType: 'PURCHASE_ORDER' | 'PURCHASE_RECEIVE'; prefix: string; nextNumber: number; padding: number; preview: string }

type LocationForm = { name: string; type: (typeof LOCATION_TYPES)[number]; attention: string; addressLine1: string; addressLine2: string; city: string; stateCode: string; state: string; postalCode: string; phone: string; email: string; gstin: string; isPrimary: boolean };
const emptyLocation = (): LocationForm => ({ name: '', type: 'WAREHOUSE', attention: '', addressLine1: '', addressLine2: '', city: '', stateCode: '', state: '', postalCode: '', phone: '', email: '', gstin: '', isPrimary: false });

function useInvalidatePurchaseSettings() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['settings'] });
    void qc.invalidateQueries({ queryKey: ['purchase-orders', 'form-options'] });
  };
}

/* ---- Locations ------------------------------------------------------------- */

function LocationsCard() {
  const { canManageSettings } = usePermission();
  const invalidate = useInvalidatePurchaseSettings();
  const q = useQuery({ queryKey: ['settings', 'locations'], queryFn: () => api.get<{ data: Location[] }>('/settings/locations').then((r) => r.data.data) });
  const [modal, setModal] = useState<{ open: boolean; location: Location | null }>({ open: false, location: null });
  const form = useForm<LocationForm>({ defaultValues: emptyLocation() });
  const save = useMutation({ mutationFn: ({ id, body }: { id: string | null; body: unknown }) => (id ? api.patch(`/settings/locations/${id}`, body) : api.post('/settings/locations', body)), onSuccess: invalidate });
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: unknown }) => api.patch(`/settings/locations/${id}`, body), onSuccess: invalidate });

  const openModal = (l: Location | null) => {
    form.reset(l ? { name: l.name, type: l.type as LocationForm['type'], attention: l.attention ?? '', addressLine1: l.addressLine1 ?? '', addressLine2: l.addressLine2 ?? '', city: l.city ?? '', stateCode: l.stateCode ?? '', state: l.state ?? '', postalCode: l.postalCode ?? '', phone: l.phone ?? '', email: l.email ?? '', gstin: l.gstin ?? '', isPrimary: l.isPrimary } : emptyLocation());
    setModal({ open: true, location: l });
  };

  const submit = form.handleSubmit(async (v) => {
    const parsed = locationSchema.safeParse({ ...v, countryCode: 'IN', isActive: modal.location?.isActive ?? true });
    if (!parsed.success) {
      applyZodIssues(form.setError, parsed.error);
      return;
    }
    try {
      await save.mutateAsync({ id: modal.location?.id ?? null, body: parsed.data });
      toast.success(modal.location ? 'Location updated' : 'Location added');
      setModal({ open: false, location: null });
    } catch (err) {
      const e = toApiError(err);
      toast.error(summarizeErrors(applyServerErrors(form.setError, e), e.message));
    }
  });

  return (
    <Card>
      <CardHeader title="Locations" description="Warehouses and offices used as purchase order locations and delivery addresses. The primary location is the default." actions={canManageSettings && <Button size="sm" icon={Plus} onClick={() => openModal(null)}>Add Location</Button>} />
      <CardBody className="p-0">
        {q.isLoading ? <div className="p-4 space-y-2"><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : q.isError ? <ErrorState message={toApiError(q.error).message} onRetry={() => void q.refetch()} /> : q.data!.length === 0 ? <EmptyState icon={MapPin} title="No locations" className="py-10" /> : (
          <ul className="divide-y divide-slate-100">
            {q.data!.map((l) => (
              <li key={l.id} className="flex items-start gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 flex items-center gap-2">
                    {l.name}
                    <span className="text-xs text-slate-500 font-normal">{LOCATION_TYPE_LABELS[l.type as keyof typeof LOCATION_TYPE_LABELS] ?? l.type}</span>
                    {l.isPrimary && <Badge tone="blue"><Star className="w-3 h-3" /> Primary</Badge>}
                    {!l.isActive && <Badge tone="gray">Inactive</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">{formatAddress(l).join(', ') || <span className="text-amber-700">No address yet. Add one so purchase orders can be delivered here.</span>}</p>
                </div>
                {canManageSettings && (
                  <>
                    {!l.isPrimary && l.isActive && <Button size="xs" variant="ghost" onClick={() => patch.mutateAsync({ id: l.id, body: { isPrimary: true } }).catch((e) => toast.error(toApiError(e).message))}>Make primary</Button>}
                    <Button size="xs" variant="ghost" icon={Pencil} onClick={() => openModal(l)}>Edit</Button>
                    {!l.isPrimary && <Button size="xs" variant="ghost" icon={l.isActive ? ToggleRight : ToggleLeft} onClick={() => patch.mutateAsync({ id: l.id, body: { isActive: !l.isActive } }).catch((e) => toast.error(toApiError(e).message))}>{l.isActive ? 'Deactivate' : 'Activate'}</Button>}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>

      <Modal open={modal.open} onClose={() => setModal({ open: false, location: null })} title={modal.location ? `Edit ${modal.location.name}` : 'Add Location'} size="lg" footer={<><Button variant="secondary" onClick={() => setModal({ open: false, location: null })}>Cancel</Button><Button onClick={() => void submit()} loading={save.isPending}>Save</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px] gap-3">
            <Field label="Name" required error={form.formState.errors.name?.message}><Input autoFocus sanitize="singleLine" maxLength={120} placeholder="e.g. Gurugram Warehouse" error={Boolean(form.formState.errors.name)} {...form.register('name')} /></Field>
            <Field label="Type"><Select options={LOCATION_TYPES.map((t) => ({ value: t, label: LOCATION_TYPE_LABELS[t] }))} {...form.register('type')} /></Field>
          </div>
          <Field label="Attention" error={form.formState.errors.attention?.message}><Input placeholder="Company / person receiving deliveries" {...form.register('attention')} /></Field>
          <Field label="Address" error={form.formState.errors.addressLine1?.message ?? form.formState.errors.addressLine2?.message}>
            <div className="space-y-2">
              <Input placeholder="Street 1" {...form.register('addressLine1')} />
              <Input placeholder="Street 2" {...form.register('addressLine2')} />
            </div>
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="City" error={form.formState.errors.city?.message}><Input {...form.register('city')} /></Field>
            <Field label="State" required error={form.formState.errors.stateCode?.message}>
              <Select placeholder="Select state" value={form.watch('stateCode')} onChange={(e) => { const st = INDIAN_STATES.find((s) => s.code === e.target.value); form.setValue('stateCode', st?.code ?? ''); form.setValue('state', st?.name ?? ''); }} options={INDIAN_STATES.map((s) => ({ value: s.code, label: s.name }))} />
            </Field>
            <Field label="PIN Code" error={form.formState.errors.postalCode?.message}><Input sanitize="pincode" error={Boolean(form.formState.errors.postalCode)} {...form.register('postalCode')} /></Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Phone" error={form.formState.errors.phone?.message}><Input sanitize="phone" maxLength={20} error={Boolean(form.formState.errors.phone)} {...form.register('phone')} /></Field>
            <Field label="Email" error={form.formState.errors.email?.message}><Input type="email" sanitize="email" maxLength={254} error={Boolean(form.formState.errors.email)} {...form.register('email')} /></Field>
            <Field label="GSTIN" error={form.formState.errors.gstin?.message} hint="GSTIN registered for this location, if different from the organization."><Input sanitize="gstin" className="uppercase font-mono" error={Boolean(form.formState.errors.gstin)} {...form.register('gstin')} /></Field>
          </div>
          <Checkbox label="Primary location" description="Used as the default location and delivery address on new purchase orders." {...form.register('isPrimary')} />
        </form>
      </Modal>
    </Card>
  );
}

/* ---- Taxes --------------------------------------------------------------------- */

function TaxesCard() {
  const { canManageSettings } = usePermission();
  const invalidate = useInvalidatePurchaseSettings();
  const q = useQuery({ queryKey: ['settings', 'taxes'], queryFn: () => api.get<{ data: Tax[] }>('/settings/taxes').then((r) => r.data.data) });
  const [modal, setModal] = useState<{ open: boolean; tax: Tax | null }>({ open: false, tax: null });
  const form = useForm<{ name: string; rate: string; isDefault: boolean }>({ defaultValues: { name: '', rate: '', isDefault: false } });
  const save = useMutation({ mutationFn: ({ id, body }: { id: string | null; body: unknown }) => (id ? api.patch(`/settings/taxes/${id}`, body) : api.post('/settings/taxes', body)), onSuccess: invalidate });

  const submit = form.handleSubmit(async (v) => {
    const parsed = taxSchema.safeParse({ name: v.name, rate: v.rate, isDefault: v.isDefault, isActive: modal.tax?.isActive ?? true });
    if (!parsed.success) {
      applyZodIssues(form.setError, parsed.error);
      return;
    }
    try {
      await save.mutateAsync({ id: modal.tax?.id ?? null, body: parsed.data });
      toast.success(modal.tax ? 'Tax updated' : 'Tax added');
      setModal({ open: false, tax: null });
    } catch (err) {
      const e = toApiError(err);
      toast.error(summarizeErrors(applyServerErrors(form.setError, e), e.message));
    }
  });

  return (
    <Card>
      <CardHeader title="Taxes" description="GST rates available on items and purchase order lines. Intra-state orders split the rate into CGST + SGST, inter-state orders charge IGST." actions={canManageSettings && <Button size="sm" icon={Plus} onClick={() => { form.reset({ name: '', rate: '', isDefault: false }); setModal({ open: true, tax: null }); }}>Add Tax</Button>} />
      <CardBody className="p-0">
        {q.isLoading ? <div className="p-4 space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : q.isError ? <ErrorState message={toApiError(q.error).message} onRetry={() => void q.refetch()} /> : (
          <ul className="divide-y divide-slate-100">
            {q.data!.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center"><Percent className="w-4 h-4" /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 flex items-center gap-2">{t.name}{t.isDefault && <Badge tone="blue">Default</Badge>}{!t.isActive && <Badge tone="gray">Inactive</Badge>}</p>
                  <p className="text-xs text-slate-500 tabular">{t.rate}%</p>
                </div>
                {canManageSettings && (
                  <>
                    <Button size="xs" variant="ghost" icon={Pencil} onClick={() => { form.reset({ name: t.name, rate: String(t.rate), isDefault: t.isDefault }); setModal({ open: true, tax: t }); }}>Edit</Button>
                    <Button size="xs" variant="ghost" icon={t.isActive ? ToggleRight : ToggleLeft} onClick={() => save.mutateAsync({ id: t.id, body: { isActive: !t.isActive } }).catch((e) => toast.error(toApiError(e).message))}>{t.isActive ? 'Deactivate' : 'Activate'}</Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <Modal open={modal.open} onClose={() => setModal({ open: false, tax: null })} title={modal.tax ? `Edit ${modal.tax.name}` : 'Add Tax'} size="sm" footer={<><Button variant="secondary" onClick={() => setModal({ open: false, tax: null })}>Cancel</Button><Button onClick={() => void submit()} loading={save.isPending}>Save</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate className="space-y-3">
          <Field label="Tax name" required error={form.formState.errors.name?.message}><Input autoFocus sanitize="singleLine" maxLength={50} placeholder="e.g. GST18" error={Boolean(form.formState.errors.name)} {...form.register('name')} /></Field>
          <Field label="Rate" required error={form.formState.errors.rate?.message}><Input sanitize="decimal" suffix="%" className="tabular" error={Boolean(form.formState.errors.rate)} {...form.register('rate')} /></Field>
          <Checkbox label="Default tax for new items and lines" {...form.register('isDefault')} />
        </form>
      </Modal>
    </Card>
  );
}

/* ---- Numbering ------------------------------------------------------------------ */

function SequenceRow({ seq, canEdit, onSaved }: { seq: Sequence; canEdit: boolean; onSaved: () => void }) {
  const [prefix, setPrefix] = useState(seq.prefix);
  const [next, setNext] = useState(String(seq.nextNumber));
  const [padding, setPadding] = useState(String(seq.padding));
  useEffect(() => {
    setPrefix(seq.prefix);
    setNext(String(seq.nextNumber));
    setPadding(String(seq.padding));
  }, [seq]);
  const save = useMutation({ mutationFn: () => api.put(`/settings/document-sequences/${seq.docType}`, { prefix, nextNumber: Number(next), padding: Number(padding) }), onSuccess: onSaved });
  const dirty = prefix !== seq.prefix || Number(next) !== seq.nextNumber || Number(padding) !== seq.padding;
  return (
    <li className="px-4 py-3 grid grid-cols-1 md:grid-cols-[180px_1fr_1fr_1fr_auto] gap-3 items-end">
      <div>
        <p className="text-sm font-medium text-slate-900">{seq.docType === 'PURCHASE_ORDER' ? 'Purchase Orders' : 'Purchase Receives'}</p>
        <p className="text-xs text-slate-500 font-mono">Next: {formatDocumentNumber(prefix, Number(next) || 1, Number(padding) || 0)}</p>
      </div>
      <Field label="Prefix"><Input value={prefix} sanitize="singleLine" maxLength={20} onChange={(e) => setPrefix(e.target.value)} disabled={!canEdit} className="font-mono h-8 text-xs" /></Field>
      <Field label="Next Number"><Input sanitize="integer" maxLength={9} value={next} onChange={(e) => setNext(e.target.value)} disabled={!canEdit} className="font-mono h-8 text-xs tabular" /></Field>
      <Field label="Digits"><Input sanitize="integer" maxLength={2} value={padding} onChange={(e) => setPadding(e.target.value)} disabled={!canEdit} className="font-mono h-8 text-xs tabular" /></Field>
      {canEdit && <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutateAsync().then(() => toast.success('Numbering updated')).catch((e) => toast.error(toApiError(e).message))}>Save</Button>}
    </li>
  );
}

function NumberingCard() {
  const { canManageSettings } = usePermission();
  const invalidate = useInvalidatePurchaseSettings();
  const q = useQuery({ queryKey: ['settings', 'document-sequences'], queryFn: () => api.get<{ data: Sequence[] }>('/settings/document-sequences').then((r) => r.data.data) });
  return (
    <Card>
      <CardHeader title="Document Numbering" description="Auto-generated numbers for purchase documents. Manually entered numbers that match the pattern move the sequence forward." />
      <CardBody className="p-0">
        {q.isLoading ? <div className="p-4"><Skeleton className="h-16" /></div> : q.isError ? <ErrorState message={toApiError(q.error).message} onRetry={() => void q.refetch()} /> : (
          <ul className="divide-y divide-slate-100">
            {q.data!.map((s) => <SequenceRow key={s.docType} seq={s} canEdit={canManageSettings} onSaved={invalidate} />)}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export function PurchaseSettingsPage() {
  return (
    <>
      <PageHeader title="Purchase Settings" subtitle="Locations, taxes, numbering and custom fields used across purchasing." breadcrumbs={[{ label: 'Settings' }, { label: 'Purchases' }]} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <LocationsCard />
        <TaxesCard />
        <NumberingCard />
        <CustomFieldsCard entityType="PURCHASE_ORDER" title="Purchase Order Fields" description="Additional fields shown on every purchase order. Types cannot be changed after creation." entityLabel="purchase order" />
      </div>
      <p className="mt-4 text-xs text-slate-400 flex items-center gap-1"><Hash className="w-3 h-3" /> Numbering and masters are organization-specific.</p>
    </>
  );
}
