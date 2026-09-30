import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Button, Field, Input, Modal } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { applyServerErrors, summarizeErrors } from '../../../lib/validation';
import { useAddStaff, usePlatformRoles } from '../hooks';
import { PlatformRoleCheckboxList } from './PlatformRoleCheckboxList';

interface AddStaffValues {
  userId: string;
  email: string;
  fullName: string;
  roleKeys: string[];
}

const EMPTY: AddStaffValues = { userId: '', email: '', fullName: '', roleKeys: [] };

/**
 * POST /v1/platform/iam/staff. Platform identities are created with the svc-auth `admin:create`
 * CLI; this only attaches platform roles to an existing user id.
 */
export function AddStaffModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const roles = usePlatformRoles(open);
  const add = useAddStaff();
  const { register, control, handleSubmit, reset, setError, formState: { errors } } = useForm<AddStaffValues>({ defaultValues: EMPTY });

  useEffect(() => {
    if (open) reset(EMPTY);
  }, [open, reset]);

  const submit = handleSubmit(async (v) => {
    try {
      await add.mutateAsync({ userId: v.userId.trim(), email: v.email.trim(), ...(v.fullName.trim() ? { fullName: v.fullName.trim() } : {}), roleKeys: v.roleKeys });
      toast.success(`${v.fullName.trim() || v.email.trim()} added to platform staff`);
      onClose();
    } catch (err) {
      const e = toApiError(err);
      toast.error(summarizeErrors(applyServerErrors(setError, e), e.message));
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add platform staff"
      description="The person must already exist as a platform identity (created with the svc-auth admin CLI). Paste their user id."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={add.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={add.isPending}>
            Add staff
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate className="space-y-4">
        <Field label="User id" required htmlFor="staff-user" hint="UUID from the identity store" error={errors.userId?.message}>
          <Input id="staff-user" autoFocus className="font-mono" maxLength={36} error={Boolean(errors.userId)} {...register('userId')} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Email" required htmlFor="staff-email" error={errors.email?.message}>
            <Input id="staff-email" type="email" sanitize="email" maxLength={254} error={Boolean(errors.email)} {...register('email')} />
          </Field>
          <Field label="Full name" htmlFor="staff-name" error={errors.fullName?.message}>
            <Input id="staff-name" sanitize="singleLine" maxLength={150} error={Boolean(errors.fullName)} {...register('fullName')} />
          </Field>
        </div>
        <Field label="Platform roles" required error={errors.roleKeys?.message}>
          <Controller control={control} name="roleKeys" render={({ field }) => <PlatformRoleCheckboxList roles={roles.data ?? []} loading={roles.isLoading} value={field.value} onChange={field.onChange} />} />
          {roles.isError && <p className="text-xs text-red-600 mt-1">{toApiError(roles.error).message}</p>}
        </Field>
      </form>
    </Modal>
  );
}
