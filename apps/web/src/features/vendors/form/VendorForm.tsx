import { useEffect, useMemo, useState } from 'react';
import { FormProvider, useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { vendorCreateSchema } from '@b2b/shared';
import { Button, Card, CardBody, Tabs, type TabItem } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import type { VendorDetail, VendorFormOptions } from '../types';
import { applyServerErrors, defaultVendorValues, tabForPath, toVendorPayload, vendorToFormValues, type VendorFormTab, type VendorFormValues } from './vendorForm.model';
import { VendorBasicInfo } from './VendorBasicInfo';
import { VendorOtherDetails } from './VendorOtherDetails';
import { VendorAddressForm } from './VendorAddressForm';
import { VendorContactPersons } from './VendorContactPersons';
import { VendorBankDetails } from './VendorBankDetails';
import { VendorCustomFields } from './VendorCustomFields';
import { VendorReportingTags } from './VendorReportingTags';
import { VendorRemarks } from './VendorRemarks';
import { GstPrefill } from './GstPrefill';

export interface VendorFormProps {
  options: VendorFormOptions;
  vendor?: VendorDetail;
  onSubmit: (payload: ReturnType<typeof toVendorPayload>, andNew: boolean) => Promise<VendorDetail>;
  submitting: boolean;
}

export function VendorForm({ options, vendor, onSubmit, submitting }: VendorFormProps) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<VendorFormTab>('other');
  const defaults = useMemo(() => (vendor ? vendorToFormValues(vendor, options) : defaultVendorValues(options)), [vendor, options]);

  const form = useForm<VendorFormValues>({
    defaultValues: defaults,
    // The shared zod schema validates the raw form values; transforms are applied again in toVendorPayload.
    resolver: zodResolver(vendorCreateSchema) as unknown as Resolver<VendorFormValues>,
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

  const tabs: TabItem<VendorFormTab>[] = [
    { key: 'other', label: 'Other Details', hasError: errorTabs.has('other') },
    { key: 'address', label: 'Address', hasError: errorTabs.has('address') },
    { key: 'contacts', label: 'Contact Persons', count: form.watch('contacts').length || undefined, hasError: errorTabs.has('contacts') },
    { key: 'bank', label: 'Bank Details', count: form.watch('bankAccounts').length || undefined, hasError: errorTabs.has('bank') },
    { key: 'custom', label: 'Custom Fields', hasError: errorTabs.has('custom') },
    { key: 'tags', label: 'Reporting Tags', hasError: errorTabs.has('tags') },
    { key: 'remarks', label: 'Remarks', hasError: errorTabs.has('remarks') },
  ];

  const submit = (andNew: boolean) =>
    handleSubmit(
      async (values) => {
        try {
          // The resolver returns zod output, which strips the UI-only flag; read it from form state.
          const payload = toVendorPayload({ ...values, shippingSameAsBilling: getValues('shippingSameAsBilling') });
          const saved = await onSubmit(payload, andNew);
          if (andNew) {
            reset(defaultVendorValues(options));
            setTab('other');
            window.scrollTo({ top: 0 });
          } else {
            navigate(`/purchases/vendors/${saved.id}`, { replace: true });
          }
        } catch (err) {
          const apiErr = toApiError(err);
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
        {!vendor && <GstPrefill options={options} />}

        <Card>
          <CardBody className="py-5">
            <VendorBasicInfo options={options} />
          </CardBody>
        </Card>

        <Card>
          <Tabs tabs={tabs} value={tab} onChange={setTab} className="px-3" />
          <CardBody className="py-5">
            <div hidden={tab !== 'other'}><VendorOtherDetails options={options} /></div>
            <div hidden={tab !== 'address'}><VendorAddressForm options={options} /></div>
            <div hidden={tab !== 'contacts'}><VendorContactPersons options={options} /></div>
            <div hidden={tab !== 'bank'}><VendorBankDetails options={options} /></div>
            <div hidden={tab !== 'custom'}><VendorCustomFields options={options} /></div>
            <div hidden={tab !== 'tags'}><VendorReportingTags options={options} /></div>
            <div hidden={tab !== 'remarks'}><VendorRemarks /></div>
          </CardBody>
        </Card>

        <div className="sticky bottom-0 z-20 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3 bg-white/95 backdrop-blur border-t border-slate-200 flex flex-wrap items-center gap-2">
          <Button type="submit" loading={submitting}>
            {vendor ? 'Save Changes' : 'Save'}
          </Button>
          {!vendor && (
            <Button type="button" variant="secondary" disabled={submitting} onClick={() => void submit(true)()}>
              Save and New
            </Button>
          )}
          <Button type="button" variant="ghost" disabled={submitting} onClick={() => navigate(vendor ? `/purchases/vendors/${vendor.id}` : '/purchases/vendors')}>
            Cancel
          </Button>
          {formState.isDirty && <span className="text-xs text-slate-500 ml-auto">Unsaved changes</span>}
        </div>
      </form>
    </FormProvider>
  );
}
