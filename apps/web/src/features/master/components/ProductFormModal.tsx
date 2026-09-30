import { useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Lock } from 'lucide-react';
import { Button, Checkbox, Field, FormSection, Input, Modal, RadioPill, Select, Textarea } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { applyServerErrors, summarizeErrors } from '../../../lib/validation';
import { useIdempotencyKey, shouldRetryWithSameKey } from '../../../hooks/useIdempotencyKey';
import { useCreateProduct, usePatchProduct, useSimpleMaster } from '../hooks';
import type { Product, ProductDetail, ProductPatch, ProductPayload, ProductType } from '../types';

interface ProductFormValues {
  sku: string;
  name: string;
  description: string;
  type: ProductType;
  trackInventory: boolean;
  isSerialized: boolean;
  requiresImei: boolean;
  serialPattern: string;
  qcRequired: boolean;
  unitId: string;
  categoryId: string;
  brandId: string;
  hsnId: string;
  taxRateId: string;
  defaultWarrantyId: string;
  purchasePrice: string;
  sellingPrice: string;
  reorderLevel: string;
  activate: boolean;
}

const num = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

function toValues(p?: Product | null): ProductFormValues {
  return {
    sku: p?.sku ?? '',
    name: p?.name ?? '',
    description: p?.description ?? '',
    type: p?.type ?? 'GOODS',
    trackInventory: p?.trackInventory ?? true,
    isSerialized: p?.isSerialized ?? false,
    requiresImei: p?.requiresImei ?? false,
    serialPattern: p?.serialPattern ?? '',
    qcRequired: p?.qcRequired ?? true,
    unitId: p?.unitId ?? '',
    categoryId: p?.categoryId ?? '',
    brandId: p?.brandId ?? '',
    hsnId: p?.hsnId ?? '',
    taxRateId: p?.taxRateId ?? '',
    defaultWarrantyId: p?.defaultWarrantyId ?? '',
    purchasePrice: num(p?.purchasePrice),
    sellingPrice: num(p?.sellingPrice),
    reorderLevel: num(p?.reorderLevel),
    activate: false,
  };
}

const toNumber = (v: string) => (v.trim() === '' ? null : Number(v));
const toId = (v: string) => (v ? v : null);

function toPayload(v: ProductFormValues): ProductPayload {
  const service = v.type === 'SERVICE';
  return {
    sku: v.sku.trim(),
    name: v.name.trim(),
    description: v.description.trim() || null,
    type: v.type,
    trackInventory: service ? false : v.trackInventory,
    isSerialized: service ? false : v.isSerialized,
    requiresImei: service ? false : v.requiresImei,
    serialPattern: v.serialPattern.trim() || null,
    qcRequired: service ? false : v.qcRequired,
    unitId: v.unitId,
    categoryId: toId(v.categoryId),
    brandId: toId(v.brandId),
    hsnId: toId(v.hsnId),
    taxRateId: toId(v.taxRateId),
    defaultWarrantyId: toId(v.defaultWarrantyId),
    purchasePrice: toNumber(v.purchasePrice),
    sellingPrice: toNumber(v.sellingPrice),
    reorderLevel: toNumber(v.reorderLevel),
    activate: v.activate,
  };
}

/** Only the fields that differ from the stored product go on the wire (PATCH + If-Match). */
function toPatch(payload: ProductPayload, current: Product, locked: string[]): ProductPatch {
  const patch: ProductPatch = {};
  const source = payload as unknown as Record<string, unknown>;
  const before = current as unknown as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (key === 'activate' || locked.includes(key)) continue;
    if (JSON.stringify(source[key]) !== JSON.stringify(before[key] ?? null)) (patch as Record<string, unknown>)[key] = source[key];
  }
  return patch;
}

export interface ProductFormModalProps {
  open: boolean;
  onClose: () => void;
  /** Edit mode when set; lockedFields (from the detail endpoint) disable the frozen inputs. */
  product?: ProductDetail | Product | null;
  onSaved?: (product: Product) => void;
}

/** Create / edit a product. Rules: services never track stock; serialized implies tracked; IMEI implies serialized. */
export function ProductFormModal({ open, onClose, product, onSaved }: ProductFormModalProps) {
  const isEdit = Boolean(product);
  const locked = (product && 'lockedFields' in product ? product.lockedFields : []) ?? [];
  const units = useSimpleMaster('units', false, open);
  const categories = useSimpleMaster('categories', false, open);
  const brands = useSimpleMaster('brands', false, open);
  const hsnCodes = useSimpleMaster('hsn-codes', false, open);
  const taxRates = useSimpleMaster('tax-rates', false, open);
  const warranties = useSimpleMaster('warranty-policies', false, open);
  const create = useCreateProduct();
  const patch = usePatchProduct();
  const idem = useIdempotencyKey();

  const defaults = useMemo(() => toValues(product), [product]);
  const form = useForm<ProductFormValues>({ defaultValues: defaults });
  const { register, control, handleSubmit, reset, setError, setValue, watch, formState: { errors } } = form;

  useEffect(() => {
    if (open) reset(defaults);
  }, [open, defaults, reset]);

  const type = watch('type');
  const trackInventory = watch('trackInventory');
  const isSerialized = watch('isSerialized');
  const requiresImei = watch('requiresImei');
  const isService = type === 'SERVICE';

  // Consistency rules mirrored from the service (it validates them again).
  useEffect(() => {
    if (isService) {
      if (trackInventory) setValue('trackInventory', false);
      if (isSerialized) setValue('isSerialized', false);
      if (requiresImei) setValue('requiresImei', false);
    }
  }, [isService, trackInventory, isSerialized, requiresImei, setValue]);
  useEffect(() => {
    if (requiresImei && !isSerialized) setValue('isSerialized', true);
  }, [requiresImei, isSerialized, setValue]);
  useEffect(() => {
    if (isSerialized && !trackInventory) setValue('trackInventory', true);
  }, [isSerialized, trackInventory, setValue]);

  const isLocked = (field: string) => locked.includes(field);
  const lockHint = (field: string) => (isLocked(field) ? 'Locked: this item already has stock movements' : undefined);

  const submit = handleSubmit(async (values) => {
    const payload = toPayload(values);
    try {
      let saved: Product;
      if (product) {
        const diff = toPatch(payload, product, locked);
        if (Object.keys(diff).length === 0) {
          toast.success('No changes to save');
          onClose();
          return;
        }
        saved = await patch.mutateAsync({ id: product.id, patch: diff, version: product.version });
        toast.success(`${saved.name} updated`);
      } else {
        saved = await create.mutateAsync({ payload, idempotencyKey: idem.keyFor(payload) });
        idem.reset();
        toast.success(payload.activate ? `${saved.name} created and activated` : `${saved.name} saved as draft`);
      }
      onSaved?.(saved);
      onClose();
    } catch (err) {
      const e = toApiError(err);
      if (!shouldRetryWithSameKey(e.status)) idem.reset();
      if (e.code === 'VERSION_CONFLICT') {
        toast.error('This product was changed by someone else. Close the dialog and reopen it to see the latest version.');
        return;
      }
      toast.error(summarizeErrors(applyServerErrors(setError, e), e.message));
    }
  });

  const saving = create.isPending || patch.isPending;
  const opt = <T extends { id: string }>(rows: T[] | undefined, label: (r: T) => string) => (rows ?? []).map((r) => ({ value: r.id, label: label(r) }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product ? `Edit ${product.name}` : 'New Product'}
      description={product ? `SKU ${product.sku} - version ${product.version}` : 'Products are the goods and services you buy, stock and sell.'}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={saving}>
            {product ? 'Save Changes' : 'Save Product'}
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate className="space-y-6">
        {locked.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <Lock className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              This item has stock movements, so <strong>{locked.join(', ')}</strong> can no longer change.
            </span>
          </div>
        )}
        <FormSection title="Identity">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="SKU" required htmlFor="p-sku" error={errors.sku?.message} hint="Unique per organisation. Letters, digits, dot, underscore, slash and dash.">
              <Input id="p-sku" autoFocus={!product} sanitize="code" maxLength={40} className="font-mono" error={Boolean(errors.sku)} {...register('sku')} />
            </Field>
            <Field label="Name" required htmlFor="p-name" error={errors.name?.message}>
              <Input id="p-name" sanitize="singleLine" maxLength={200} error={Boolean(errors.name)} {...register('name')} />
            </Field>
            <Field label="Type" error={errors.type?.message} hint={lockHint('type')}>
              <Controller control={control} name="type" render={({ field }) => (
                <div className={isLocked('type') ? 'opacity-60 pointer-events-none' : undefined}>
                  <RadioPill name="Product type" value={field.value} onChange={field.onChange} options={[{ value: 'GOODS', label: 'Goods' }, { value: 'SERVICE', label: 'Service' }]} />
                </div>
              )} />
            </Field>
            <Field label="Unit" required htmlFor="p-unit" error={errors.unitId?.message} hint={lockHint('unitId')}>
              <Select id="p-unit" placeholder={units.isLoading ? 'Loading...' : 'Select a unit'} disabled={isLocked('unitId')} options={opt(units.data, (u) => `${u.code} - ${u.name}`)} error={Boolean(errors.unitId)} {...register('unitId')} />
            </Field>
            <Field label="Description" htmlFor="p-desc" error={errors.description?.message} className="md:col-span-2">
              <Textarea id="p-desc" rows={2} maxLength={2000} error={Boolean(errors.description)} {...register('description')} />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Inventory" description="Services never track stock. Serialized items are always tracked; IMEI capture needs a serialized item.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <Checkbox label="Track inventory" description={isService ? 'Not available for services' : isSerialized ? 'Required for serialized items' : lockHint('trackInventory') ?? 'Maintain stock levels for this product'} disabled={isService || isSerialized || isLocked('trackInventory')} {...register('trackInventory')} />
              <Checkbox label="Serialized" description={isService ? 'Not available for services' : requiresImei ? 'Required for IMEI capture' : lockHint('isSerialized') ?? 'Each unit has its own serial number'} disabled={isService || requiresImei || isLocked('isSerialized')} {...register('isSerialized')} />
              <Checkbox label="Requires IMEI" description={isService ? 'Not available for services' : 'Serial numbers are validated as IMEI'} disabled={isService} {...register('requiresImei')} />
              <Checkbox label="QC required on receipt" description={isService ? 'Not applicable to services' : 'Goods receipts create a QC lot before stock is released'} disabled={isService} {...register('qcRequired')} />
            </div>
            <div className="space-y-4">
              <Field label="Serial pattern" htmlFor="p-serial" error={errors.serialPattern?.message} hint="Optional template used to validate serial numbers on receipt.">
                <Input id="p-serial" sanitize="singleLine" maxLength={200} className="font-mono" disabled={isService || !isSerialized} error={Boolean(errors.serialPattern)} {...register('serialPattern')} />
              </Field>
              <Field label="Reorder level" htmlFor="p-reorder" error={errors.reorderLevel?.message}>
                <Input id="p-reorder" sanitize="decimal" className="tabular" disabled={isService || !trackInventory} error={Boolean(errors.reorderLevel)} {...register('reorderLevel')} />
              </Field>
            </div>
          </div>
        </FormSection>

        <FormSection title="Classification and tax">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Category" htmlFor="p-cat" error={errors.categoryId?.message}>
              <Select id="p-cat" placeholder="None" options={opt(categories.data, (c) => c.name)} error={Boolean(errors.categoryId)} {...register('categoryId')} />
            </Field>
            <Field label="Brand" htmlFor="p-brand" error={errors.brandId?.message}>
              <Select id="p-brand" placeholder="None" options={opt(brands.data, (b) => b.name)} error={Boolean(errors.brandId)} {...register('brandId')} />
            </Field>
            <Field label={isService ? 'SAC code' : 'HSN code'} htmlFor="p-hsn" error={errors.hsnId?.message}>
              <Select id="p-hsn" placeholder="None" options={opt(hsnCodes.data, (h) => `${h.code}${h.description ? ` - ${h.description}` : ''}`)} error={Boolean(errors.hsnId)} {...register('hsnId')} />
            </Field>
            <Field label="Tax rate" htmlFor="p-tax" error={errors.taxRateId?.message}>
              <Select id="p-tax" placeholder="None" options={opt(taxRates.data, (t) => `${t.name} (${Number(t.gstRate)}%${Number(t.cessRate) > 0 ? ` + ${Number(t.cessRate)}% cess` : ''})`)} error={Boolean(errors.taxRateId)} {...register('taxRateId')} />
            </Field>
            <Field label="Default warranty" htmlFor="p-warranty" error={errors.defaultWarrantyId?.message}>
              <Select id="p-warranty" placeholder="None" options={opt(warranties.data, (w) => `${w.name} (${w.durationMonths} months)`)} error={Boolean(errors.defaultWarrantyId)} {...register('defaultWarrantyId')} />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Pricing">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Purchase price" htmlFor="p-purchase" error={errors.purchasePrice?.message}>
              <Input id="p-purchase" prefix="INR" sanitize="decimal" className="tabular" error={Boolean(errors.purchasePrice)} {...register('purchasePrice')} />
            </Field>
            <Field label="Selling price" htmlFor="p-selling" error={errors.sellingPrice?.message}>
              <Input id="p-selling" prefix="INR" sanitize="decimal" className="tabular" error={Boolean(errors.sellingPrice)} {...register('sellingPrice')} />
            </Field>
          </div>
        </FormSection>

        {!isEdit && <Checkbox label="Activate immediately" description="Skip the draft stage so the product can be used on documents right away." {...register('activate')} />}
      </form>
    </Modal>
  );
}
