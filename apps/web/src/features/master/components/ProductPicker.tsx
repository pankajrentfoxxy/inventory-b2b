import { useState } from 'react';
import { SearchSelect, type SearchSelectOption } from '../../../components/ui';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useProductLookup } from '../hooks';
import type { ProductSnapshot } from '../types';

export interface ProductPickerProps {
  value: string;
  onChange: (id: string, option: { value: string; label: string; description?: string } | null) => void;
  /** Shown when the selected id is not in the current result set (e.g. editing an existing line). */
  selectedLabel?: string;
  disabled?: boolean;
  error?: boolean;
  placeholder?: string;
  /** Only products with trackInventory = true (stock documents). */
  trackInventoryOnly?: boolean;
  /** Receives the full snapshot of the picked product (unit, tax, HSN, serialization flags). */
  onPick?: (product: ProductSnapshot | null) => void;
  allowClear?: boolean;
  className?: string;
  id?: string;
}

export function productOptionLabel(p: ProductSnapshot): SearchSelectOption {
  const bits = [p.sku, p.unitCode, p.hsnCode ? `HSN ${p.hsnCode}` : null, p.taxRate !== null ? `${p.taxRate}% GST` : null, p.isSerialized ? 'Serialized' : null].filter(Boolean);
  return { value: p.id, label: p.name, description: bits.join(' - ') };
}

/** Async product search (`/v1/master/lookups/products`, ACTIVE only) for document lines. */
export function ProductPicker({ value, onChange, selectedLabel, disabled, error, placeholder = 'Select a product', trackInventoryOnly, onPick, allowClear = true, className, id }: ProductPickerProps) {
  const [term, setTerm] = useState('');
  const debounced = useDebouncedValue(term, 250);
  const lookup = useProductLookup(debounced, { trackInventoryOnly, enabled: !disabled });
  const rows = lookup.data ?? [];
  return (
    <SearchSelect
      id={id}
      value={value}
      selectedLabel={selectedLabel}
      onChange={(v, o) => {
        onChange(v, o ? { value: o.value, label: o.label, description: o.description } : null);
        onPick?.(rows.find((p) => p.id === v) ?? null);
      }}
      onSearch={setTerm}
      loading={lookup.isFetching}
      options={rows.map(productOptionLabel)}
      placeholder={placeholder}
      disabled={disabled}
      error={error}
      allowClear={allowClear}
      className={className}
      emptyText={lookup.isError ? 'Could not load products' : 'No active products match'}
    />
  );
}
