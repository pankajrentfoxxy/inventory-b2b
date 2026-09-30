import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Button, Field, Input, Modal } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { applyServerErrors, summarizeErrors } from '../../../lib/validation';
import { useIdempotencyKey, shouldRetryWithSameKey } from '../../../hooks/useIdempotencyKey';
import { useInviteMember, useRoles } from '../hooks';
import type { InvitePayload } from '../types';
import { describeApiError } from '../errorText';
import { RoleCheckboxList } from './RoleCheckboxList';
import { WarehousePicker } from './WarehousePicker';

interface InviteFormValues {
  email: string;
  fullName: string;
  roleIds: string[];
  allWarehouses: boolean;
  warehouseIds: string[];
}

const EMPTY: InviteFormValues = { email: '', fullName: '', roleIds: [], allWarehouses: true, warehouseIds: [] };

export function InviteMemberModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const roles = useRoles(open);
  const invite = useInviteMember();
  const { keyFor, reset: resetKey } = useIdempotencyKey();
  const { register, control, handleSubmit, reset, setError, formState: { errors } } = useForm<InviteFormValues>({ defaultValues: EMPTY });

  useEffect(() => {
    if (open) {
      reset(EMPTY);
      resetKey();
    }
  }, [open, reset, resetKey]);

  const submit = handleSubmit(async (v) => {
    const payload: InvitePayload = {
      email: v.email.trim(),
      ...(v.fullName.trim() ? { fullName: v.fullName.trim() } : {}),
      roleIds: v.roleIds,
      ...(v.allWarehouses ? {} : { warehouseIds: v.warehouseIds }),
    };
    try {
      await invite.mutateAsync({ payload, idempotencyKey: keyFor(payload) });
      resetKey();
      toast.success(`Invitation sent to ${payload.email}`);
      onClose();
    } catch (err) {
      const e = toApiError(err);
      if (!shouldRetryWithSameKey(e.status)) resetKey();
      const unmapped = applyServerErrors(setError, e);
      toast.error(e.code === 'IAM_ESCALATION_DENIED' ? describeApiError(e) : summarizeErrors(unmapped, e.message));
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite member"
      description="The invitee receives an email with a link that expires. Roles and warehouse scope apply when they accept."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={invite.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={invite.isPending}>
            Send invitation
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate className="space-y-4">
        <Field label="Email" required htmlFor="invite-email" error={errors.email?.message}>
          <Input id="invite-email" type="email" autoFocus sanitize="email" maxLength={254} error={Boolean(errors.email)} {...register('email')} />
        </Field>
        <Field label="Full name" htmlFor="invite-name" hint="Optional; the invitee can set it when accepting." error={errors.fullName?.message}>
          <Input id="invite-name" sanitize="singleLine" maxLength={150} error={Boolean(errors.fullName)} {...register('fullName')} />
        </Field>
        <Field label="Roles" required error={errors.roleIds?.message}>
          <Controller control={control} name="roleIds" render={({ field }) => <RoleCheckboxList roles={roles.data ?? []} loading={roles.isLoading} value={field.value} onChange={field.onChange} />} />
          {roles.isError && <p className="text-xs text-red-600 mt-1">{toApiError(roles.error).message}</p>}
        </Field>
        <Field label="Warehouse scope" error={errors.warehouseIds?.message}>
          <Controller
            control={control}
            name="allWarehouses"
            render={({ field: all }) => (
              <Controller
                control={control}
                name="warehouseIds"
                render={({ field: ids }) => (
                  <WarehousePicker
                    value={{ allWarehouses: all.value, warehouseIds: ids.value }}
                    onChange={(v) => {
                      all.onChange(v.allWarehouses);
                      ids.onChange(v.warehouseIds);
                    }}
                  />
                )}
              />
            )}
          />
        </Field>
      </form>
    </Modal>
  );
}
