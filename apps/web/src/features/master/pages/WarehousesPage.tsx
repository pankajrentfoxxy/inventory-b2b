import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronDown, ChevronRight, FolderPlus, Grid2x2Plus, MapPin, MoreHorizontal, Pencil, Plus, Power, Star, Warehouse as WarehouseIcon } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, Dropdown, EmptyState, ErrorState, IconButton, PageHeader, Skeleton, StatusBadge } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { cn, formatQty, humanize } from '../../../lib/utils';
import { useBinStatus, useCreateBin, useCreateLocation, usePatchWarehouse, useWarehouseStatus, useWarehouses } from '../hooks';
import { LOCATION_PURPOSES, type Location, type Warehouse } from '../types';
import { WarehouseFormModal } from '../components/WarehouseFormModal';
import { SimpleFormModal, type FieldSpec } from '../components/SimpleFormModal';

const LOCATION_FIELDS: FieldSpec[] = [
  { name: 'code', label: 'Code', type: 'text', sanitize: 'code', maxLength: 20, required: true, mono: true, hint: 'Unique within the warehouse, e.g. RECV, QC-1, A01' },
  { name: 'name', label: 'Name', type: 'text', sanitize: 'singleLine', maxLength: 100 },
  { name: 'purpose', label: 'Purpose', type: 'select', options: LOCATION_PURPOSES.map((p) => ({ value: p, label: humanize(p) })), placeholder: 'General', nullable: true, span: 2 },
];
const BIN_FIELDS: FieldSpec[] = [
  { name: 'code', label: 'Code', type: 'text', sanitize: 'code', maxLength: 20, required: true, mono: true, hint: 'Unique within the location, e.g. A-01-03' },
  { name: 'capacity', label: 'Capacity', type: 'number', hint: 'Optional soft limit in stock units' },
];

function LocationRow({ location, canManage, onAddBin }: { location: Location; canManage: boolean; onAddBin: () => void }) {
  const [open, setOpen] = useState(true);
  const binStatus = useBinStatus();
  const toggleBin = async (binId: string, code: string, next: 'ACTIVE' | 'INACTIVE') => {
    try {
      await binStatus.mutateAsync({ binId, status: next });
      toast.success(`Bin ${code} is now ${next.toLowerCase()}`);
    } catch (err) {
      toast.error(toApiError(err).message);
    }
  };
  return (
    <li className="py-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-900 hover:text-brand-700" aria-expanded={open}>
          {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
          <MapPin className="w-4 h-4 text-slate-400" />
          <span className="font-mono">{location.code}</span>
          {location.name && <span className="text-slate-600 font-normal">{location.name}</span>}
        </button>
        {location.purpose && <Badge tone="blue">{humanize(location.purpose)}</Badge>}
        {location.status !== 'ACTIVE' && <StatusBadge status={location.status} />}
        <span className="text-xs text-slate-500 tabular">{location.bins.length} bin{location.bins.length === 1 ? '' : 's'}</span>
        {canManage && (
          <Button size="xs" variant="ghost" icon={Grid2x2Plus} onClick={onAddBin} className="ml-auto">
            Add bin
          </Button>
        )}
      </div>
      {open && (
        <div className="ml-6 mt-1.5">
          {location.bins.length === 0 ? (
            <p className="text-xs text-slate-400 py-1">No bins. Stock in this location is not bin-tracked until you add one.</p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
              {location.bins.map((b) => (
                <li key={b.id} className={cn('flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-sm', b.status === 'ACTIVE' ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50 text-slate-500')}>
                  <span className="min-w-0 flex items-center gap-2">
                    <span className="font-mono">{b.code}</span>
                    {b.capacity !== null && <span className="text-xs text-slate-500 tabular">cap {formatQty(b.capacity)}</span>}
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <StatusBadge status={b.status} dot={false} />
                    {canManage && <IconButton icon={Power} size="xs" label={b.status === 'ACTIVE' ? 'Deactivate bin' : 'Activate bin'} disabled={binStatus.isPending} onClick={() => void toggleBin(b.id, b.code, b.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE')} />}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function WarehouseCard({ warehouse, canManage, onEdit }: { warehouse: Warehouse; canManage: boolean; onEdit: () => void }) {
  const status = useWarehouseStatus();
  const patch = usePatchWarehouse();
  const createLocation = useCreateLocation();
  const createBin = useCreateBin();
  const [locationOpen, setLocationOpen] = useState(false);
  const [binFor, setBinFor] = useState<Location | null>(null);
  const a = warehouse.address;
  const addressLine = [a.line1, a.line2, a.city, a.state ?? a.stateCode, a.pincode].filter(Boolean).join(', ');

  const toggleStatus = async () => {
    const next = warehouse.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await status.mutateAsync({ id: warehouse.id, status: next });
      toast.success(`${warehouse.name} is now ${next.toLowerCase()}`);
    } catch (err) {
      toast.error(toApiError(err).message);
    }
  };
  const makeDefault = async () => {
    try {
      await patch.mutateAsync({ id: warehouse.id, patch: { isDefault: true }, version: warehouse.version });
      toast.success(`${warehouse.name} is now the default warehouse`);
    } catch (err) {
      toast.error(toApiError(err).message);
    }
  };

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2 flex-wrap">
            <span className="font-mono">{warehouse.code}</span>
            <span>{warehouse.name}</span>
            {warehouse.isDefault && (
              <Badge tone="amber">
                <Star className="w-3 h-3" /> Default
              </Badge>
            )}
            <StatusBadge status={warehouse.status} />
          </span>
        }
        description={
          <>
            {addressLine || 'No address'}
            {warehouse.gstin && <span className="font-mono ml-2">GSTIN {warehouse.gstin}</span>}
          </>
        }
        actions={
          canManage ? (
            <>
              <Button size="sm" variant="secondary" icon={FolderPlus} onClick={() => setLocationOpen(true)}>
                Add location
              </Button>
              <Dropdown
                trigger={({ toggle }) => <IconButton icon={MoreHorizontal} label="Warehouse actions" onClick={toggle} className="border border-slate-300 bg-white" />}
                items={[
                  { key: 'edit', label: 'Edit', icon: Pencil, onSelect: onEdit },
                  { key: 'default', label: 'Make default', icon: Star, onSelect: () => void makeDefault(), hidden: warehouse.isDefault || warehouse.status !== 'ACTIVE' },
                  { key: 'status', label: warehouse.status === 'ACTIVE' ? 'Deactivate' : 'Activate', icon: Power, tone: warehouse.status === 'ACTIVE' ? 'danger' : 'default', onSelect: () => void toggleStatus(), disabled: warehouse.isDefault && warehouse.status === 'ACTIVE' },
                ]}
              />
            </>
          ) : undefined
        }
      />
      <CardBody className="py-2">
        {warehouse.locations.length === 0 ? (
          <p className="text-sm text-slate-400 py-3">No locations yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {warehouse.locations.map((l) => (
              <LocationRow key={l.id} location={l} canManage={canManage} onAddBin={() => setBinFor(l)} />
            ))}
          </ul>
        )}
      </CardBody>
      <SimpleFormModal open={locationOpen} onClose={() => setLocationOpen(false)} title={`New location in ${warehouse.code}`} fields={LOCATION_FIELDS} pending={createLocation.isPending} onSubmit={(payload) => createLocation.mutateAsync({ warehouseId: warehouse.id, payload: payload as { code: string; name?: string; purpose?: Location['purpose'] } })} successMessage="Location created" />
      <SimpleFormModal open={binFor !== null} onClose={() => setBinFor(null)} title={binFor ? `New bin in ${warehouse.code} / ${binFor.code}` : 'New bin'} fields={BIN_FIELDS} pending={createBin.isPending} onSubmit={(payload) => createBin.mutateAsync({ locationId: binFor!.id, payload: payload as { code: string; capacity?: number } })} successMessage="Bin created" size="sm" />
    </Card>
  );
}

export function WarehousesPage() {
  const { hasPermission, warehouseIds } = useAuth();
  const canManage = hasPermission('warehouse.manage');
  const query = useWarehouses();
  const [modal, setModal] = useState<{ open: boolean; warehouse: Warehouse | null }>({ open: false, warehouse: null });
  const rows = useMemo(() => query.data ?? [], [query.data]);

  return (
    <>
      <PageHeader
        title="Warehouses & Bins"
        subtitle={warehouseIds ? 'Showing the warehouses in your scope.' : 'Warehouses hold locations; locations hold bins. Stock is tracked at the bin level.'}
        breadcrumbs={[{ label: 'Masters' }, { label: 'Warehouses & Bins' }]}
        actions={
          canManage ? (
            <Button icon={Plus} onClick={() => setModal({ open: true, warehouse: null })}>
              New Warehouse
            </Button>
          ) : undefined
        }
      />
      {query.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : query.isError ? (
        <Card>
          <ErrorState message={toApiError(query.error).message} onRetry={() => void query.refetch()} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={WarehouseIcon} title="No warehouses yet" hint="Create your first warehouse to start receiving stock. A STORE location is added automatically." action={canManage ? <Button icon={Plus} onClick={() => setModal({ open: true, warehouse: null })}>New Warehouse</Button> : undefined} />
        </Card>
      ) : (
        <div className="space-y-4">
          {rows.map((w) => (
            <WarehouseCard key={w.id} warehouse={w} canManage={canManage} onEdit={() => setModal({ open: true, warehouse: w })} />
          ))}
        </div>
      )}
      <WarehouseFormModal open={modal.open} warehouse={modal.warehouse} onClose={() => setModal({ open: false, warehouse: null })} />
    </>
  );
}
