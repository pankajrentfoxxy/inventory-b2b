import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import toast from 'react-hot-toast';
import { Mail, Pencil, Phone, Plus, Star, Trash2, Users } from 'lucide-react';
import { vendorContactSchema } from '@b2b/shared';
import { Badge, Button, Checkbox, ConfirmDialog, EmptyState, Field, IconButton, Input, Modal, Select } from '../../../components/ui';
import { toApiError, type ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { applyServerErrors, summarizeErrors } from '../../../lib/validation';
import { useParty, useUpdateParty } from '../hooks';
import { PARTY_META, type PartyContact, type PartyDetail, type PartyFormOptions, type PartyType } from '../types';
import { detailToPayload, emptyContact, partyToFormValues, type ContactFormValues } from '../form/partyForm.model';

type ContactForm = Omit<ContactFormValues, 'id'>;
/** error: API error to show on the modal (paths rewritten to `contact.<field>`); null when saved or already handled. */
type SaveResult = { error: ApiError | null; saved: boolean };

const blank: ContactForm = { ...emptyContact(false) };

function ContactModal({ open, onClose, initial, onSave, saving, options, noun }: { open: boolean; onClose: () => void; initial: ContactForm; onSave: (v: ContactForm) => Promise<SaveResult>; saving: boolean; options: PartyFormOptions; noun: string }) {
  const form = useForm<ContactForm>({ defaultValues: initial, values: initial, resolver: zodResolver(vendorContactSchema) as never });
  const { register, handleSubmit, formState: { errors }, setError } = form;
  const submit = handleSubmit(async (values) => {
    const { error: e } = await onSave(values);
    if (e) toast.error(summarizeErrors(applyServerErrors(setError, e, { mapPath: (p) => (p.startsWith('contact.') ? p.slice('contact.'.length) : null) }), e.message));
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial.firstName ? 'Edit Contact Person' : 'Add Contact Person'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void submit()} loading={saving}>Save</Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="grid grid-cols-1 sm:grid-cols-2 gap-3" noValidate>
        <Field label="Name" required className="sm:col-span-2" error={errors.firstName?.message ?? errors.lastName?.message}>
          <div className="grid grid-cols-[100px_1fr_1fr] gap-2">
            <Select aria-label="Salutation" placeholder="Title" options={options.salutations.map((s) => ({ value: s, label: s }))} {...register('salutation')} />
            <Input placeholder="First name" sanitize="name" maxLength={100} error={Boolean(errors.firstName)} {...register('firstName')} autoFocus />
            <Input placeholder="Last name" sanitize="name" maxLength={100} error={Boolean(errors.lastName)} {...register('lastName')} />
          </div>
        </Field>
        <Field label="Email" error={errors.email?.message}><Input type="email" sanitize="email" maxLength={254} error={Boolean(errors.email)} {...register('email')} /></Field>
        <Field label="Work Phone" error={errors.workPhone?.message}><Input sanitize="phone" maxLength={20} error={Boolean(errors.workPhone)} {...register('workPhone')} /></Field>
        <Field label="Mobile" error={errors.mobile?.message}><Input sanitize="mobile" placeholder="10-digit mobile" error={Boolean(errors.mobile)} {...register('mobile')} /></Field>
        <Field label="Designation" error={errors.designation?.message}><Input {...register('designation')} /></Field>
        <Field label="Department" error={errors.department?.message}><Input {...register('department')} /></Field>
        <div className="sm:col-span-2 pt-1">
          <Checkbox label="Primary contact person" description={`The default person for communication with this ${noun}. Only one contact can be primary.`} {...register('isPrimary')} />
        </div>
      </form>
    </Modal>
  );
}

/**
 * Contact persons on the detail page. The platform saves a party as one document, so add / edit /
 * remove send the full record (PUT .../form with If-Match) with the contact list changed.
 */
export function PartyContactsPanel({ type, party, options }: { type: PartyType; party: PartyDetail; options: PartyFormOptions }) {
  const meta = PARTY_META[type];
  const noun = meta.singular.toLowerCase();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission(meta.manage);
  const update = useUpdateParty(type, party.id);
  const detail = useParty(type, party.id);
  const [editing, setEditing] = useState<{ id: string | null; values: ContactForm } | null>(null);
  const [removing, setRemoving] = useState<PartyContact | null>(null);
  const contacts = party.contacts;

  /** Saves the changed contact list with the rest of the record unchanged. */
  const saveContacts = async (next: ContactFormValues[], editedIndex: number | null): Promise<SaveResult> => {
    try {
      const payload = detailToPayload(party, options, { contacts: next });
      await update.mutateAsync({ payload, version: party.version });
      return { error: null, saved: true };
    } catch (err) {
      const e = toApiError(err);
      if (e.status === 409) {
        toast.error(`This ${noun} was changed by someone else. The latest version has been loaded; try again.`);
        void detail.refetch();
        setEditing(null);
        setRemoving(null);
        return { error: null, saved: false };
      }
      const prefix = editedIndex === null ? null : `contacts.${editedIndex}.`;
      return { error: { ...e, details: e.details.map((d) => (prefix && d.path?.startsWith(prefix) ? { ...d, path: `contact.${d.path.slice(prefix.length)}` } : { ...d, path: '' })) }, saved: false };
    }
  };

  const current = () => partyToFormValues(party, options).contacts;

  const openEdit = (c: PartyContact) =>
    setEditing({
      id: c.id,
      values: { salutation: c.salutation ?? '', firstName: c.firstName, lastName: c.lastName ?? '', email: c.email ?? '', workPhone: c.workPhone ?? '', mobile: c.mobile ?? '', designation: c.designation ?? '', department: c.department ?? '', isPrimary: c.isPrimary },
    });

  const save = async (v: ContactForm): Promise<SaveResult> => {
    const list = current();
    const idx = editing?.id ? list.findIndex((c) => c.id === editing.id) : list.length;
    const row: ContactFormValues = { ...v, id: editing?.id ?? null };
    let next = idx < list.length ? list.map((c, i) => (i === idx ? row : c)) : [...list, row];
    if (row.isPrimary) next = next.map((c, i) => ({ ...c, isPrimary: i === idx }));
    else if (!next.some((c) => c.isPrimary)) next = next.map((c, i) => ({ ...c, isPrimary: i === 0 }));
    const result = await saveContacts(next, idx);
    if (result.saved) {
      toast.success(editing?.id ? 'Contact updated' : 'Contact added');
      setEditing(null);
    }
    return result;
  };

  const confirmRemove = async () => {
    if (!removing) return;
    let next = current().filter((c) => c.id !== removing.id);
    if (removing.isPrimary && next.length) next = next.map((c, i) => ({ ...c, isPrimary: i === 0 }));
    const { error: e, saved } = await saveContacts(next, null);
    if (e) toast.error(summarizeErrors(e.details.map((d) => d.message), e.message));
    else if (saved) toast.success('Contact removed');
    setRemoving(null);
  };

  return (
    <div className="space-y-3">
      {contacts.length === 0 ? (
        <EmptyState icon={Users} title="No contact persons" hint={`Add the people you deal with at this ${noun}.`} className="py-8" action={canEdit ? <Button size="sm" variant="secondary" icon={Plus} onClick={() => setEditing({ id: null, values: { ...blank, isPrimary: true } })}>Add Contact Person</Button> : undefined} />
      ) : (
        <>
          <ul className="divide-y divide-slate-100">
            {contacts.map((c) => (
              <li key={c.id} className="py-3 flex gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-slate-900">{[c.salutation, c.firstName, c.lastName].filter(Boolean).join(' ')}</span>
                    {c.isPrimary && (
                      <Badge tone="blue">
                        <Star className="w-3 h-3" /> Primary
                      </Badge>
                    )}
                    {(c.designation || c.department) && <span className="text-xs text-slate-500">{[c.designation, c.department].filter(Boolean).join(' - ')}</span>}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-600 mt-1">
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:text-brand-700">
                        <Mail className="w-3 h-3" /> {c.email}
                      </a>
                    )}
                    {c.mobile && (
                      <span className="inline-flex items-center gap-1 tabular">
                        <Phone className="w-3 h-3" /> {c.mobile}
                      </span>
                    )}
                    {c.workPhone && (
                      <span className="inline-flex items-center gap-1 tabular">
                        <Phone className="w-3 h-3" /> {c.workPhone} (work)
                      </span>
                    )}
                  </div>
                </div>
                {canEdit && (
                  <div className="flex items-start gap-1">
                    <IconButton icon={Pencil} label="Edit contact" size="sm" onClick={() => openEdit(c)} />
                    <IconButton icon={Trash2} label="Remove contact" size="sm" onClick={() => setRemoving(c)} />
                  </div>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <Button size="sm" variant="secondary" icon={Plus} onClick={() => setEditing({ id: null, values: blank })}>
              Add Contact Person
            </Button>
          )}
        </>
      )}

      {editing && <ContactModal open onClose={() => setEditing(null)} initial={editing.values} onSave={save} saving={update.isPending} options={options} noun={noun} />}
      <ConfirmDialog open={Boolean(removing)} onClose={() => setRemoving(null)} onConfirm={() => void confirmRemove()} loading={update.isPending} title="Remove contact person?" confirmLabel="Remove" message={<><strong>{removing?.firstName} {removing?.lastName}</strong> will be removed from this {noun}.{removing?.isPrimary ? ' Another contact will become primary.' : ''}</>} />
    </div>
  );
}
