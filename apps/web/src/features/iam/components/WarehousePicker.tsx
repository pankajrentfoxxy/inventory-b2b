import { Checkbox, RadioPill, Skeleton, StatusBadge } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useWarehouseOptions } from '../hooks';

export interface WarehouseScopeValue {
  allWarehouses: boolean;
  warehouseIds: string[];
}

/**
 * "All warehouses" or a checklist from GET /v1/master/warehouses. The list needs warehouse.view;
 * when the API denies it the picker still lets the user keep "All" and shows why the list is empty.
 */
export function WarehousePicker({ value, onChange, disabled, error }: { value: WarehouseScopeValue; onChange: (v: WarehouseScopeValue) => void; disabled?: boolean; error?: string }) {
  const warehouses = useWarehouseOptions(!value.allWarehouses);
  const toggle = (id: string) => onChange({ ...value, warehouseIds: value.warehouseIds.includes(id) ? value.warehouseIds.filter((w) => w !== id) : [...value.warehouseIds, id] });
  return (
    <div className="space-y-3">
      <RadioPill
        name="Warehouse scope"
        value={value.allWarehouses ? 'ALL' : 'SOME'}
        onChange={(v) => onChange({ allWarehouses: v === 'ALL', warehouseIds: v === 'ALL' ? [] : value.warehouseIds })}
        options={[
          { value: 'ALL', label: 'All warehouses' },
          { value: 'SOME', label: 'Selected warehouses' },
        ]}
      />
      {!value.allWarehouses && (
        <div className="rounded-lg border border-slate-200">
          {warehouses.isLoading ? (
            <div className="p-3 space-y-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-5 w-40" />
            </div>
          ) : warehouses.isError ? (
            <p className="p-3 text-sm text-red-600">{toApiError(warehouses.error).message}</p>
          ) : (warehouses.data ?? []).length === 0 ? (
            <p className="p-3 text-sm text-slate-500">No warehouses found. Create one under Masters first.</p>
          ) : (
            <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
              {(warehouses.data ?? []).map((w) => (
                <div key={w.id} className="px-3 py-2 flex items-center justify-between gap-3">
                  <Checkbox label={<span className="font-mono text-[13px]">{w.code}</span>} description={w.name} checked={value.warehouseIds.includes(w.id)} onChange={() => toggle(w.id)} disabled={disabled} />
                  <StatusBadge status={w.status} dot={false} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
