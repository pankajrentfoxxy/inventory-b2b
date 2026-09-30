import { useState } from 'react';
import { SearchSelect, type SearchSelectOption } from '../../../components/ui';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { usePartyLookup } from '../hooks';
import { GST_TREATMENT_LABELS, type PartySnapshot, type PartyType } from '../types';

export interface PartyPickerProps {
  value: string;
  onChange: (id: string, option: { value: string; label: string; description?: string } | null) => void;
  /** Shown when the selected id is not in the current result set (e.g. editing an existing document). */
  selectedLabel?: string;
  disabled?: boolean;
  error?: boolean;
  placeholder?: string;
  /** SUPPLIER (default) searches /v1/party/lookups/suppliers; CUSTOMER searches /lookups/customers. */
  type?: PartyType;
  /** Receives the full snapshot (GSTIN, state code, billing address, payment term) of the picked party. */
  onPick?: (party: PartySnapshot | null) => void;
  allowClear?: boolean;
  className?: string;
  id?: string;
}

export function partyOption(p: PartySnapshot): SearchSelectOption {
  const bits = [p.code, p.gstin ?? GST_TREATMENT_LABELS[p.gstTreatment], p.billingAddress?.city ?? null].filter(Boolean);
  return { value: p.id, label: p.displayName, description: bits.join(' - ') };
}

/** Async party search (ACTIVE only) for procurement / sales documents. */
export function PartyPicker({ value, onChange, selectedLabel, disabled, error, placeholder, type = 'SUPPLIER', onPick, allowClear = true, className, id }: PartyPickerProps) {
  const [term, setTerm] = useState('');
  const debounced = useDebouncedValue(term, 250);
  const lookup = usePartyLookup(type, debounced, !disabled);
  const rows = lookup.data ?? [];
  const noun = type === 'SUPPLIER' ? 'supplier' : 'customer';
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
      options={rows.map(partyOption)}
      placeholder={placeholder ?? `Select a ${noun}`}
      disabled={disabled}
      error={error}
      allowClear={allowClear}
      className={className}
      emptyText={lookup.isError ? `Could not load ${noun}s` : `No active ${noun}s match`}
    />
  );
}
