import { useEffect, useMemo, useState } from 'react';
import { FormProvider, useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { partyFormSchema, type PartyFormPayload } from '@b2b/shared';
import { Button, Card, CardBody, Tabs, type TabItem } from '../../../components/ui';
import { toApiError, type ApiError } from '../../../lib/api';
import { PARTY_META, type PartyDetail, type PartyFormOptions, type PartyType } from '../types';
import { applyServerErrors, defaultPartyValues, partyToFormValues, preservedCustomFields, tabForPath, toPartyPayload, type PartyFormTab, type PartyFormValues } from './partyForm.model';
import { PartyBasicInfo } from './PartyBasicInfo';
import { PartyOtherDetails } from './PartyOtherDetails';
import { PartyAddressForm } from './PartyAddressForm';
import { PartyContactPersons } from './PartyContactPersons';
import { PartyBankDetails } from './PartyBankDetails';
import { PartyCustomFields } from './PartyCustomFields';
import { PartyRemarks } from './PartyRemarks';
import { GstPrefill } from './GstPrefill';

export interface PartyFormProps {
  type: PartyType;
  options: PartyFormOptions;
  party?: PartyDetail;
  onSubmit: (payload: PartyFormPayload, andNew: boolean) => Promise<PartyDetail>;
  /** Return true when the error was handled (e.g. a version conflict that reloads the record). */
  onError?: (error: ApiError) => boolean;
  submitting: boolean;
}

export function PartyForm({ type, options, party, onSubmit, onError, submitting }: PartyFormProps) {
  const meta = PARTY_META[type];
  const base = `/parties/${meta.route}`;
  const navigate = useNavigate();
  const [tab, setTab] = useState<PartyFormTab>('other');
  const defaults = useMemo(() => (party ? partyToFormValues(party, options) : defaultPartyValues(options)), [party, options]);

  const form = useForm<PartyFormValues>({
    defaultValues: defaults,
    // The shared zod schema validates the raw form values; transforms are applied again in toPartyPayload.
    resolver: zodResolver(partyFormSchema) as unknown as Resolver<PartyFormValues>,
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });
  const { handleSubmit, formState, setError, reset, getValues } = form;

  useEffect(() => reset(defaults), [defaults, reset]);

  // Leave-page guard while there are unsaved changes.
  useEffect(() => {
    if (!formState.isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [formState.isDirty]);

  const errorTabs = useMemo(() => {
    const set = new Set<string>();
    Object.keys(formState.errors).forEach((k) => set.add(tabForPath(k)));
    return set;
  }, [formState.errors]);

  const tabs: TabItem<PartyFormTab>[] = [
    { key: 'other', label: 'Other Details', hasError: errorTabs.has('other') },
    { key: 'address', label: 'Address', hasError: errorTabs.has('address') },
    { key: 'contacts', label: 'Contact Persons', count: form.watch('contacts').length || undefined, hasError: errorTabs.has('contacts') },
    { key: 'bank', label: 'Bank Details', count: form.watch('bankAccounts').length || undefined, hasError: errorTabs.has('bank') },
    { key: 'custom', label: 'Custom Fields', hasError: errorTabs.has('custom') },
    { key: 'remarks', label: 'Remarks', hasError: errorTabs.has('remarks') },
  ];

  const submit = (andNew: boolean) =>
    handleSubmit(
      async (values) => {
        try {
          // The resolver returns zod output, which strips the UI-only flag; read it from form state.
          const payload = toPartyPayload({ ...values, shippingSameAsBilling: getValues('shippingSameAsBilling') });
          const full = party ? { ...payload, customFields: [...payload.customFields, ...preservedCustomFields(party, options)] } : payload;
          const saved = await onSubmit(full, andNew);
          if (andNew) {
            reset(defaultPartyValues(options));
            setTab('other');
            window.scrollTo({ top: 0 });
          } else {
            navigate(`${base}/${saved.id}`, { replace: true });
          }
        } catch (err) {
          const apiErr = toApiError(err);
          if (onError?.(apiErr)) return;
          if (apiErr.details.length) {
            const { firstTab, unmapped } = applyServerErrors(apiErr, setError);
            if (firstTab && firstTab !== 'basic') setTab(firstTab);
            toast.error(unmapped[0] ?? apiErr.message);
          } else {
            toast.error(apiErr.message);
          }
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      },
      (errs) => {
        const first = Object.keys(errs)[0];
        const t = first ? tabForPath(first) : 'basic';
        if (t !== 'basic') setTab(t);
        toast.error('Please fix the highlighted fields');
      },
    );

  return (
    <FormProvider {...form}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(false)(); }} noValidate className="space-y-5">
        {!party && <GstPrefill type={type} options={options} />}

        <Card>
          <CardBody className="py-5">
            <PartyBasicInfo type={type} options={options} />
          </CardBody>
        </Card>

        <Card>
          <Tabs tabs={tabs} value={tab} onChange={setTab} className="px-3" />
          <CardBody className="py-5">
            <div hidden={tab !== 'other'}><PartyOtherDetails type={type} options={options} /></div>
            <div hidden={tab !== 'address'}><PartyAddressForm options={options} /></div>
            <div hidden={tab !== 'contacts'}><PartyContactPersons type={type} options={options} /></div>
            <div hidden={tab !== 'bank'}><PartyBankDetails type={type} options={options} /></div>
            <div hidden={tab !== 'custom'}><PartyCustomFields type={type} options={options} /></div>
            <div hidden={tab !== 'remarks'}><PartyRemarks /></div>
          </CardBody>
        </Card>

        <div className="sticky bottom-0 z-20 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3 bg-white/95 backdrop-blur border-t border-slate-200 flex flex-wrap items-center gap-2">
          <Button type="submit" loading={submitting}>
            {party ? 'Save Changes' : 'Save'}
          </Button>
          {!party && (
            <Button type="button" variant="secondary" disabled={submitting} onClick={() => void submit(true)()}>
              Save and New
            </Button>
          )}
          <Button type="button" variant="ghost" disabled={submitting} onClick={() => navigate(party ? `${base}/${party.id}` : base)}>
            Cancel
          </Button>
          {formState.isDirty && <span className="text-xs text-slate-500 ml-auto">Unsaved changes</span>}
        </div>
      </form>
    </FormProvider>
  );
}
