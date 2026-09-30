import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Button, Field, Input, Modal, Textarea } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { applyServerErrors, summarizeErrors } from '../../../lib/validation';
import { useCloneRole, useCreateRole } from '../hooks';
import type { Role } from '../types';
import { describeApiError } from '../errorText';

interface RoleFormValues {
  name: string;
  description: string;
  rank: string;
}

/**
 * "New role" (POST /roles with no permissions yet; the matrix is edited next) or "Clone" (POST
 * /roles/:id/clone copies the source permissions). `source` decides which.
 */
export function RoleFormModal({ open, onClose, source, onSaved }: { open: boolean; onClose: () => void; source?: Role | null; onSaved?: (roleId: string) => void }) {
  const create = useCreateRole();
  const clone = useCloneRole();
  const { register, handleSubmit, reset, setError, formState: { errors } } = useForm<RoleFormValues>({ defaultValues: { name: '', description: '', rank: '' } });

  useEffect(() => {
    if (open) reset({ name: source ? `${source.name} (copy)` : '', description: '', rank: source ? String(Math.min(source.rank, 99)) : '' });
  }, [open, source, reset]);

  const submit = handleSubmit(async (v) => {
    const rank = v.rank.trim() === '' ? undefined : Number(v.rank);
    try {
      const saved = source
        ? await clone.mutateAsync({ id: source.id, payload: { name: v.name.trim(), ...(rank === undefined ? {} : { rank }) } })
        : await create.mutateAsync({ name: v.name.trim(), ...(v.description.trim() ? { description: v.description.trim() } : {}), permissionCodes: [], rank: rank ?? 0 });
      toast.success(source ? `${saved.name} cloned from ${source.name}` : `${saved.name} created. Now pick its permissions.`);
      onSaved?.(saved.id);
      onClose();
    } catch (err) {
      const e = toApiError(err);
      const unmapped = applyServerErrors(setError, e);
      toast.error(e.code === 'IAM_ESCALATION_DENIED' ? describeApiError(e) : summarizeErrors(unmapped, e.message));
    }
  });

  const saving = create.isPending || clone.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={source ? `Clone ${source.name}` : 'New role'}
      description="Custom roles must rank below your own role. Rank decides who can assign or edit whom."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={saving}>
            {source ? 'Clone role' : 'Create role'}
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate className="space-y-4">
        <Field label="Role name" required htmlFor="role-name" error={errors.name?.message}>
          <Input id="role-name" autoFocus sanitize="singleLine" maxLength={100} error={Boolean(errors.name)} {...register('name')} />
        </Field>
        <Field label="Rank" required={!source} htmlFor="role-rank" hint="1-99; must be lower than your highest role rank." error={errors.rank?.message}>
          <Input id="role-rank" sanitize="integer" maxLength={2} className="sm:max-w-[8rem] tabular" error={Boolean(errors.rank)} {...register('rank')} />
        </Field>
        {!source && (
          <Field label="Description" htmlFor="role-desc" error={errors.description?.message}>
            <Textarea id="role-desc" rows={3} maxLength={300} error={Boolean(errors.description)} {...register('description')} />
          </Field>
        )}
      </form>
    </Modal>
  );
}
