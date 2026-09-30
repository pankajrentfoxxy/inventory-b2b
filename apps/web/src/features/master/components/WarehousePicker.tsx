import { useEffect, useMemo } from 'react';
import { Select } from '../../../components/ui';
import { useAuth } from '../../../lib/auth';
import { useWarehouses } from '../hooks';
import type { Warehouse } from '../types';

export interface WarehousePickerProps {
  value: string;
  onChange: (id: string) => void;
  error?: boolean;
  disabled?: boolean;
  /** Keep an empty "Select a warehouse" option; otherwise the first scoped / default warehouse is selected automatically. */
  allowEmpty?: boolean;
  id?: string;
  className?: string;
}

/** Active warehouses the member may act on (token warehouse scope; null = all). */
export function useScopedWarehouses(): { warehouses: Warehouse[]; isLoading: boolean; isError: boolean } {
  const { warehouseIds } = useAuth();
  const q = useWarehouses();
  const warehouses = useMemo(() => (q.data ?? []).filter((w) => w.status === 'ACTIVE' && (warehouseIds === null || warehouseIds.includes(w.id))), [q.data, warehouseIds]);
  return { warehouses, isLoading: q.isLoading, isError: q.isError };
}

/** Select over `/v1/master/warehouses`, ACTIVE only and limited to the member's warehouse scope. */
export function WarehousePicker({ value, onChange, error, disabled, allowEmpty, id, className }: WarehousePickerProps) {
  const { warehouses, isLoading, isError } = useScopedWarehouses();

  // Default to the first scoped warehouse (the default warehouse sorts first server-side).
  useEffect(() => {
    if (allowEmpty || value || warehouses.length === 0) return;
    onChange(warehouses[0].id);
  }, [allowEmpty, value, warehouses, onChange]);

  const options = warehouses.map((w) => ({ value: w.id, label: `${w.code} - ${w.name}${w.isDefault ? ' (default)' : ''}` }));
  const placeholder = isLoading ? 'Loading warehouses...' : isError ? 'Could not load warehouses' : allowEmpty ? 'Select a warehouse' : options.length === 0 ? 'No warehouse in your scope' : undefined;
  return <Select id={id} className={className} value={value} onChange={(e) => onChange(e.target.value)} options={options} placeholder={placeholder} error={error} disabled={disabled || isLoading || options.length === 0} />;
}
