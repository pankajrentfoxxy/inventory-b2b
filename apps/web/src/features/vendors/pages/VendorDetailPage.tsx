import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Building2, ChevronDown, Globe, Mail, MapPin, Pencil, Phone, Power, Star, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, DescriptionList, DetailSkeleton, Dropdown, ErrorState, PageHeader, Tabs } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { usePermission } from '../../../lib/auth';
import { formatDate, formatDateTime, humanize } from '../../../lib/utils';
import { useDeleteVendor, useVendor, useVendorFormOptions, useVendorStatusMutation } from '../hooks';
import type { VendorAddress, VendorDetail } from '../types';
import { VendorStatusBadge } from '../components/VendorStatusBadge';
import { VendorActivity } from '../components/VendorActivity';
import { VendorNotes } from '../components/VendorNotes';
import { VendorDocuments } from '../components/VendorDocuments';
import { VendorTransactions } from '../components/VendorTransactions';
import { VendorContactsPanel } from '../components/VendorContactsPanel';
import { VendorBankPanel } from '../components/VendorBankPanel';

type DetailTab = 'overview' | 'transactions' | 'notes' | 'documents' | 'activity';

function AddressBlock({ address, title }: { address: VendorAddress | undefined; title: string }) {
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

function Overview({ vendor }: { vendor: VendorDetail }) {
  const options = useVendorFormOptions();
  const billing = vendor.addresses.filter((a) => a.type === 'BILLING');
  const shipping = vendor.addresses.filter((a) => a.type === 'SHIPPING');
  const primaryBilling = billing.find((a) => a.isPrimary) ?? billing[0];
  const primaryShipping = shipping.find((a) => a.isPrimary) ?? shipping[0];
  const extraAddresses = vendor.addresses.filter((a) => a !== primaryBilling && a !== primaryShipping);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2 space-y-4">
        <Card>
          <CardHeader title="Company Details" />
          <CardBody>
            <DescriptionList
              items={[
                { label: 'Company Name', value: vendor.companyName },
                { label: 'Display Name', value: vendor.displayName },
                { label: 'Vendor Type', value: vendor.vendorType ? humanize(vendor.vendorType) : null },
                { label: 'Currency', value: `${vendor.currency.code} - ${vendor.currency.name}` },
                { label: 'Payment Terms', value: vendor.paymentTerm ? (vendor.paymentTerm.days > 0 ? `${vendor.paymentTerm.name} (${vendor.paymentTerm.days} days)` : vendor.paymentTerm.name) : null },
                { label: 'Opening Balance', value: vendor.openingBalance === null ? null : new Intl.NumberFormat('en-IN', { style: 'currency', currency: vendor.currencyCode }).format(vendor.openingBalance), mono: true },
                { label: 'Language', value: options.data?.languages.find((l) => l.code === vendor.language)?.label ?? vendor.language },
                { label: 'Website', value: vendor.website ? <a href={vendor.website.startsWith('http') ? vendor.website : `https://${vendor.website}`} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline inline-flex items-center gap-1"><Globe className="w-3.5 h-3.5" />{vendor.website}</a> : null },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="GST Details" />
          <CardBody>
            <DescriptionList
              items={[
                { label: 'GST Treatment', value: vendor.gstTreatment?.name },
                { label: 'Source of Supply', value: vendor.sourceOfSupply ? `${vendor.sourceOfSupply.name} (${vendor.sourceOfSupply.code})` : null },
                { label: 'GSTIN', value: vendor.gstin, mono: true },
                { label: 'PAN', value: vendor.pan, mono: true },
                { label: 'MSME / Udyam', value: vendor.msmeRegistered ? vendor.msmeNumber ?? 'Registered' : 'Not registered' },
                { label: 'TDS', value: vendor.tdsApplicable ? `Applicable (${vendor.tdsSectionCode ?? 'section not set'})` : 'Not applicable' },
                { label: 'TCS', value: vendor.tcsApplicable ? 'Applicable' : 'Not applicable' },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Addresses" description={vendor.addresses.length > 2 ? `${vendor.addresses.length} addresses on file` : undefined} />
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
          <CardHeader title="Contact Persons" description={`${vendor.contacts.length} contact${vendor.contacts.length === 1 ? '' : 's'}`} />
          <CardBody>{options.data ? <VendorContactsPanel vendorId={vendor.id} contacts={vendor.contacts} options={options.data} /> : null}</CardBody>
        </Card>

        <Card>
          <CardHeader title="Bank Details" description="Account numbers are masked. Revealing a number is recorded in the activity log." />
          <CardBody>
            <VendorBankPanel vendorId={vendor.id} accounts={vendor.bankAccounts} />
          </CardBody>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader title="Primary Contact" />
          <CardBody className="space-y-2 text-sm">
            <p className="font-medium text-slate-900 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-slate-400" /> {vendor.primaryContact ?? <span className="text-slate-400 font-normal">Not provided</span>}
            </p>
            {vendor.email ? (
              <a href={`mailto:${vendor.email}`} className="flex items-center gap-2 text-slate-700 hover:text-brand-700 break-all">
                <Mail className="w-4 h-4 text-slate-400 shrink-0" /> {vendor.email}
              </a>
            ) : null}
            {vendor.workPhone && (
              <p className="flex items-center gap-2 text-slate-700 tabular">
                <Phone className="w-4 h-4 text-slate-400" /> {vendor.workPhoneCountryCode} {vendor.workPhone} <span className="text-xs text-slate-400">work</span>
              </p>
            )}
            {vendor.mobile && (
              <p className="flex items-center gap-2 text-slate-700 tabular">
                <Phone className="w-4 h-4 text-slate-400" /> {vendor.mobileCountryCode} {vendor.mobile} <span className="text-xs text-slate-400">mobile</span>
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
            {vendor.customFields.length === 0 ? (
              <p className="text-sm text-slate-400">No custom field values</p>
            ) : (
              <DescriptionList columns={1} items={vendor.customFields.map((cf) => ({ label: cf.label, value: cf.fieldType === 'BOOLEAN' ? (cf.value ? 'Yes' : 'No') : cf.fieldType === 'DATE' && typeof cf.value === 'string' ? formatDate(cf.value) : String(cf.value ?? '') }))} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Reporting Tags" />
          <CardBody>
            {vendor.reportingTags.length === 0 ? (
              <p className="text-sm text-slate-400">No tags</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {vendor.reportingTags.map((t) => (
                  <Badge key={t.tagId} tone="purple">
                    {t.tagName}: {t.optionName}
                  </Badge>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Remarks" />
          <CardBody>{vendor.remarks ? <p className="text-sm text-slate-800 whitespace-pre-wrap">{vendor.remarks}</p> : <p className="text-sm text-slate-400">No remarks</p>}</CardBody>
        </Card>

        <Card>
          <CardBody className="text-xs text-slate-500 space-y-1">
            <p>Created {formatDateTime(vendor.createdAt)}</p>
            <p>Last modified {formatDateTime(vendor.updatedAt)}</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export function VendorDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const perms = usePermission();
  const q = useVendor(id);
  const statusMutation = useVendorStatusMutation();
  const deleteMutation = useDeleteVendor();
  const [tab, setTab] = useState<DetailTab>('overview');
  const [confirmStatus, setConfirmStatus] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (q.isLoading) return <DetailSkeleton />;
  if (q.isError || !q.data) {
    const err = toApiError(q.error);
    return (
      <>
        <PageHeader title="Vendor" breadcrumbs={[{ label: 'Purchases' }, { label: 'Vendors', to: '/purchases/vendors' }]} />
        <Card>
          <ErrorState title={err.status === 404 ? 'Vendor not found' : 'Could not load vendor'} message={err.status === 404 ? 'It may have been deleted, or it belongs to another organization.' : err.message} onRetry={err.status === 404 ? undefined : () => void q.refetch()} />
        </Card>
      </>
    );
  }
  const vendor = q.data;
  const nextStatus = vendor.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

  const changeStatus = async () => {
    try {
      await statusMutation.mutateAsync({ id: vendor.id, status: nextStatus });
      toast.success(`Vendor marked as ${nextStatus.toLowerCase()}`);
    } catch (err) {
      toast.error(toApiError(err).message);
    } finally {
      setConfirmStatus(false);
    }
  };
  const doDelete = async () => {
    try {
      await deleteMutation.mutateAsync(vendor.id);
      toast.success(`${vendor.displayName} deleted`);
      navigate('/purchases/vendors', { replace: true });
    } catch (err) {
      toast.error(toApiError(err).message);
      setConfirmDelete(false);
    }
  };

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            {vendor.displayName}
            <VendorStatusBadge status={vendor.status} />
          </span>
        }
        subtitle={vendor.companyName && vendor.companyName !== vendor.displayName ? vendor.companyName : undefined}
        breadcrumbs={[{ label: 'Purchases' }, { label: 'Vendors', to: '/purchases/vendors' }, { label: vendor.displayName }]}
        actions={
          <>
            {perms.canEditVendor && (
              <Button variant="secondary" icon={Pencil} onClick={() => navigate(`/purchases/vendors/${vendor.id}/edit`)}>
                Edit
              </Button>
            )}
            {(perms.canChangeVendorStatus || perms.canDeleteVendor) && (
              <Dropdown
                trigger={({ toggle }) => (
                  <Button variant="secondary" iconRight={ChevronDown} onClick={toggle}>
                    More
                  </Button>
                )}
                items={[
                  { key: 'status', label: vendor.status === 'ACTIVE' ? 'Mark as inactive' : 'Mark as active', icon: Power, onSelect: () => setConfirmStatus(true), hidden: !perms.canChangeVendorStatus },
                  { key: 'delete', label: 'Delete', icon: Trash2, tone: 'danger', onSelect: () => setConfirmDelete(true), hidden: !perms.canDeleteVendor },
                ]}
              />
            )}
          </>
        }
      >
        {vendor.status === 'INACTIVE' && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">This vendor is inactive and cannot be selected in new purchase transactions.</div>
        )}
        <Tabs
          className="mt-3"
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'transactions', label: 'Transactions' },
            { key: 'notes', label: 'Notes', count: vendor.counts.notes },
            { key: 'documents', label: 'Documents', count: vendor.counts.documents },
            { key: 'activity', label: 'Activity' },
          ]}
        />
      </PageHeader>

      {tab === 'overview' && <Overview vendor={vendor} />}
      {tab === 'transactions' && (
        <Card>
          <CardHeader title="Transactions" description="Purchase orders, receives, bills, payments, credits and returns linked to this vendor." />
          <CardBody>
            <VendorTransactions vendorId={vendor.id} />
          </CardBody>
        </Card>
      )}
      {tab === 'notes' && (
        <Card>
          <CardHeader title="Notes" description="Internal remarks and follow-ups." />
          <CardBody>
            <VendorNotes vendorId={vendor.id} />
          </CardBody>
        </Card>
      )}
      {tab === 'documents' && (
        <Card>
          <CardHeader title="Documents" />
          <CardBody>
            <VendorDocuments vendorId={vendor.id} />
          </CardBody>
        </Card>
      )}
      {tab === 'activity' && (
        <Card>
          <CardHeader title="Activity" description="Every change to this vendor, who made it and when." />
          <CardBody>
            <VendorActivity vendorId={vendor.id} />
          </CardBody>
        </Card>
      )}

      <ConfirmDialog
        open={confirmStatus}
        onClose={() => setConfirmStatus(false)}
        onConfirm={() => void changeStatus()}
        loading={statusMutation.isPending}
        tone={nextStatus === 'INACTIVE' ? 'danger' : 'primary'}
        title={nextStatus === 'INACTIVE' ? 'Mark vendor as inactive?' : 'Mark vendor as active?'}
        confirmLabel={nextStatus === 'INACTIVE' ? 'Mark inactive' : 'Mark active'}
        message={nextStatus === 'INACTIVE' ? 'The vendor will no longer be selectable for new purchase transactions. Existing records are unaffected.' : 'The vendor will be available again for new purchase transactions.'}
      />
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={() => void doDelete()} loading={deleteMutation.isPending} title="Delete vendor?" confirmLabel="Delete" message={<><strong>{vendor.displayName}</strong> will be removed from all vendor lists. The record is archived and its history is preserved.</>} />
    </>
  );
}
