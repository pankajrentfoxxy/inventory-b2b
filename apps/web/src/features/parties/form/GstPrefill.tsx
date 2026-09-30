import { useState } from 'react';
import { useFormContext } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Pencil, Sparkles } from 'lucide-react';
import { INDIAN_STATES, LEGACY_GST_TREATMENT_TO_PARTY, MESSAGES, isValidGstin, panFromGstin, stateCodeFromGstin } from '@b2b/shared';
import { Button, Field, Input, Modal } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { cn } from '../../../lib/utils';
import { gstLookup } from '../api';
import { PARTY_META, type GstLookupResult, type PartyFormOptions, type PartyType } from '../types';
import { emptyAddress, type PartyFormValues } from './partyForm.model';

/**
 * "Prefill Vendor / Customer Details From the GST Portal": fetch the GSTIN record, let the user review
 * (and adjust the company name / pick an address), then write it into the form.
 */
export function GstPrefill({ type, options }: { type: PartyType; options: PartyFormOptions }) {
  const meta = PARTY_META[type];
  const noun = meta.singular.toLowerCase();
  const { setValue, getValues } = useFormContext<PartyFormValues>();
  const [open, setOpen] = useState(false);
  const [gstin, setGstin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GstLookupResult | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [addressIndex, setAddressIndex] = useState(0);

  const reset = () => {
    setResult(null);
    setError(null);
    setEditingName(false);
    setAddressIndex(0);
  };

  const fetchDetails = async () => {
    const value = gstin.trim().toUpperCase();
    if (!isValidGstin(value)) {
      setError(MESSAGES.gstin);
      return;
    }
    setError(null);
    setLoading(true);
    setResult(null);
    try {
      const r = await gstLookup(value);
      setResult(r);
      setCompanyName(r.legalName ?? r.tradeName ?? '');
      setAddressIndex(0);
    } catch (err) {
      const e = toApiError(err);
      if (e.status === 501) {
        // No provider configured: still apply what the GSTIN itself tells us.
        applyDerived(value);
        toast(e.message, { icon: 'i', duration: 6000 });
        setOpen(false);
      } else {
        setError(e.message);
      }
    } finally {
      setLoading(false);
    }
  };

  /** PAN, state and default treatment can be derived from the GSTIN without any portal. */
  const applyDerived = (value: string) => {
    setValue('gstin', value, { shouldDirty: true, shouldValidate: true });
    const pan = panFromGstin(value);
    if (pan) setValue('pan', pan, { shouldDirty: true });
    const source = options.sourcesOfSupply.find((s) => s.code === stateCodeFromGstin(value));
    if (source) setValue('sourceOfSupply', source.code, { shouldDirty: true, shouldValidate: true });
    const regular = LEGACY_GST_TREATMENT_TO_PARTY.REGISTERED_BUSINESS_REGULAR;
    if (!getValues('gstTreatment')) setValue('gstTreatment', regular, { shouldDirty: true });
  };

  const prefill = () => {
    if (!result) return;
    applyDerived(result.gstin);

    const treatment = result.suggestedGstTreatmentCode ? LEGACY_GST_TREATMENT_TO_PARTY[result.suggestedGstTreatmentCode] : undefined;
    if (treatment) setValue('gstTreatment', treatment, { shouldDirty: true });

    const name = companyName.trim();
    if (name) {
      setValue('companyName', name, { shouldDirty: true });
      if (!getValues('displayName')) setValue('displayName', name, { shouldDirty: true });
    }

    const chosen = result.addresses[addressIndex];
    if (chosen) {
      const source = INDIAN_STATES.find((s) => s.code === (chosen.stateCode ?? stateCodeFromGstin(result.gstin)));
      if (source) setValue('sourceOfSupply', source.code, { shouldDirty: true, shouldValidate: true });
      const addresses = getValues('addresses');
      let idx = addresses.findIndex((a) => a.type === 'BILLING' && a.isPrimary);
      if (idx < 0) idx = addresses.findIndex((a) => a.type === 'BILLING');
      const base = idx >= 0 ? addresses[idx] : emptyAddress('BILLING', true);
      const next = {
        ...base,
        countryCode: 'IN',
        attention: base.attention || name,
        addressLine1: chosen.addressLine1,
        addressLine2: chosen.addressLine2,
        city: chosen.city,
        state: source?.name ?? chosen.state,
        stateCode: chosen.stateCode ?? '',
        postalCode: chosen.postalCode,
      };
      setValue('addresses', idx >= 0 ? addresses.map((a, i) => (i === idx ? next : a)) : [...addresses, next], { shouldDirty: true });
    }

    toast.success(`${meta.singular} details prefilled from ${result.source}`);
    setOpen(false);
    reset();
  };

  return (
    <>
      <div className="rounded-lg border border-brand-200 bg-brand-50/50 px-4 py-3">
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-2 text-sm text-brand-700 hover:underline">
          <Sparkles className="w-4 h-4" />
          Prefill {noun} details from the GST portal using the {noun}&apos;s GSTIN
        </button>
      </div>

      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          reset();
        }}
        title={`Prefill ${meta.singular} Details From the GST Portal`}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setOpen(false); reset(); }}>
              Cancel
            </Button>
            <Button onClick={prefill} disabled={!result}>
              Prefill Details
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <Field label="GSTIN/UIN" required inline error={error ?? undefined}>
            <div className="flex gap-2">
              <Input
                value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void fetchDetails())}
                maxLength={15}
                placeholder="e.g. 06AAHCT0310N1ZG"
                className="uppercase font-mono tabular"
                error={Boolean(error)}
                autoFocus
              />
              <Button variant="secondary" loading={loading} onClick={() => void fetchDetails()}>
                Fetch
              </Button>
            </div>
          </Field>

          {result && (
            <div className="border-t border-slate-100 pt-4">
              <h3 className="text-sm font-semibold text-slate-900 mb-3">Business Details</h3>
              <dl className="grid grid-cols-[170px_1fr] gap-y-2.5 gap-x-4 text-sm">
                <dt className="text-slate-500">Company Name</dt>
                <dd className="text-slate-900">
                  {editingName ? (
                    <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} onBlur={() => setEditingName(false)} autoFocus className="h-8" />
                  ) : (
                    <button type="button" onClick={() => setEditingName(true)} className="inline-flex items-center gap-1.5 text-left hover:text-brand-700">
                      {companyName || <span className="text-slate-400">Not provided</span>}
                      <Pencil className="w-3.5 h-3.5 text-brand-600" />
                    </button>
                  )}
                </dd>
                <dt className="text-slate-500">GSTIN/UIN status</dt>
                <dd className={cn('font-medium', result.status?.toLowerCase() === 'active' ? 'text-emerald-600' : 'text-amber-600')}>{result.status ?? '-'}</dd>
                <dt className="text-slate-500">Taxpayer Type</dt>
                <dd>{result.taxpayerType ?? '-'}</dd>
                <dt className="text-slate-500">Business Legal Name</dt>
                <dd>{result.legalName ?? '-'}</dd>
                <dt className="text-slate-500">Business Trade Name</dt>
                <dd>{result.tradeName ?? '-'}</dd>
                <dt className="text-slate-500">Constitution of Business</dt>
                <dd>{result.constitution ?? '-'}</dd>
                <dt className="text-slate-500">e-Invoicing Applicability</dt>
                <dd>{result.eInvoiceApplicable === null ? '-' : result.eInvoiceApplicable ? 'Applicable' : 'Not applicable'}</dd>
                {result.registeredDate && (
                  <>
                    <dt className="text-slate-500">Registered On</dt>
                    <dd>{result.registeredDate}</dd>
                  </>
                )}
                <dt className="text-slate-500">Available Addresses</dt>
                <dd className="space-y-2">
                  {result.addresses.length === 0 && <span className="text-slate-400">None on record</span>}
                  {result.addresses.map((a, i) => (
                    <label key={i} className={cn('flex gap-2.5 rounded-lg border p-2.5 cursor-pointer', i === addressIndex ? 'border-brand-400 bg-brand-50/40' : 'border-slate-200 hover:border-slate-300')}>
                      {result.addresses.length > 1 && <input type="radio" name="gst-address" className="mt-1 h-4 w-4 text-brand-600" checked={i === addressIndex} onChange={() => setAddressIndex(i)} />}
                      <span className="text-sm leading-relaxed">
                        {a.nature && <span className="block font-medium text-slate-800">{a.nature}</span>}
                        {a.addressLine1 && <span className="block">{a.addressLine1}</span>}
                        {a.addressLine2 && <span className="block">{a.addressLine2}</span>}
                        <span className="block">{a.city}</span>
                        <span className="block">
                          {a.state} {a.postalCode}
                        </span>
                      </span>
                    </label>
                  ))}
                </dd>
              </dl>
              <p className="text-xs text-slate-500 mt-4">Prefill sets the company name, display name (if empty), GST treatment, source of supply, GSTIN, PAN and the primary billing address. You can edit everything afterwards.</p>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
