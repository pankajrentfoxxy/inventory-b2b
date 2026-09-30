import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Button, Card, CardBody, CardHeader, PageHeader, Tabs } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { applyServerErrors, summarizeErrors } from '../../../lib/validation';
import { useIdempotencyKey, shouldRetryWithSameKey } from '../../../hooks/useIdempotencyKey';
import { useCreateParty } from '../hooks';
import { PARTY_META, type PartyType } from '../types';
import { AddressesSection, BankAccountsSection, ContactsSection, PartyBasicFields } from '../components/PartyFormFields';
import { emptyParty, toPartyPayload, type PartyFormValues } from '../components/partyForm.model';

type Section = 'basic' | 'addresses' | 'contacts' | 'bank';

/** Full-page create form (create is the only place where all sections are submitted together). */
export function PartyCreatePage({ type }: { type: PartyType }) {
  const meta = PARTY_META[type];
  const navigate = useNavigate();
  const create = useCreateParty(type);
  const idem = useIdempotencyKey();
  const form = useForm<PartyFormValues>({ defaultValues: emptyParty() });
  const { handleSubmit, setError, formState: { errors, isDirty } } = form;
  const [section, setSection] = useState<Section>('basic');
  const base = `/parties/${meta.path}`;

  const sectionHasError = (keys: (keyof PartyFormValues)[]) => keys.some((k) => Boolean(errors[k]));
  const basicKeys: (keyof PartyFormValues)[] = ['code', 'legalName', 'displayName', 'gstTreatment', 'gstin', 'pan', 'paymentTermId', 'creditLimit', 'creditDays', 'email', 'phone', 'website', 'remarks'];

  const submit = handleSubmit(async (values) => {
    const payload = toPartyPayload(values);
    try {
      const saved = await create.mutateAsync({ payload, idempotencyKey: idem.keyFor(payload) });
      idem.reset();
      toast.success(`${saved.displayName} created as ${saved.code}`);
      navigate(`${base}/${saved.id}`, { replace: true });
    } catch (err) {
      const e = toApiError(err);
      if (!shouldRetryWithSameKey(e.status)) idem.reset();
      const unmapped = applyServerErrors(setError, e);
      // Jump to the first section with a server error so the user sees it.
      const paths = e.details.map((d) => d.path);
      if (paths.some((p) => p.startsWith('addresses'))) setSection('addresses');
      else if (paths.some((p) => p.startsWith('contacts'))) setSection('contacts');
      else if (paths.some((p) => p.startsWith('bankAccounts'))) setSection('bank');
      else if (paths.length) setSection('basic');
      toast.error(summarizeErrors(unmapped, e.message));
    }
  });

  const addresses = form.watch('addresses');
  const contacts = form.watch('contacts');
  const bank = form.watch('bankAccounts');

  return (
    <>
      <PageHeader
        title={`New ${meta.singular}`}
        subtitle={type === 'SUPPLIER' ? 'Registered suppliers need a GSTIN whose state matches the default billing address.' : 'Consumers and unregistered businesses do not need a GSTIN.'}
        breadcrumbs={[{ label: 'Parties' }, { label: meta.plural, to: base }, { label: 'New' }]}
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate(base)} disabled={create.isPending}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} loading={create.isPending}>
              Save {meta.singular}
            </Button>
          </>
        }
      >
        <Tabs
          value={section}
          onChange={setSection}
          tabs={[
            { key: 'basic', label: 'Basic', hasError: sectionHasError(basicKeys) },
            { key: 'addresses', label: 'Addresses', count: addresses.length, hasError: Boolean(errors.addresses) },
            { key: 'contacts', label: 'Contacts', count: contacts.length, hasError: Boolean(errors.contacts) },
            { key: 'bank', label: 'Bank accounts', count: bank.length, hasError: Boolean(errors.bankAccounts) },
          ]}
        />
      </PageHeader>

      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        <Card className={section === 'basic' ? undefined : 'hidden'}>
          <CardHeader title="Basic details" description="Identity, GST registration and commercial terms." />
          <CardBody>
            <PartyBasicFields form={form} type={type} mode="create" />
          </CardBody>
        </Card>
        <Card className={section === 'addresses' ? undefined : 'hidden'}>
          <CardHeader title="Addresses" description="Billing and shipping addresses. The default billing address drives place of supply." />
          <CardBody>
            <AddressesSection form={form} />
          </CardBody>
        </Card>
        <Card className={section === 'contacts' ? undefined : 'hidden'}>
          <CardHeader title="Contact persons" description="People you deal with; one is primary." />
          <CardBody>
            <ContactsSection form={form} />
          </CardBody>
        </Card>
        <Card className={section === 'bank' ? undefined : 'hidden'}>
          <CardHeader title="Bank accounts" description="Account numbers are encrypted at rest and only revealed on request (audited)." />
          <CardBody>
            <BankAccountsSection form={form} />
          </CardBody>
        </Card>
        <div className="flex items-center justify-between mt-4">
          <span className="text-xs text-slate-400">{isDirty ? 'Unsaved changes' : ''}</span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => navigate(base)} disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Save {meta.singular}
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
