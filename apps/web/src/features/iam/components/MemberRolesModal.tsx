import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Modal } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useReplaceMemberRoles, useRoles } from '../hooks';
import type { Member } from '../types';
import { describeApiError } from '../errorText';
import { RoleCheckboxList } from './RoleCheckboxList';

export function MemberRolesModal({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const open = Boolean(member);
  const roles = useRoles(open);
  const replace = useReplaceMemberRoles();
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (member) {
      setRoleIds(member.roles.map((r) => r.id));
      setError(null);
    }
  }, [member]);

  const save = async () => {
    if (!member) return;
    if (roleIds.length === 0) {
      setError('Select at least one role');
      return;
    }
    try {
      await replace.mutateAsync({ id: member.id, roleIds });
      toast.success(`Roles updated for ${member.fullName}`);
      onClose();
    } catch (err) {
      const e = toApiError(err);
      const text = describeApiError(e);
      setError(text);
      toast.error(text);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={member ? `Change roles: ${member.fullName}` : 'Change roles'}
      description="You can only assign roles ranked below your own whose permissions you hold yourself."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={replace.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={replace.isPending}>
            Save roles
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <RoleCheckboxList roles={roles.data ?? []} loading={roles.isLoading} value={roleIds} onChange={(ids) => { setRoleIds(ids); setError(null); }} />
        {roles.isError && <p className="text-xs text-red-600">{toApiError(roles.error).message}</p>}
        {error && (
          <p className="text-xs text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
