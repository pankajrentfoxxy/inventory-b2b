import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Button, Modal } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { applyServerErrors, summarizeErrors } from '../../../lib/validation';
import { useAddAddress, useAddBankAccount, useAddContact } from '../hooks';
import type { AddressKind, PartyType } from '../types';
import { AddressFields, BankAccountFields, ContactFields } from './PartyFormFields';
import { emptyAddress, emptyBankAccount, emptyContact, emptyParty, toAddressPayload, toBankAccountPayload, toContactPayload, type PartyFormValues } from './partyForm.model';

/**
 * The sub-resource forms reuse the field-array components with a single row at index 0, so the
 * server's flat error paths ("pincode") are remapped to "addresses.0.pincode" and land on the inputs.
 */
const prefixed = (prefix: 'addresses' | 'contacts' | 'bankAccounts') => (path: string) => `${prefix}.0.${path}`;

interface SubModalProps {
  open: boolean;
  onClose: () => void;
  type: PartyType;
  partyId: string;
}

export function AddressFormModal({ open, onClose, type, partyId, kind = 'BILLING', firstOfKind }: SubModalProps & { kind?: AddressKind; firstOfKind?: boolean }) {
  const add = useAddAddress(type, partyId);
  const form = useForm<PartyFormValues>({ defaultValues: { ...emptyParty(), addresses: [emptyAddress(kind, Boolean(firstOfKind))] } });
  useEffect(() => {
    if (open) form.reset({ ...emptyParty(), addresses: [emptyAddress(kind, Boolean(firstOfKind))] });
  }, [open, kind, firstOfKind, form]);

  const submit = form.handleSubmit(async (v) => {
    try {
      const saved = await add.mutateAsync(toAddressPayload(v.addresses[0]));
      toast.success(`${saved.kind === 'BILLING' ? 'Billing' : 'Shipping'} address added`);
      onClose();
    } catch (err) {
      const e = toApiError(err);
      toast.error(summarizeErrors(applyServerErrors(form.setError, e, { mapPath: prefixed('addresses') }), e.message));
    }
  });

  return (
    <Modal open={open} onClose={onClose} title="New address" description="A default billing address must be in the same state as the GSTIN." size="lg" footer={<><Button variant="secondary" onClick={onClose} disabled={add.isPending}>Cancel</Button><Button onClick={() => void submit()} loading={add.isPending}>Add Address</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        <AddressFields form={form} index={0} />
      </form>
    </Modal>
  );
}

export function ContactFormModal({ open, onClose, type, partyId, first }: SubModalProps & { first?: boolean }) {
  const add = useAddContact(type, partyId);
  const form = useForm<PartyFormValues>({ defaultValues: { ...emptyParty(), contacts: [emptyContact(Boolean(first))] } });
  useEffect(() => {
    if (open) form.reset({ ...emptyParty(), contacts: [emptyContact(Boolean(first))] });
  }, [open, first, form]);

  const submit = form.handleSubmit(async (v) => {
    try {
      const saved = await add.mutateAsync(toContactPayload(v.contacts[0]));
      toast.success(`${saved.name} added`);
      onClose();
    } catch (err) {
      const e = toApiError(err);
      toast.error(summarizeErrors(applyServerErrors(form.setError, e, { mapPath: prefixed('contacts') }), e.message));
    }
  });

  return (
    <Modal open={open} onClose={onClose} title="New contact person" size="lg" footer={<><Button variant="secondary" onClick={onClose} disabled={add.isPending}>Cancel</Button><Button onClick={() => void submit()} loading={add.isPending}>Add Contact</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        <ContactFields form={form} index={0} />
      </form>
    </Modal>
  );
}

export function BankAccountFormModal({ open, onClose, type, partyId, first }: SubModalProps & { first?: boolean }) {
  const add = useAddBankAccount(type, partyId);
  const form = useForm<PartyFormValues>({ defaultValues: { ...emptyParty(), bankAccounts: [emptyBankAccount(Boolean(first))] } });
  useEffect(() => {
    if (open) form.reset({ ...emptyParty(), bankAccounts: [emptyBankAccount(Boolean(first))] });
  }, [open, first, form]);

  const submit = form.handleSubmit(async (v) => {
    try {
      const saved = await add.mutateAsync(toBankAccountPayload(v.bankAccounts[0]));
      toast.success(`${saved.bankName} account ending ${saved.accountNumber.slice(-4)} added`);
      onClose();
    } catch (err) {
      const e = toApiError(err);
      toast.error(summarizeErrors(applyServerErrors(form.setError, e, { mapPath: prefixed('bankAccounts') }), e.message));
    }
  });

  return (
    <Modal open={open} onClose={onClose} title="New bank account" description="The account number is encrypted at rest and masked in every response." size="lg" footer={<><Button variant="secondary" onClick={onClose} disabled={add.isPending}>Cancel</Button><Button onClick={() => void submit()} loading={add.isPending}>Add Bank Account</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        <BankAccountFields form={form} index={0} />
      </form>
    </Modal>
  );
}
