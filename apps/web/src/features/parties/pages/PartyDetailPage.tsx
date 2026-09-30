import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Ban, ChevronDown, Globe, Mail, MapPin, Pencil, Phone, Plus, Power, ShieldCheck, Star, Trash2, UserRound } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, DescriptionList, DetailSkeleton, Dropdown, EmptyState, ErrorState, IconButton, PageHeader, ReasonDialog, StatusBadge, Tabs } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatDateTime, formatMoney } from '../../../lib/utils';
import { useSimpleMaster } from '../../master/hooks';
import { useBlockParty, useDeleteParty, useParty, usePartyStatus, useRemoveAddress, useRemoveBankAccount, useRemoveContact, useUnblockParty } from '../hooks';
import { GST_TREATMENT_LABELS, PARTY_META, type PartyAddress, type PartyBankAccount, type PartyContact, type PartyDetail, type PartyType } from '../types';
import { stateName } from '../components/partyForm.model';
import { PartyBankPanel } from '../components/PartyBankPanel';
import { PartyEditModal } from '../components/PartyEditModal';
import { AddressFormModal, BankAccountFormModal, ContactFormModal } from '../components/SubResourceModals';

type Tab = 'overview' | 'addresses' | 'contacts' | 'bank' | 'activity';

function AddressBlock({ address, canManage, onRemove }: { address: PartyAddress; canManage: boolean; onRemove: () => void }) {
  const lines = [address.attention, address.line1, address.line2, [address.city, address.state ?? stateName(address.stateCode), address.pincode].filter(Boolean).join(', '), address.country !== 'IN' ? address.country : null].filter(Boolean);
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Badge tone={address.kind === 'SHIPPING' ? 'purple' : 'blue'}>{address.kind === 'SHIPPING' ? 'Shipping' : 'Billing'}</Badge>
        {address.isDefault && <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400" aria-label="Default" />}
        <span className="text-xs text-slate-500 font-mono ml-auto">State {address.stateCode}</span>
        {canManage && <IconButton icon={Trash2} label="Remove address" size="sm" onClick={onRemove} />}
      </div>
      <address className="not-italic text-sm text-slate-800 leading-relaxed">
        {lines.map((l, i) => (
          <span key={i} className="block">{l}</span>
        ))}
        {address.phone && <span className="block text-slate-600 tabular">Phone: {address.phone}</span>}
      </address>
    </div>
  );
}

function Overview({ party }: { party: PartyDetail }) {
  const paymentTerms = useSimpleMaster('payment-terms', true);
  const term = party.paymentTermId ? paymentTerms.data?.find((t) => t.id === party.paymentTermId) : null;
  const primary = party.contacts.find((c) => c.isPrimary) ?? party.contacts[0];
  const billing = party.billingAddress;
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2 space-y-4">
        <Card>
          <CardHeader title="Business details" />
          <CardBody>
            <DescriptionList
              items={[
                { label: 'Legal name', value: party.legalName },
                { label: 'Display name', value: party.displayName },
                { label: 'Code', value: party.code, mono: true },
                { label: 'Payment terms', value: term ? `${term.name} (${term.days} days)` : party.paymentTermId ? '...' : null },
                { label: 'Credit limit', value: party.creditLimit === null ? null : formatMoney(party.creditLimit), mono: true },
                { label: 'Credit days', value: party.creditDays === null ? null : String(party.creditDays) },
                { label: 'Website', value: party.website ? <a href={party.website.startsWith('http') ? party.website : `https://${party.website}`} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline inline-flex items-center gap-1"><Globe className="w-3.5 h-3.5" />{party.website}</a> : null },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="GST details" />
          <CardBody>
            <DescriptionList
              items={[
                { label: 'GST treatment', value: GST_TREATMENT_LABELS[party.gstTreatment] },
                { label: 'GSTIN', value: party.gstin, mono: true },
                { label: 'PAN', value: party.pan, mono: true },
                { label: 'Place of supply', value: party.stateCode ? `${stateName(party.stateCode) ?? ''} (${party.stateCode})`.trim() : null },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Remarks" />
          <CardBody>{party.remarks ? <p className="text-sm text-slate-800 whitespace-pre-wrap">{party.remarks}</p> : <p className="text-sm text-slate-400">No remarks</p>}</CardBody>
        </Card>
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader title="Primary contact" />
          <CardBody className="space-y-2 text-sm">
            <p className="font-medium text-slate-900 flex items-center gap-2">
              <UserRound className="w-4 h-4 text-slate-400" /> {primary ? `${primary.name}${primary.designation ? ` - ${primary.designation}` : ''}` : <span className="text-slate-400 font-normal">No contact person</span>}
            </p>
            {(primary?.email ?? party.email) && (
              <a href={`mailto:${primary?.email ?? party.email}`} className="flex items-center gap-2 text-slate-700 hover:text-brand-700 break-all">
                <Mail className="w-4 h-4 text-slate-400 shrink-0" /> {primary?.email ?? party.email}
              </a>
            )}
            {(primary?.phone ?? party.phone) && (
              <p className="flex items-center gap-2 text-slate-700 tabular">
                <Phone className="w-4 h-4 text-slate-400" /> {primary?.phone ?? party.phone}
              </p>
            )}
            {billing && (
              <p className="flex items-center gap-2 text-slate-700">
                <MapPin className="w-4 h-4 text-slate-400" /> {[billing.city, billing.state ?? stateName(billing.stateCode)].filter(Boolean).join(', ')}
              </p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Referenced by" description="Services holding documents for this party. Referenced parties cannot be deleted." />
          <CardBody>
            {party.referencedBy.length === 0 ? <p className="text-sm text-slate-400">No documents yet</p> : <div className="flex flex-wrap gap-1.5">{party.referencedBy.map((r) => <Badge key={r} tone="blue">{r}</Badge>)}</div>}
          </CardBody>
        </Card>
        <Card>
          <CardBody className="text-xs text-slate-500 space-y-1">
            <p>Version {party.version}</p>
            <p>Created {formatDateTime(party.createdAt)}</p>
            <p>Last modified {formatDateTime(party.updatedAt)}</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export function PartyDetailPage({ type }: { type: PartyType }) {
  const meta = PARTY_META[type];
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canManage = hasPermission(meta.manage);
  const base = `/parties/${meta.path}`;
  const q = useParty(type, id);
  const status = usePartyStatus(type);
  const block = useBlockParty(type);
  const unblock = useUnblockParty(type);
  const del = useDeleteParty(type);
  const removeAddress = useRemoveAddress(type, id);
  const removeContact = useRemoveContact(type, id);
  const removeBank = useRemoveBankAccount(type, id);

  const [tab, setTab] = useState<Tab>('overview');
  const [editOpen, setEditOpen] = useState(false);
  const [dialog, setDialog] = useState<'block' | 'unblock' | 'status' | 'delete' | null>(null);
  const [addModal, setAddModal] = useState<'address' | 'contact' | 'bank' | null>(null);
  const [pendingRemove, setPendingRemove] = useState<{ kind: 'address'; row: PartyAddress } | { kind: 'contact'; row: PartyContact } | { kind: 'bank'; row: PartyBankAccount } | null>(null);

  if (q.isLoading) return <DetailSkeleton />;
  if (q.isError || !q.data) {
    const err = toApiError(q.error);
    return (
      <>
        <PageHeader title={meta.singular} breadcrumbs={[{ label: 'Parties' }, { label: meta.plural, to: base }]} />
        <Card>
          <ErrorState title={err.status === 404 ? `${meta.singular} not found` : `Could not load ${meta.singular.toLowerCase()}`} message={err.status === 404 ? 'It may have been deleted, or it belongs to another organisation.' : err.message} onRetry={err.status === 404 ? undefined : () => void q.refetch()} />
        </Card>
      </>
    );
  }
  const party = q.data;
  const nextStatus = party.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

  const run = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn();
      toast.success(success);
      setDialog(null);
      setPendingRemove(null);
    } catch (err) {
      const e = toApiError(err);
      toast.error(e.code === 'MASTER_IN_USE' ? `${e.message}${e.details.length ? ` (${e.details.map((d) => d.message).join(', ')})` : ''}` : e.message);
      if (dialog === 'delete') setDialog(null);
    }
  };
  const doDelete = async () => {
    try {
      await del.mutateAsync(party.id);
      toast.success(`${party.displayName} deleted`);
      navigate(base, { replace: true });
    } catch (err) {
      const e = toApiError(err);
      toast.error(e.code === 'MASTER_IN_USE' ? `${e.message}${e.details.length ? ` (${e.details.map((d) => d.message).join(', ')})` : ''}` : e.message);
      setDialog(null);
    }
  };

  const removeLabel = pendingRemove?.kind === 'address' ? `${pendingRemove.row.kind === 'BILLING' ? 'billing' : 'shipping'} address in ${pendingRemove.row.city}` : pendingRemove?.kind === 'contact' ? `contact ${pendingRemove.row.name}` : pendingRemove?.kind === 'bank' ? `${pendingRemove.row.bankName} account ${pendingRemove.row.accountNumber}` : '';
  const confirmRemove = () => {
    if (!pendingRemove) return;
    if (pendingRemove.kind === 'address') return void run(() => removeAddress.mutateAsync(pendingRemove.row.id), 'Address removed');
    if (pendingRemove.kind === 'contact') return void run(() => removeContact.mutateAsync(pendingRemove.row.id), 'Contact removed');
    return void run(() => removeBank.mutateAsync(pendingRemove.row.id), 'Bank account removed');
  };

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            {party.displayName}
            <StatusBadge status={party.status} />
          </span>
        }
        subtitle={<span className="inline-flex items-center gap-2"><span className="font-mono">{party.code}</span>{party.legalName !== party.displayName && <span>{party.legalName}</span>}</span>}
        breadcrumbs={[{ label: 'Parties' }, { label: meta.plural, to: base }, { label: party.displayName }]}
        actions={
          canManage ? (
            <>
              <Button variant="secondary" icon={Pencil} onClick={() => setEditOpen(true)}>
                Edit
              </Button>
              {party.status === 'BLOCKED' ? (
                <Button icon={ShieldCheck} onClick={() => setDialog('unblock')}>
                  Unblock
                </Button>
              ) : (
                <Button variant="dangerOutline" icon={Ban} onClick={() => setDialog('block')}>
                  Block
                </Button>
              )}
              <Dropdown
                trigger={({ toggle }) => <Button variant="secondary" iconRight={ChevronDown} onClick={toggle}>More</Button>}
                items={[
                  { key: 'status', label: party.status === 'ACTIVE' ? 'Mark as inactive' : 'Mark as active', icon: Power, onSelect: () => setDialog('status'), hidden: party.status === 'BLOCKED' },
                  { key: 'delete', label: 'Delete', icon: Trash2, tone: 'danger', onSelect: () => setDialog('delete') },
                ]}
              />
            </>
          ) : undefined
        }
      >
        {party.status === 'BLOCKED' && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <strong>Blocked:</strong> {party.blockedReason ?? 'No reason recorded'}. New documents cannot be raised for this {meta.singular.toLowerCase()} until it is unblocked.
          </div>
        )}
        {party.status === 'INACTIVE' && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">This {meta.singular.toLowerCase()} is inactive and hidden from pickers.</div>}
        <Tabs
          className="mt-3"
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'addresses', label: 'Addresses', count: party.addresses.length },
            { key: 'contacts', label: 'Contacts', count: party.contacts.length },
            { key: 'bank', label: 'Bank accounts', count: party.bankAccounts.length },
            { key: 'activity', label: 'Activity' },
          ]}
        />
      </PageHeader>

      {tab === 'overview' && <Overview party={party} />}

      {tab === 'addresses' && (
        <Card>
          <CardHeader title="Addresses" description="One default billing and one default shipping address. Removing a default promotes the next address of that kind." actions={canManage ? <Button size="sm" icon={Plus} onClick={() => setAddModal('address')}>Add address</Button> : undefined} />
          <CardBody>
            {party.addresses.length === 0 ? (
              <EmptyState icon={MapPin} title="No addresses" hint="Add a billing address so GST and place of supply can be validated." className="py-8" action={canManage ? <Button size="sm" variant="secondary" onClick={() => setAddModal('address')}>Add address</Button> : undefined} />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {party.addresses.map((a) => (
                  <AddressBlock key={a.id} address={a} canManage={canManage} onRemove={() => setPendingRemove({ kind: 'address', row: a })} />
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {tab === 'contacts' && (
        <Card>
          <CardHeader title="Contact persons" actions={canManage ? <Button size="sm" icon={Plus} onClick={() => setAddModal('contact')}>Add contact</Button> : undefined} />
          <CardBody>
            {party.contacts.length === 0 ? (
              <EmptyState icon={UserRound} title="No contact persons" className="py-8" action={canManage ? <Button size="sm" variant="secondary" onClick={() => setAddModal('contact')}>Add contact</Button> : undefined} />
            ) : (
              <ul className="divide-y divide-slate-100">
                {party.contacts.map((c) => (
                  <li key={c.id} className="py-3 flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900 inline-flex items-center gap-2">
                        {c.name}
                        {c.isPrimary && <Badge tone="blue"><Star className="w-3 h-3" /> Primary</Badge>}
                        {c.designation && <span className="text-xs text-slate-500 font-normal">{c.designation}</span>}
                      </p>
                      <p className="text-sm text-slate-600 flex flex-wrap gap-x-4 mt-0.5">
                        {c.email && <a href={`mailto:${c.email}`} className="hover:text-brand-700 inline-flex items-center gap-1"><Mail className="w-3.5 h-3.5 text-slate-400" />{c.email}</a>}
                        {c.phone && <span className="inline-flex items-center gap-1 tabular"><Phone className="w-3.5 h-3.5 text-slate-400" />{c.phone}</span>}
                      </p>
                    </div>
                    {canManage && <IconButton icon={Trash2} label="Remove contact" size="sm" onClick={() => setPendingRemove({ kind: 'contact', row: c })} />}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {tab === 'bank' && (
        <Card>
          <CardHeader title="Bank accounts" description="Account numbers are masked. Revealing a number is recorded in the audit trail and re-masked after 30 seconds." actions={canManage ? <Button size="sm" icon={Plus} onClick={() => setAddModal('bank')}>Add bank account</Button> : undefined} />
          <CardBody>
            <PartyBankPanel type={type} partyId={party.id} accounts={party.bankAccounts} canManage={canManage} onAdd={() => setAddModal('bank')} onRemove={(a) => setPendingRemove({ kind: 'bank', row: a })} />
          </CardBody>
        </Card>
      )}

      {tab === 'activity' && (
        <Card>
          <CardHeader title="Activity" description="Every write is audited through the outbox. The full trail (who changed what and when) is in Settings > Audit Trail." />
          <CardBody>
            <DescriptionList
              columns={3}
              items={[
                { label: 'Current version', value: String(party.version) },
                { label: 'Created', value: formatDateTime(party.createdAt) },
                { label: 'Last modified', value: formatDateTime(party.updatedAt) },
                { label: 'Status', value: <StatusBadge status={party.status} /> },
                { label: 'Blocked reason', value: party.blockedReason },
                { label: 'Referenced by', value: party.referencedBy.length ? <div className="flex flex-wrap gap-1.5">{party.referencedBy.map((r) => <Badge key={r} tone="blue">{r}</Badge>)}</div> : null },
              ]}
            />
            {hasPermission('audit.view') && (
              <div className="mt-4">
                <Button variant="secondary" size="sm" onClick={() => navigate(`/settings/audit?entityId=${party.id}`)}>
                  Open audit trail
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {canManage && <PartyEditModal open={editOpen} onClose={() => setEditOpen(false)} type={type} party={party} />}
      <AddressFormModal open={addModal === 'address'} onClose={() => setAddModal(null)} type={type} partyId={party.id} firstOfKind={!party.addresses.some((a) => a.kind === 'BILLING')} />
      <ContactFormModal open={addModal === 'contact'} onClose={() => setAddModal(null)} type={type} partyId={party.id} first={party.contacts.length === 0} />
      <BankAccountFormModal open={addModal === 'bank'} onClose={() => setAddModal(null)} type={type} partyId={party.id} first={party.bankAccounts.length === 0} />

      <ReasonDialog
        open={dialog === 'block'}
        onClose={() => setDialog(null)}
        onConfirm={({ reason }) => void run(() => block.mutateAsync({ id: party.id, reason }), `${party.displayName} blocked`)}
        title={`Block ${meta.singular.toLowerCase()}?`}
        message={<>No new documents can be raised for <strong>{party.displayName}</strong> while blocked. Existing documents are unaffected.</>}
        confirmLabel="Block"
        loading={block.isPending}
      />
      <ReasonDialog
        open={dialog === 'unblock'}
        onClose={() => setDialog(null)}
        onConfirm={({ reason }) => void run(() => unblock.mutateAsync({ id: party.id, reason }), `${party.displayName} unblocked`)}
        title={`Unblock ${meta.singular.toLowerCase()}?`}
        message={<><strong>{party.displayName}</strong> becomes active again and can be used on new documents.</>}
        confirmLabel="Unblock"
        tone="primary"
        loading={unblock.isPending}
      />
      <ConfirmDialog
        open={dialog === 'status'}
        onClose={() => setDialog(null)}
        onConfirm={() => void run(() => status.mutateAsync({ id: party.id, status: nextStatus }), `${party.displayName} marked as ${nextStatus.toLowerCase()}`)}
        loading={status.isPending}
        tone={nextStatus === 'INACTIVE' ? 'danger' : 'primary'}
        title={nextStatus === 'INACTIVE' ? `Mark ${meta.singular.toLowerCase()} as inactive?` : `Mark ${meta.singular.toLowerCase()} as active?`}
        confirmLabel={nextStatus === 'INACTIVE' ? 'Mark inactive' : 'Mark active'}
        message={nextStatus === 'INACTIVE' ? 'It will no longer appear in pickers for new documents. Existing records are unaffected.' : 'It will be available again for new documents.'}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        onClose={() => setDialog(null)}
        onConfirm={() => void doDelete()}
        loading={del.isPending}
        title={`Delete ${meta.singular.toLowerCase()}?`}
        confirmLabel="Delete"
        message={<><strong>{party.displayName}</strong> will be permanently removed. Only parties without any document can be deleted; otherwise deactivate or block it.</>}
      />
      <ConfirmDialog
        open={pendingRemove !== null}
        onClose={() => setPendingRemove(null)}
        onConfirm={confirmRemove}
        loading={removeAddress.isPending || removeContact.isPending || removeBank.isPending}
        title={`Remove ${pendingRemove?.kind === 'bank' ? 'bank account' : pendingRemove?.kind ?? ''}?`}
        confirmLabel="Remove"
        message={<>The {removeLabel} will be removed from <strong>{party.displayName}</strong>.</>}
      />
    </>
  );
}
