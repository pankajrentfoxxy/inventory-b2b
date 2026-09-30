import { useEffect, useRef } from 'react';
import type { FieldErrors, UseFormRegister, UseFormSetValue } from 'react-hook-form';
import { Field, Input, Select, Textarea } from '../../../components/ui';
import { useSimpleMaster } from '../hooks';
import type { LaptopDetailsPayload, Product } from '../types';
import { EMPTY_SPEC_IDS, type SpecIdValues } from './LaptopSpecSelects';

/** Form state shared by the create page and the edit modals (all strings; converted on submit). */
export interface LaptopFormValues extends SpecIdValues {
  sku: string;
  name: string;
  purchasePrice: string;
  sellingPrice: string;
  reorderLevel: string;
  taxRateId: string;
  hsnId: string;
  serialPattern: string;
  description: string;
}

const str = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v));

export function laptopFormDefaults(product?: Product | null): LaptopFormValues {
  return {
    ...EMPTY_SPEC_IDS,
    ...(product?.specIds ?? {}),
    sku: product?.sku ?? '',
    name: product?.name ?? '',
    purchasePrice: str(product?.purchasePrice),
    sellingPrice: str(product?.sellingPrice),
    reorderLevel: str(product?.reorderLevel),
    taxRateId: product?.taxRateId ?? '',
    hsnId: product?.hsnId ?? '',
    serialPattern: product?.serialPattern ?? '',
    description: product?.description ?? '',
  };
}

/**
 * Converts the non-spec fields. On create, blanks are omitted so the server applies its defaults
 * (generated SKU / name, GST 18%); on edit, blanks clear the value (null) except SKU and name,
 * which are required and left unchanged when blank.
 */
export function laptopDetailsPayload(v: LaptopFormValues, mode: 'create' | 'patch'): LaptopDetailsPayload {
  const blank = mode === 'create' ? undefined : null;
  const text = (s: string) => (s.trim() === '' ? blank : s.trim());
  const num = (s: string) => (s.trim() === '' ? blank : Number(s));
  const ref = (s: string) => (s === '' ? blank : s);
  return {
    sku: v.sku.trim() || undefined,
    name: v.name.trim() || undefined,
    purchasePrice: num(v.purchasePrice),
    sellingPrice: num(v.sellingPrice),
    reorderLevel: num(v.reorderLevel),
    taxRateId: mode === 'create' && v.taxRateId === '' ? undefined : v.taxRateId === '' ? null : v.taxRateId,
    hsnId: ref(v.hsnId),
    serialPattern: text(v.serialPattern),
    description: text(v.description),
  };
}

interface Props {
  register: UseFormRegister<LaptopFormValues>;
  errors: FieldErrors<LaptopFormValues>;
  setValue: UseFormSetValue<LaptopFormValues>;
  /** Preselect the active 18% GST rate while taxRateId is blank (create form). */
  defaultTax?: boolean;
  /** Generated values shown as placeholders for SKU / name. */
  generated?: { sku?: string; name?: string };
  sections?: { identity?: boolean; pricing?: boolean; advanced?: boolean };
  idPrefix?: string;
}

/** SKU / name overrides, prices, tax, HSN, reorder level, serial pattern and description. */
export function LaptopDetailsFields({ register, errors, setValue, defaultTax, generated, sections = { identity: true, pricing: true, advanced: true }, idPrefix = 'lp' }: Props) {
  const taxRates = useSimpleMaster('tax-rates');
  const hsn = useSimpleMaster('hsn-codes');
  const defaulted = useRef(false);

  useEffect(() => {
    if (!defaultTax || defaulted.current || !taxRates.data) return;
    defaulted.current = true;
    const gst18 = taxRates.data.find((t) => Number(t.gstRate) === 18 && t.status === 'ACTIVE');
    if (gst18) setValue('taxRateId', gst18.id);
  }, [defaultTax, taxRates.data, setValue]);

  const id = (k: string) => `${idPrefix}-${k}`;
  const err = (k: keyof LaptopFormValues) => errors[k]?.message as string | undefined;

  return (
    <div className="space-y-4">
      {sections.identity && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="SKU" htmlFor={id('sku')} error={err('sku')}>
            <Input id={id('sku')} maxLength={40} sanitize="code" className="font-mono" placeholder={generated?.sku ?? 'Generated from the specifications'} error={Boolean(errors.sku)} {...register('sku')} />
            <p className="text-xs text-slate-500 mt-1">Leave blank to use the generated SKU.</p>
          </Field>
          <Field label="Name" htmlFor={id('name')} error={err('name')}>
            <Input id={id('name')} maxLength={200} sanitize="singleLine" placeholder={generated?.name ?? 'Brand and model'} error={Boolean(errors.name)} {...register('name')} />
            <p className="text-xs text-slate-500 mt-1">Leave blank to use the brand and model.</p>
          </Field>
        </div>
      )}
      {sections.pricing && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Purchase price" htmlFor={id('purchasePrice')} error={err('purchasePrice')}>
            <Input id={id('purchasePrice')} sanitize="decimal" prefix="INR" className="tabular" error={Boolean(errors.purchasePrice)} {...register('purchasePrice')} />
          </Field>
          <Field label="Selling price" htmlFor={id('sellingPrice')} error={err('sellingPrice')}>
            <Input id={id('sellingPrice')} sanitize="decimal" prefix="INR" className="tabular" error={Boolean(errors.sellingPrice)} {...register('sellingPrice')} />
          </Field>
          <Field label="GST rate" htmlFor={id('taxRateId')} error={err('taxRateId')}>
            <Select
              id={id('taxRateId')}
              placeholder={taxRates.isLoading ? 'Loading...' : 'No tax rate'}
              options={(taxRates.data ?? []).map((t) => ({ value: t.id, label: `${t.name} (${Number(t.gstRate)}%)` }))}
              error={Boolean(errors.taxRateId)}
              {...register('taxRateId')}
            />
          </Field>
          <Field label="HSN code" htmlFor={id('hsnId')} error={err('hsnId')}>
            <Select
              id={id('hsnId')}
              placeholder={hsn.isLoading ? 'Loading...' : 'None'}
              options={(hsn.data ?? []).filter((h) => h.kind === 'HSN').map((h) => ({ value: h.id, label: h.description ? `${h.code} - ${h.description}` : h.code }))}
              error={Boolean(errors.hsnId)}
              {...register('hsnId')}
            />
          </Field>
          <Field label="Reorder level" htmlFor={id('reorderLevel')} error={err('reorderLevel')}>
            <Input id={id('reorderLevel')} sanitize="integer" className="tabular" error={Boolean(errors.reorderLevel)} {...register('reorderLevel')} />
          </Field>
        </div>
      )}
      {sections.advanced && (
        <div className="grid grid-cols-1 gap-4">
          <Field label="Serial number pattern" htmlFor={id('serialPattern')} error={err('serialPattern')} hint="Optional pattern the receiving team checks serial numbers against">
            <Input id={id('serialPattern')} maxLength={200} className="font-mono" error={Boolean(errors.serialPattern)} {...register('serialPattern')} />
          </Field>
          <Field label="Description" htmlFor={id('description')} error={err('description')}>
            <Textarea id={id('description')} rows={3} maxLength={2000} error={Boolean(errors.description)} {...register('description')} />
          </Field>
        </div>
      )}
    </div>
  );
}
