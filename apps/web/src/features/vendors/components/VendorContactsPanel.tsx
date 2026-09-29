import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import toast from 'react-hot-toast';
import { Mail, Pencil, Phone, Plus, Star, Trash2, Users } from 'lucide-react';
import { vendorContactSchema, type VendorContactPayload } from '@b2b/shared';
import { Badge, Button, ConfirmDialog, EmptyState, Field, IconButton, Input, Modal, Select, Checkbox } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { usePermission } from '../../../lib/auth';
import { applyServerErrors, summarizeErrors } from '../../../lib/validation';
import { vendorApi } from '../api';
import { useVendorChildMutation } from '../hooks';
import type { VendorContact, VendorFormOptions } from '../types';

type ContactForm = {
  salutation: string;
  firstName: string;
  lastName: string;
  email: string;
  workPhone: string;
  mobile: string;
  designation: string;
  department: string;
  isPrimary: boolean;
};

const blank: ContactForm = { salutation: '', firstName: '', lastName: '', email: '', workPhone: '', mobile: '', designation: '', department: '', isPrimary: false };

function ContactModal({ open, onClose, initial, onSave, saving, options }: { open: boolean; onClose: () => void; initial: ContactForm; onSave: (v: VendorContactPayload) => Promise<void>; saving: boolean; options: VendorFormOptions }) {
  const form = useForm<ContactForm>({ defaultValues: initial, values: initial, resolver: zodResolver(vendorContactSchema) as never });
  const { register, handleSubmit, formState: { errors }, setError } = form;
  const submit = handleSubmit(async (values) => {
    try {
      await onSave(vendorContactSchema.parse(values));
    } catch (err) {
      const e = toApiError(err);
      toast.error(summarizeErrors(applyServerErrors(setError, e), e.message));
    }
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
          <Checkbox label="Primary contact person" description="The default person for purchase communication. Only one contact can be primary." {...register('isPrimary')} />
        </div>
      </form>
    </Modal>
  );
}

export function VendorContactsPanel({ vendorId, contacts, options }: { vendorId: string; contacts: VendorContact[]; options: VendorFormOptions }) {
  const { canEditVendor } = usePermission();
  const [editing, setEditing] = useState<{ id: string | null; values: ContactForm } | null>(null);
  const [removing, setRemoving] = useState<VendorContact | null>(null);
  const add = useVendorChildMutation(vendorId, (v: VendorContactPayload) => vendorApi.addContact(vendorId, v));
  const update = useVendorChildMutation(vendorId, ({ id, v }: { id: string; v: VendorContactPayload }) => vendorApi.updateContact(vendorId, id, v));
  const remove = useVendorChildMutation(vendorId, (id: string) => vendorApi.removeContact(vendorId, id));

  const openEdit = (c: VendorContact) =>
    setEditing({
      id: c.id,
      values: { salutation: c.salutation ?? '', firstName: c.firstName, lastName: c.lastName ?? '', email: c.email ?? '', workPhone: c.workPhone ?? '', mobile: c.mobile ?? '', designation: c.designation ?? '', department: c.department ?? '', isPrimary: c.isPrimary },
    });

  const save = async (v: VendorContactPayload) => {
    if (editing?.id) await update.mutateAsync({ id: editing.id, v });
    else await add.mutateAsync(v);
    toast.success(editing?.id ? 'Contact updated' : 'Contact added');
    setEditing(null);
  };

  const confirmRemove = async () => {
    if (!removing) return;
    try {
      await remove.mutateAsync(removing.id);
      toast.success('Contact removed');
    } catch (err) {
      toast.error(toApiError(err).message);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="space-y-3">
      {contacts.length === 0 ? (
        <EmptyState icon={Users} title="No contact persons" hint="Add the people you deal with at this vendor." className="py-8" action={canEditVendor ? <Button size="sm" variant="secondary" icon={Plus} onClick={() => setEditing({ id: null, values: { ...blank, isPrimary: true } })}>Add Contact Person</Button> : undefined} />
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
                {canEditVendor && (
                  <div className="flex items-start gap-1">
                    <IconButton icon={Pencil} label="Edit contact" size="sm" onClick={() => openEdit(c)} />
                    <IconButton icon={Trash2} label="Remove contact" size="sm" onClick={() => setRemoving(c)} />
                  </div>
                )}
              </li>
            ))}
          </ul>
          {canEditVendor && (
            <Button size="sm" variant="secondary" icon={Plus} onClick={() => setEditing({ id: null, values: blank })}>
              Add Contact Person
            </Button>
          )}
        </>
      )}

      {editing && <ContactModal open onClose={() => setEditing(null)} initial={editing.values} onSave={save} saving={add.isPending || update.isPending} options={options} />}
      <ConfirmDialog open={Boolean(removing)} onClose={() => setRemoving(null)} onConfirm={() => void confirmRemove()} loading={remove.isPending} title="Remove contact person?" confirmLabel="Remove" message={<><strong>{removing?.firstName} {removing?.lastName}</strong> will be removed from this vendor.{removing?.isPrimary ? ' Another contact will become primary.' : ''}</>} />
    </div>
  );
}
