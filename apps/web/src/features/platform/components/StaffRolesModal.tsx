import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Modal } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { usePlatformRoles, useSetStaffRoles } from '../hooks';
import type { PlatformStaff } from '../types';
import { PlatformRoleCheckboxList } from './PlatformRoleCheckboxList';

export function StaffRolesModal({ staff, onClose }: { staff: PlatformStaff | null; onClose: () => void }) {
  const open = Boolean(staff);
  const roles = usePlatformRoles(open);
  const setRoles = useSetStaffRoles();
  const [keys, setKeys] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (staff) {
      setKeys(staff.roleKeys);
      setError(null);
    }
  }, [staff]);

  const save = async () => {
    if (!staff) return;
    if (keys.length === 0) {
      setError('Select at least one role');
      return;
    }
    try {
      await setRoles.mutateAsync({ id: staff.id, roleKeys: keys });
      toast.success(`Roles updated for ${staff.fullName}`);
      onClose();
    } catch (err) {
      const e = toApiError(err);
      setError(e.fieldErrors.roleKeys ?? e.message);
      toast.error(e.message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={staff ? `Platform roles: ${staff.fullName}` : 'Platform roles'}
      description="Replaces the staff member's platform roles. Their permissions refresh on the next request."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={setRoles.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={setRoles.isPending}>
            Save roles
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <PlatformRoleCheckboxList roles={roles.data ?? []} loading={roles.isLoading} value={keys} onChange={(k) => { setKeys(k); setError(null); }} />
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
