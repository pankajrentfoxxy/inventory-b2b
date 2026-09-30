import { useMemo, useState } from 'react';
import { ErrorState, Field, SearchSelect, type SearchSelectOption } from '../../../components/ui';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { toApiError } from '../../../lib/api';
import { useLaptopPreview, useLaptopSpecs } from '../hooks';
import { SPEC_ID_FIELDS, type LaptopSpecIdKey, type LaptopSpecIds, type SpecKind, type SpecOption } from '../types';

export type SpecIdValues = Record<LaptopSpecIdKey, string>;
export const EMPTY_SPEC_IDS: SpecIdValues = { brandId: '', modelId: '', generationId: '', processorId: '', ramId: '', ssdId: '', gpuId: '', screenSizeId: '' };

/** The complete id set, or null while any of the eight is still missing. */
export function completeSpecIds(v: SpecIdValues): LaptopSpecIds | null {
  return SPEC_ID_FIELDS.every((f) => Boolean(v[f.idKey])) ? { ...v } : null;
}

/**
 * Debounced /laptops/preview for the current selection: generated SKU / name, duplicate check, and
 * the server's per-field problems (e.g. "Latitude 5440 is not a HP model") keyed by id field.
 */
export function useSpecPreview(value: SpecIdValues) {
  const key = JSON.stringify(completeSpecIds(value));
  const debounced = useDebouncedValue(key, 350);
  const ids = useMemo(() => JSON.parse(debounced) as LaptopSpecIds | null, [debounced]);
  const preview = useLaptopPreview(ids);
  const stale = key !== debounced;
  const apiError = preview.isError ? toApiError(preview.error) : null;
  const fieldErrors: Partial<Record<LaptopSpecIdKey, string>> = {};
  if (apiError && !stale) for (const d of apiError.details) if (d.path && d.path in EMPTY_SPEC_IDS && !(d.path in fieldErrors)) fieldErrors[d.path as LaptopSpecIdKey] = d.message;
  return {
    /** All eight picked (the preview may still be loading). */
    allChosen: key !== 'null',
    loading: stale || preview.isFetching,
    data: stale ? undefined : preview.data,
    error: stale ? null : apiError,
    fieldErrors,
    refetch: () => void preview.refetch(),
  };
}

function SpecSelect({ id, value, options, onChange, disabled, error, placeholder }: { id: string; value: string; options: SearchSelectOption[]; onChange: (v: string) => void; disabled?: boolean; error?: boolean; placeholder: string }) {
  const [term, setTerm] = useState('');
  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return options;
    return options.filter((o) => o.label.toLowerCase().includes(t) || (o.description ?? '').toLowerCase().includes(t));
  }, [options, term]);
  const selectedLabel = options.find((o) => o.value === value)?.label;
  return (
    <SearchSelect
      id={id}
      value={value}
      selectedLabel={selectedLabel}
      options={filtered}
      onSearch={setTerm}
      onChange={(v) => onChange(v)}
      placeholder={placeholder}
      disabled={disabled}
      error={error}
      emptyText="No matching values"
    />
  );
}

export interface LaptopSpecSelectsProps {
  value: SpecIdValues;
  onChange: (next: SpecIdValues, changed: LaptopSpecIdKey) => void;
  /** Error message per id field (form errors merged with preview errors). */
  errors?: Partial<Record<LaptopSpecIdKey, string | undefined>>;
  disabled?: boolean;
  idPrefix?: string;
}

/**
 * The eight specification pickers of a laptop configuration. Options are the ACTIVE values of each
 * master (a currently selected inactive value stays visible, marked inactive). Models are limited
 * to the chosen brand; changing the brand clears the model.
 */
export function LaptopSpecSelects({ value, onChange, errors = {}, disabled, idPrefix = 'spec' }: LaptopSpecSelectsProps) {
  const all = useLaptopSpecs({ includeInactive: true });
  const byKind = useMemo(() => {
    const map = new Map<SpecKind, SpecOption[]>();
    for (const o of all.data ?? []) {
      const list = map.get(o.kind) ?? [];
      list.push(o);
      map.set(o.kind, list);
    }
    return map;
  }, [all.data]);

  const optionsFor = (kind: SpecKind, idKey: LaptopSpecIdKey): SearchSelectOption[] => {
    const current = value[idKey];
    return (byKind.get(kind) ?? [])
      .filter((o) => (kind === 'MODEL' ? o.brandId === value.brandId : true))
      .filter((o) => o.status === 'ACTIVE' || o.id === current)
      .map((o) => ({ value: o.id, label: o.status === 'ACTIVE' ? o.name : `${o.name} (inactive)`, description: `Code ${o.code}` }));
  };

  const set = (key: LaptopSpecIdKey, v: string) => {
    const next = { ...value, [key]: v };
    if (key === 'brandId' && v !== value.brandId) next.modelId = '';
    onChange(next, key);
  };

  if (all.isError) {
    return <ErrorState title="Could not load the specification masters" message={toApiError(all.error).message} onRetry={() => void all.refetch()} />;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {SPEC_ID_FIELDS.map((f) => {
        const id = `${idPrefix}-${f.idKey}`;
        const needsBrand = f.kind === 'MODEL' && !value.brandId;
        const options = optionsFor(f.kind, f.idKey);
        const placeholder = all.isLoading ? 'Loading...' : needsBrand ? 'Select a brand first' : options.length === 0 ? `No active ${f.label.toLowerCase()} values` : `Select ${f.label.toLowerCase()}`;
        return (
          <Field key={f.idKey} label={f.label} required htmlFor={id} error={errors[f.idKey]}>
            <SpecSelect id={id} value={value[f.idKey]} options={options} onChange={(v) => set(f.idKey, v)} disabled={disabled || all.isLoading || needsBrand} error={Boolean(errors[f.idKey])} placeholder={placeholder} />
          </Field>
        );
      })}
    </div>
  );
}
