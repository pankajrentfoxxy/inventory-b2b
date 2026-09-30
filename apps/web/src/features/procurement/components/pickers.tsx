import { useState } from 'react';
import { SearchSelect, Select } from '../../../components/ui';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useProductLookup, useScopedWarehouses, useSupplierLookup } from '../hooks';
import type { ProductSnapshot, SupplierSnapshot, WarehouseLookup } from '../types';

/** Async supplier picker over GET /v1/party/lookups/suppliers (active suppliers only). */
export function SupplierPicker({ value, onChange, selectedLabel, error, disabled, allowClear, placeholder = 'Select a supplier', size }: { value: string; onChange: (id: string, supplier: SupplierSnapshot | null) => void; selectedLabel?: string; error?: boolean; disabled?: boolean; allowClear?: boolean; placeholder?: string; size?: 'sm' | 'md' }) {
  const [term, setTerm] = useState('');
  const suppliers = useSupplierLookup(useDebouncedValue(term, 250));
  const rows = suppliers.data ?? [];
  return (
    <SearchSelect
      value={value}
      selectedLabel={selectedLabel}
      onChange={(v) => onChange(v, rows.find((s) => s.id === v) ?? null)}
      onSearch={setTerm}
      loading={suppliers.isFetching}
      placeholder={placeholder}
      error={error}
      disabled={disabled}
      allowClear={allowClear}
      size={size}
      emptyText={suppliers.isError ? 'Could not load suppliers' : term ? `No suppliers match "${term}"` : 'No active suppliers'}
      options={rows.map((s) => ({ value: s.id, label: s.displayName, description: [s.code, s.gstin ?? 'No GSTIN', s.stateCode ? `State ${s.stateCode}` : null].filter(Boolean).join(' - ') }))}
    />
  );
}

/** Async product typeahead over GET /v1/master/lookups/products?status=ACTIVE. */
export function ProductPicker({ value, onChange, selectedLabel, error, disabled, placeholder = 'Type to search products', size }: { value: string; onChange: (id: string, product: ProductSnapshot | null) => void; selectedLabel?: string; error?: boolean; disabled?: boolean; placeholder?: string; size?: 'sm' | 'md' }) {
  const [term, setTerm] = useState('');
  const products = useProductLookup(useDebouncedValue(term, 250));
  const rows = products.data ?? [];
  return (
    <SearchSelect
      value={value}
      selectedLabel={selectedLabel}
      onChange={(v) => onChange(v, rows.find((p) => p.id === v) ?? null)}
      onSearch={setTerm}
      loading={products.isFetching}
      placeholder={placeholder}
      error={error}
      disabled={disabled}
      size={size}
      emptyText={products.isError ? 'Could not load products' : term ? `No products match "${term}"` : 'No active products'}
      options={rows.map((p) => ({ value: p.id, label: p.name, description: [p.sku, p.taxRate !== null ? `GST ${p.taxRate}%` : 'No tax', p.isSerialized ? 'Serialized' : null].filter(Boolean).join(' - ') }))}
    />
  );
}

/** Warehouse select limited to the member's warehouse scope. */
export function WarehouseSelect({ value, onChange, error, disabled, placeholder = 'Select a warehouse', includeInactive = false, id, className }: { value: string; onChange: (id: string, warehouse: WarehouseLookup | null) => void; error?: boolean; disabled?: boolean; placeholder?: string; includeInactive?: boolean; id?: string; className?: string }) {
  const { warehouses, isLoading, isError } = useScopedWarehouses();
  const rows = includeInactive ? warehouses : warehouses.filter((w) => w.status === 'ACTIVE' || w.id === value);
  return (
    <Select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value, rows.find((w) => w.id === e.target.value) ?? null)}
      error={error}
      disabled={disabled || isLoading}
      placeholder={isLoading ? 'Loading warehouses...' : isError ? 'Could not load warehouses' : placeholder}
      options={rows.map((w) => ({ value: w.id, label: `${w.code} - ${w.name}${w.status !== 'ACTIVE' ? ' (inactive)' : ''}` }))}
      className={className}
    />
  );
}
