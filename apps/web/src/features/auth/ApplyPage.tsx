import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm, type Path } from 'react-hook-form';
import toast from 'react-hot-toast';
import { CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { INDIAN_STATES, isValidGstin, panFromGstin, stateCodeFromGstin } from '@b2b/shared';
import { Button, EmptyState, Field, FormSection, Input } from '../../components/ui';
import { api, toApiError, unwrap } from '../../lib/api';
import { applyServerErrors, summarizeErrors } from '../../lib/validation';
import { cn } from '../../lib/utils';
import { AuthShell } from './AuthShell';

interface ApplyValues {
  legalName: string;
  displayName: string;
  gstin: string;
  pan: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  registeredAddress: { line1: string; line2: string; city: string; state: string; stateCode: string; pincode: string; country: string };
}

interface GstAddress { addressLine1: string; addressLine2: string; city: string; state: string; stateCode: string | null; postalCode: string; isPrincipal: boolean }
interface GstLookupResult { gstin: string; legalName: string | null; tradeName: string | null; status: string | null; stateCode: string | null; addresses: GstAddress[]; source: string }
type LookupState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'done'; source: string; status: string | null } | { kind: 'unavailable' } | { kind: 'error'; message: string };

/** Public GSTIN lookup (rate limited by the API); the application form has no token yet. */
const lookupGstin = (gstin: string) => api.get<{ data: GstLookupResult }>('/public/gst/lookup', { params: { gstin } }).then(unwrap);

/** Public vendor application (Phase 1): replaces self-registration; platform staff approve. */
export function ApplyPage() {
  const [done, setDone] = useState<string | null>(null);
  const { register, handleSubmit, setError, watch, getValues, setValue, formState: { errors, isSubmitting } } = useForm<ApplyValues>({
    defaultValues: { legalName: '', displayName: '', gstin: '', pan: '', ownerName: '', ownerEmail: '', ownerPhone: '', registeredAddress: { line1: '', line2: '', city: '', state: '', stateCode: '', pincode: '', country: 'IN' } },
  });

  /* ---- GSTIN prefill: once a valid GSTIN is typed, fetch the registration and fill the form. ---- */
  const gstinValue = watch('gstin');
  const [lookup, setLookup] = useState<LookupState>({ kind: 'idle' });
  const lastLookedUp = useRef('');
  // Values written by the lookup, so a second lookup may replace them but never the applicant's own typing.
  const filledByLookup = useRef<Partial<Record<Path<ApplyValues>, string>>>({});

  const fill = (name: Path<ApplyValues>, value: string | null | undefined) => {
    if (!value) return;
    const current = String(getValues(name) ?? '');
    if (current && current !== filledByLookup.current[name]) return;
    setValue(name, value, { shouldDirty: true });
    filledByLookup.current[name] = value;
  };

  /** PAN and state can be derived from the GSTIN itself, with or without a portal lookup. */
  const fillDerived = (gstin: string) => {
    fill('pan', panFromGstin(gstin));
    const code = stateCodeFromGstin(gstin);
    if (code) {
      fill('registeredAddress.stateCode', code);
      fill('registeredAddress.state', INDIAN_STATES.find((s) => s.code === code)?.name ?? null);
    }
  };

  const runLookup = async (gstin: string) => {
    setLookup({ kind: 'loading' });
    fillDerived(gstin);
    try {
      const r = await lookupGstin(gstin);
      fill('legalName', r.legalName);
      fill('displayName', r.tradeName ?? r.legalName);
      const address = r.addresses.find((a) => a.isPrincipal) ?? r.addresses[0];
      if (address) {
        fill('registeredAddress.line1', address.addressLine1);
        fill('registeredAddress.line2', address.addressLine2);
        fill('registeredAddress.city', address.city);
        fill('registeredAddress.stateCode', address.stateCode);
        fill('registeredAddress.state', INDIAN_STATES.find((s) => s.code === address.stateCode)?.name ?? address.state);
        fill('registeredAddress.pincode', address.postalCode);
      }
      setLookup({ kind: 'done', source: r.source, status: r.status });
    } catch (err) {
      const e = toApiError(err);
      setLookup(e.status === 501 ? { kind: 'unavailable' } : { kind: 'error', message: e.message });
    }
  };

  useEffect(() => {
    const value = (gstinValue ?? '').trim().toUpperCase();
    if (value.length !== 15 || !isValidGstin(value) || value === lastLookedUp.current) return;
    lastLookedUp.current = value;
    const timer = setTimeout(() => void runLookup(value), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gstinValue]);

  const lookupText = () => {
    switch (lookup.kind) {
      case 'loading': return 'Fetching business details from the GST portal...';
      case 'done': return 'Details filled from ' + lookup.source + (lookup.status ? ' (registration ' + lookup.status.toLowerCase() + ')' : '') + '. Check and edit anything that is wrong.';
      case 'unavailable': return 'PAN and state filled from the GSTIN. Portal lookup is not available right now, so enter the remaining details manually.';
      case 'error': return lookup.message;
      default: return '';
    }
  };
  const submit = handleSubmit(async (v) => {
    const payload = {
      legalName: v.legalName,
      displayName: v.displayName,
      gstin: v.gstin || null,
      pan: v.pan || null,
      ownerName: v.ownerName,
      ownerEmail: v.ownerEmail,
      ownerPhone: v.ownerPhone || null,
      registeredAddress: { ...v.registeredAddress, line2: v.registeredAddress.line2 || null, state: v.registeredAddress.state || null },
    };
    try {
      await api.post('/v1/public/vendor-applications', payload);
      setDone(v.ownerEmail);
    } catch (err) {
      const e = toApiError(err);
      toast.error(summarizeErrors(applyServerErrors(setError, e), e.message));
    }
  });
  const err = (path: string) => {
    const parts = path.split('.');
    let node: unknown = errors;
    for (const p of parts) node = (node as Record<string, unknown> | undefined)?.[p];
    return (node as { message?: string } | undefined)?.message;
  };

  if (done) {
    return (
      <AuthShell title="Application received" wide footer={<Link to="/login" className="hover:text-slate-800">Back to sign in</Link>}>
        <EmptyState icon={CheckCircle2} title="Thank you" hint={`Our team reviews applications within two working days. The owner invitation will be sent to ${done} once your account is approved.`} />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Apply for a supplier account" subtitle="Tell us about your business. Fields marked * are required." wide footer={<span>Already have an account? <Link to="/login" className="text-brand-700 hover:underline">Sign in</Link></span>}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate className="space-y-6">
        <FormSection title="Business">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Legal name" required error={err('legalName')}>
              <Input sanitize="singleLine" maxLength={200} {...register('legalName')} error={Boolean(err('legalName'))} />
            </Field>
            <Field label="Display name" required error={err('displayName')}>
              <Input sanitize="singleLine" maxLength={150} {...register('displayName')} error={Boolean(err('displayName'))} />
            </Field>
            <Field label="GSTIN" error={err('gstin')} hint="15 characters, leave blank if unregistered. Business details are fetched from the GST portal automatically.">
              <Input sanitize="gstin" maxLength={15} className="font-mono uppercase" {...register('gstin')} error={Boolean(err('gstin'))} />
              {lookup.kind !== 'idle' && (
                <p className={cn('mt-1.5 flex items-start gap-1.5 text-xs', lookup.kind === 'error' ? 'text-red-600' : lookup.kind === 'unavailable' ? 'text-amber-700' : 'text-slate-600')}>
                  {lookup.kind === 'loading' ? <Loader2 className="w-3.5 h-3.5 mt-px animate-spin shrink-0" /> : <Sparkles className="w-3.5 h-3.5 mt-px shrink-0" />}
                  <span>
                    {lookupText()}
                    {lookup.kind === 'error' && (
                      <>
                        {' '}
                        <button type="button" className="underline hover:text-red-800" onClick={() => void runLookup(lastLookedUp.current)}>Try again</button>
                      </>
                    )}
                  </span>
                </p>
              )}
            </Field>
            <Field label="PAN" error={err('pan')}>
              <Input sanitize="pan" maxLength={10} className="font-mono uppercase" {...register('pan')} error={Boolean(err('pan'))} />
            </Field>
          </div>
        </FormSection>
        <FormSection title="Registered address">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Address line 1" required error={err('registeredAddress.line1')} className="sm:col-span-2">
              <Input sanitize="singleLine" maxLength={255} {...register('registeredAddress.line1')} error={Boolean(err('registeredAddress.line1'))} />
            </Field>
            <Field label="Address line 2" error={err('registeredAddress.line2')} className="sm:col-span-2">
              <Input sanitize="singleLine" maxLength={255} {...register('registeredAddress.line2')} />
            </Field>
            <Field label="City" required error={err('registeredAddress.city')}>
              <Input sanitize="singleLine" maxLength={100} {...register('registeredAddress.city')} error={Boolean(err('registeredAddress.city'))} />
            </Field>
            <Field label="State" error={err('registeredAddress.state')}>
              <Input sanitize="singleLine" maxLength={100} {...register('registeredAddress.state')} />
            </Field>
            <Field label="State code" required error={err('registeredAddress.stateCode')} hint="GST state code, e.g. 27 for Maharashtra">
              <Input sanitize="digits" maxLength={2} className="font-mono" {...register('registeredAddress.stateCode')} error={Boolean(err('registeredAddress.stateCode'))} />
            </Field>
            <Field label="Pincode" required error={err('registeredAddress.pincode')}>
              <Input sanitize="pincode" maxLength={6} className="font-mono" {...register('registeredAddress.pincode')} error={Boolean(err('registeredAddress.pincode'))} />
            </Field>
          </div>
        </FormSection>
        <FormSection title="Owner">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Owner name" required error={err('ownerName')}>
              <Input sanitize="name" maxLength={100} {...register('ownerName')} error={Boolean(err('ownerName'))} />
            </Field>
            <Field label="Owner e-mail" required error={err('ownerEmail')} hint="The invitation to set up the account goes here">
              <Input type="email" sanitize="email" {...register('ownerEmail')} error={Boolean(err('ownerEmail'))} />
            </Field>
            <Field label="Owner phone" error={err('ownerPhone')}>
              <Input sanitize="phone" maxLength={15} {...register('ownerPhone')} error={Boolean(err('ownerPhone'))} />
            </Field>
          </div>
        </FormSection>
        <Button type="submit" className="w-full" loading={isSubmitting}>Submit application</Button>
      </form>
    </AuthShell>
  );
}
