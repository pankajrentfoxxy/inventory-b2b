import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Button, Modal } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { applyServerErrors, summarizeErrors } from '../../../lib/validation';
import { usePatchParty } from '../hooks';
import { PARTY_META, type Party, type PartyType } from '../types';
import { PartyBasicFields } from './PartyFormFields';
import { partyToValues, toPartyPatch, type PartyFormValues } from './partyForm.model';

/** Edits the basic fields with PATCH + If-Match; addresses, contacts and bank accounts live on the detail tabs. */
export function PartyEditModal({ open, onClose, type, party }: { open: boolean; onClose: () => void; type: PartyType; party: Party }) {
  const patch = usePatchParty(type);
  const defaults = useMemo(() => partyToValues(party), [party]);
  const form = useForm<PartyFormValues>({ defaultValues: defaults });
  const { handleSubmit, reset, setError } = form;

  useEffect(() => {
    if (open) reset(defaults);
  }, [open, defaults, reset]);

  const submit = handleSubmit(async (values) => {
    const diff = toPartyPatch(values, party);
    if (Object.keys(diff).length === 0) {
      toast.success('No changes to save');
      onClose();
      return;
    }
    try {
      const saved = await patch.mutateAsync({ id: party.id, patch: diff, version: party.version });
      toast.success(`${saved.displayName} updated`);
      onClose();
    } catch (err) {
      const e = toApiError(err);
      if (e.code === 'VERSION_CONFLICT') {
        toast.error(`This ${PARTY_META[type].singular.toLowerCase()} was changed by someone else. Reopen the dialog to see the latest version.`);
        return;
      }
      toast.error(summarizeErrors(applyServerErrors(setError, e), e.message));
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit ${party.displayName}`}
      description={`${party.code} - version ${party.version}. GSTIN changes are checked against the default billing address.`}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={patch.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={patch.isPending}>
            Save Changes
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        <PartyBasicFields form={form} type={type} mode="edit" />
      </form>
    </Modal>
  );
}
