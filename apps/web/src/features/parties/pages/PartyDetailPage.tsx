import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Ban, Building2, ChevronDown, Globe, Mail, MapPin, Pencil, Phone, Power, ShieldCheck, Star, Trash2 } from 'lucide-react';
import { INDIAN_STATES, VENDOR_LANGUAGES, VENDOR_TYPE_LABELS, type VendorType } from '@b2b/shared';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, DescriptionList, DetailSkeleton, Dropdown, ErrorState, PageHeader, ReasonDialog, Tabs } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatDate, formatDateTime, formatMoney } from '../../../lib/utils';
import { useBlockParty, useDeleteParty, useParty, usePartyFormOptions, usePartyStatus, useUnblockParty } from '../hooks';
import { GST_TREATMENT_LABELS, PARTY_META, type PartyAddress, type PartyDetail, type PartyType } from '../types';
import { PartyStatusBadge } from '../components/PartyStatusBadge';
import { PartyActivity } from '../components/PartyActivity';
import { PartyTransactions } from '../components/PartyTransactions';
import { PartyContactsPanel } from '../components/PartyContactsPanel';
import { PartyBankPanel } from '../components/PartyBankPanel';
import { partyErrorMessage } from './PartyListPage';

type DetailTab = 'overview' | 'transactions' | 'activity';

function AddressBlock({ address, title }: { address: PartyAddress | undefined; title: string }) {
  if (!address) {
    return (
      <div>
        <p className="text-xs font-medium text-slate-500 mb-1">{title}</p>
        <p className="text-sm text-slate-400">Not provided</p>
      </div>
    );
  }
  const lines = [address.attention, address.addressLine1, address.addressLine2, [address.city, address.state, address.postalCode].filter(Boolean).join(', '), address.countryCode].filter(Boolean);
  return (
    <div>
      <p className="text-xs font-medium text-slate-500 mb-1 flex items-center gap-1">
        {title}
        {address.isPrimary && <Star className="w-3 h-3 text-amber-500 fill-amber-400" aria-label="Primary" />}
      </p>
      <address className="not-italic text-sm text-slate-800 leading-relaxed">
        {lines.map((l, i) => (
          <span key={i} className="block">
            {l}
          </span>
        ))}
        {address.phone && <span className="block text-slate-600 tabular">Phone: {address.phone}</span>}
      </address>
    </div>
  );
}

function Overview({ type, party }: { type: PartyType; party: PartyDetail }) {
  const isVendor = type === 'SUPPLIER';
  const options = usePartyFormOptions(type);
  const billing = party.addresses.filter((a) => a.type === 'BILLING');
  const shipping = party.addresses.filter((a) => a.type === 'SHIPPING');
  const primaryBilling = billing.find((a) => a.isPrimary) ?? billing[0];
  const primaryShipping = shipping.find((a) => a.isPrimary) ?? shipping[0];
  const extraAddresses = party.addresses.filter((a) => a !== primaryBilling && a !== primaryShipping);
  const currency = party.currencyCode ?? 'INR';
  const currencyInfo = options.data?.currencies.find((c) => c.code === currency);
  const term = party.paymentTermId ? options.data?.paymentTerms.find((p) => p.id === party.paymentTermId) : null;
  const source = INDIAN_STATES.find((s) => s.code === party.sourceOfSupply);
  const primaryContact = [party.salutation, party.firstName, party.lastName].filter(Boolean).join(' ');
  const fieldDefs = new Map((options.data?.customFields ?? []).map((f) => [f.id, f]));
  const customValues = party.customFields.filter((cf) => cf.value !== null && cf.value !== '' && fieldDefs.has(cf.fieldId));

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2 space-y-4">
        <Card>
          <CardHeader title="Company Details" />
          <CardBody>
            <DescriptionList
              items={[
                { label: 'Company Name', value: party.companyName },
                { label: 'Display Name', value: party.displayName },
                { label: `${PARTY_META[type].singular} Code`, value: party.code, mono: true },
                ...(isVendor ? [{ label: 'Vendor Type', value: party.vendorType ? VENDOR_TYPE_LABELS[party.vendorType as VendorType] ?? party.vendorType : null }] : []),
                { label: 'Currency', value: currencyInfo ? `${currencyInfo.code} - ${currencyInfo.name}` : currency },
                { label: 'Payment Terms', value: term ? (term.days > 0 ? `${term.name} (${term.days} days)` : term.name) : party.paymentTermId ? '...' : null },
                { label: 'Opening Balance', value: party.openingBalance === null ? null : formatMoney(party.openingBalance, currency), mono: true },
                { label: 'Language', value: VENDOR_LANGUAGES.find((l) => l.code === party.language)?.label ?? party.language },
                { label: 'Website', value: party.website ? <a href={party.website.startsWith('http') ? party.website : `https://${party.website}`} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline inline-flex items-center gap-1"><Globe className="w-3.5 h-3.5" />{party.website}</a> : null },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="GST Details" />
          <CardBody>
            <DescriptionList
              items={[
                { label: 'GST Treatment', value: GST_TREATMENT_LABELS[party.gstTreatment] ?? party.gstTreatment },
                { label: isVendor ? 'Source of Supply' : 'Place of Supply', value: source ? `${source.name} (${source.code})` : party.sourceOfSupply },
                { label: 'GSTIN', value: party.gstin, mono: true },
                { label: 'PAN', value: party.pan, mono: true },
                ...(isVendor
                  ? [
                      { label: 'MSME / Udyam', value: party.msmeRegistered ? party.msmeNumber ?? 'Registered' : 'Not registered' },
                      { label: 'TDS', value: party.tdsApplicable ? `Applicable (${party.tdsSectionCode ?? 'section not set'})` : 'Not applicable' },
                    ]
                  : []),
                { label: 'TCS', value: party.tcsApplicable ? 'Applicable' : 'Not applicable' },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Addresses" description={party.addresses.length > 2 ? `${party.addresses.length} addresses on file` : undefined} />
          <CardBody>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <AddressBlock address={primaryBilling} title="Billing Address" />
              <AddressBlock address={primaryShipping} title="Shipping Address" />
              {extraAddresses.map((a) => (
                <AddressBlock key={a.id} address={a} title={`Additional ${a.type === 'BILLING' ? 'billing' : 'shipping'} address`} />
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Contact Persons" description={`${party.contacts.length} contact${party.contacts.length === 1 ? '' : 's'}`} />
          <CardBody>
            {options.isError ? <ErrorState message={toApiError(options.error).message} onRetry={options.refetch} /> : options.data ? <PartyContactsPanel type={type} party={party} options={options.data} /> : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Bank Details" description="Account numbers are masked. Revealing a number is recorded in the audit trail." />
          <CardBody>
            <PartyBankPanel type={type} partyId={party.id} accounts={party.bankAccounts} />
          </CardBody>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader title="Primary Contact" />
          <CardBody className="space-y-2 text-sm">
            <p className="font-medium text-slate-900 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-slate-400" /> {primaryContact || <span className="text-slate-400 font-normal">Not provided</span>}
            </p>
            {party.email ? (
              <a href={`mailto:${party.email}`} className="flex items-center gap-2 text-slate-700 hover:text-brand-700 break-all">
                <Mail className="w-4 h-4 text-slate-400 shrink-0" /> {party.email}
              </a>
            ) : null}
            {party.workPhone && (
              <p className="flex items-center gap-2 text-slate-700 tabular">
                <Phone className="w-4 h-4 text-slate-400" /> {party.workPhoneCountryCode} {party.workPhone} <span className="text-xs text-slate-400">work</span>
              </p>
            )}
            {party.mobile && (
              <p className="flex items-center gap-2 text-slate-700 tabular">
                <Phone className="w-4 h-4 text-slate-400" /> {party.mobileCountryCode} {party.mobile} <span className="text-xs text-slate-400">mobile</span>
              </p>
            )}
            {primaryBilling?.city && (
              <p className="flex items-center gap-2 text-slate-700">
                <MapPin className="w-4 h-4 text-slate-400" /> {[primaryBilling.city, primaryBilling.state].filter(Boolean).join(', ')}
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Custom Fields" />
          <CardBody>
            {customValues.length === 0 ? (
              <p className="text-sm text-slate-400">No custom field values</p>
            ) : (
              <DescriptionList
                columns={1}
                items={customValues.map((cf) => {
                  const def = fieldDefs.get(cf.fieldId)!;
                  return { label: def.label, value: def.fieldType === 'BOOLEAN' ? (cf.value ? 'Yes' : 'No') : def.fieldType === 'DATE' && typeof cf.value === 'string' ? formatDate(cf.value) : String(cf.value ?? '') };
                })}
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Remarks" />
          <CardBody>{party.remarks ? <p className="text-sm text-slate-800 whitespace-pre-wrap">{party.remarks}</p> : <p className="text-sm text-slate-400">No remarks</p>}</CardBody>
        </Card>

        {party.referencedBy && party.referencedBy.length > 0 && (
          <Card>
            <CardHeader title="Referenced By" description={`Services holding documents for this ${PARTY_META[type].singular.toLowerCase()}. Referenced records cannot be deleted.`} />
            <CardBody>
              <div className="flex flex-wrap gap-1.5">
                {party.referencedBy.map((r) => (
                  <Badge key={r} tone="blue">
                    {r}
                  </Badge>
                ))}
              </div>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardBody className="text-xs text-slate-500 space-y-1">
            <p>Created {formatDateTime(party.createdAt)}</p>
            <p>Last modified {formatDateTime(party.updatedAt)}</p>
            <p>Version {party.version}</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export function PartyDetailPage({ type }: { type: PartyType }) {
  const meta = PARTY_META[type];
  const noun = meta.singular.toLowerCase();
  const base = `/parties/${meta.route}`;
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canManage = hasPermission(meta.manage);
  const q = useParty(type, id);
  const statusMutation = usePartyStatus(type);
  const blockMutation = useBlockParty(type);
  const unblockMutation = useUnblockParty(type);
  const deleteMutation = useDeleteParty(type);
  const [tab, setTab] = useState<DetailTab>('overview');
  const [confirmStatus, setConfirmStatus] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [blockDialog, setBlockDialog] = useState(false);

  if (q.isLoading) return <DetailSkeleton />;
  if (q.isError || !q.data) {
    const err = toApiError(q.error);
    return (
      <>
        <PageHeader title={meta.singular} breadcrumbs={[{ label: 'Parties' }, { label: meta.plural, to: base }]} />
        <Card>
          <ErrorState title={err.status === 404 ? `${meta.singular} not found` : `Could not load ${noun}`} message={err.status === 404 ? 'It may have been deleted, or it belongs to another organization.' : err.message} onRetry={err.status === 404 ? undefined : () => void q.refetch()} />
        </Card>
      </>
    );
  }
  const party = q.data;
  const blocked = party.status === 'BLOCKED';
  const nextStatus = party.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

  const changeStatus = async () => {
    try {
      await statusMutation.mutateAsync({ id: party.id, status: nextStatus });
      toast.success(`${meta.singular} marked as ${nextStatus.toLowerCase()}`);
    } catch (err) {
      toast.error(toApiError(err).message);
    } finally {
      setConfirmStatus(false);
    }
  };
  const changeBlock = async (reason: string) => {
    try {
      if (blocked) await unblockMutation.mutateAsync({ id: party.id, reason });
      else await blockMutation.mutateAsync({ id: party.id, reason });
      toast.success(`${party.displayName} ${blocked ? 'unblocked' : 'blocked'}`);
      setBlockDialog(false);
    } catch (err) {
      toast.error(toApiError(err).message);
    }
  };
  const doDelete = async () => {
    try {
      await deleteMutation.mutateAsync(party.id);
      toast.success(`${party.displayName} deleted`);
      navigate(base, { replace: true });
    } catch (err) {
      toast.error(partyErrorMessage(toApiError(err)));
      setConfirmDelete(false);
    }
  };

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            {party.displayName}
            <PartyStatusBadge status={party.status} />
          </span>
        }
        subtitle={party.companyName && party.companyName !== party.displayName ? party.companyName : undefined}
        breadcrumbs={[{ label: 'Parties' }, { label: meta.plural, to: base }, { label: party.displayName }]}
        actions={
          canManage ? (
            <>
              <Button variant="secondary" icon={Pencil} onClick={() => navigate(`${base}/${party.id}/edit`)}>
                Edit
              </Button>
              <Dropdown
                trigger={({ toggle }) => (
                  <Button variant="secondary" iconRight={ChevronDown} onClick={toggle}>
                    More
                  </Button>
                )}
                items={[
                  { key: 'status', label: party.status === 'ACTIVE' ? 'Mark as inactive' : 'Mark as active', icon: Power, onSelect: () => setConfirmStatus(true), hidden: blocked },
                  { key: 'block', label: blocked ? 'Unblock' : 'Block', icon: blocked ? ShieldCheck : Ban, onSelect: () => setBlockDialog(true) },
                  { key: 'delete', label: 'Delete', icon: Trash2, tone: 'danger', onSelect: () => setConfirmDelete(true) },
                ]}
              />
            </>
          ) : undefined
        }
      >
        {party.status === 'INACTIVE' && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">This {noun} is inactive and cannot be selected in new transactions.</div>}
        {blocked && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <strong>Blocked:</strong> {party.blockedReason ?? 'No reason recorded'}. New documents cannot be raised for this {noun} until it is unblocked.
          </div>
        )}
        <Tabs
          className="mt-3"
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'transactions', label: 'Transactions' },
            { key: 'activity', label: 'Activity' },
          ]}
        />
      </PageHeader>

      {tab === 'overview' && <Overview type={type} party={party} />}
      {tab === 'transactions' && (
        <Card>
          <CardHeader title="Transactions" description={type === 'SUPPLIER' ? 'Purchase orders, receives, bills and payments linked to this vendor.' : 'Sales orders, invoices and payments linked to this customer.'} />
          <CardBody>
            <PartyTransactions type={type} party={party} />
          </CardBody>
        </Card>
      )}
      {tab === 'activity' && (
        <Card>
          <CardHeader title="Activity" description={`Every change to this ${noun}, who made it and when.`} />
          <CardBody>
            <PartyActivity partyId={party.id} />
          </CardBody>
        </Card>
      )}

      <ConfirmDialog
        open={confirmStatus}
        onClose={() => setConfirmStatus(false)}
        onConfirm={() => void changeStatus()}
        loading={statusMutation.isPending}
        tone={nextStatus === 'INACTIVE' ? 'danger' : 'primary'}
        title={nextStatus === 'INACTIVE' ? `Mark ${noun} as inactive?` : `Mark ${noun} as active?`}
        confirmLabel={nextStatus === 'INACTIVE' ? 'Mark inactive' : 'Mark active'}
        message={nextStatus === 'INACTIVE' ? `The ${noun} will no longer be selectable for new transactions. Existing records are unaffected.` : `The ${noun} will be available again for new transactions.`}
      />
      <ReasonDialog
        open={blockDialog}
        onClose={() => setBlockDialog(false)}
        onConfirm={({ reason }) => void changeBlock(reason)}
        loading={blockMutation.isPending || unblockMutation.isPending}
        tone={blocked ? 'primary' : 'danger'}
        title={blocked ? `Unblock ${noun}?` : `Block ${noun}?`}
        confirmLabel={blocked ? 'Unblock' : 'Block'}
        message={
          blocked ? (
            <>
              <strong>{party.displayName}</strong> becomes active again and can be used on new documents.
            </>
          ) : (
            <>
              No new documents can be raised for <strong>{party.displayName}</strong> while blocked. Existing documents are unaffected.
            </>
          )
        }
      />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void doDelete()}
        loading={deleteMutation.isPending}
        title={`Delete ${noun}?`}
        confirmLabel="Delete"
        message={
          <>
            <strong>{party.displayName}</strong> will be removed from all {noun} lists. Only {meta.plural.toLowerCase()} without any document can be deleted; otherwise mark it inactive or block it.
          </>
        }
      />
    </>
  );
}
