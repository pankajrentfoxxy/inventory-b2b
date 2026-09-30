import { useState } from 'react';
import { SearchSelect } from '../../../components/ui';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useProductSearch } from '../hooks';
import type { ProductLookup } from '../types';

/**
 * Async product picker over GET /v1/master/lookups/products (active, inventory-tracked items).
 * Reports the chosen product so forms know whether it is serialized.
 */
export function ProductPicker({ id, value, onChange, selectedLabel, disabled, error, allowClear, size, placeholder = 'Select an item', className }: {
  id?: string;
  value: string;
  onChange: (id: string, product: ProductLookup | null) => void;
  /** Label for a value chosen elsewhere (e.g. from the URL) that is not in the current results. */
  selectedLabel?: string;
  disabled?: boolean;
  error?: boolean;
  allowClear?: boolean;
  size?: 'sm' | 'md';
  placeholder?: string;
  className?: string;
}) {
  const [term, setTerm] = useState('');
  const [picked, setPicked] = useState<ProductLookup | null>(null);
  const search = useProductSearch(useDebouncedValue(term, 250), !disabled);
  const products = search.data ?? [];
  const label = picked && picked.id === value ? `${picked.sku} - ${picked.name}` : selectedLabel;
  return (
    <SearchSelect
      id={id}
      value={value}
      selectedLabel={label}
      onChange={(v) => {
        const p = products.find((x) => x.id === v) ?? null;
        setPicked(p);
        onChange(v, p);
      }}
      onSearch={setTerm}
      loading={search.isFetching}
      options={products.map((p) => ({ value: p.id, label: `${p.sku} - ${p.name}`, description: [p.unitCode, p.isSerialized ? 'Serialized' : null].filter(Boolean).join(' - ') }))}
      placeholder={placeholder}
      emptyText={search.isError ? 'Could not load items' : 'No inventory-tracked items match'}
      disabled={disabled}
      error={error}
      allowClear={allowClear}
      size={size}
      className={className}
    />
  );
}
