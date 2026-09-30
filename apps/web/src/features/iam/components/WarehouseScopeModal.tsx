import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Modal } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useSetWarehouseScope } from '../hooks';
import type { Member } from '../types';
import { describeApiError } from '../errorText';
import { WarehousePicker, type WarehouseScopeValue } from './WarehousePicker';

export function WarehouseScopeModal({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const open = Boolean(member);
  const setScope = useSetWarehouseScope();
  const [value, setValue] = useState<WarehouseScopeValue>({ allWarehouses: true, warehouseIds: [] });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (member) {
      setValue({ allWarehouses: member.allWarehouses, warehouseIds: member.warehouseIds });
      setError(null);
    }
  }, [member]);

  const save = async () => {
    if (!member) return;
    try {
      await setScope.mutateAsync({ id: member.id, payload: value });
      toast.success(`Warehouse scope updated for ${member.fullName}`);
      onClose();
    } catch (err) {
      const e = toApiError(err);
      const field = e.fieldErrors.warehouseIds;
      setError(field ?? describeApiError(e));
      if (!field) toast.error(describeApiError(e));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={member ? `Warehouse scope: ${member.fullName}` : 'Warehouse scope'}
      description="Limits which warehouses this member can see and post against. Changes apply on their next request."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={setScope.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={setScope.isPending}>
            Save scope
          </Button>
        </>
      }
    >
      <WarehousePicker value={value} onChange={(v) => { setValue(v); setError(null); }} error={error ?? undefined} />
    </Modal>
  );
}
