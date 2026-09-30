import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Button, Modal } from '../../../components/ui';
import { toApiError, type ApiError } from '../../../lib/api';
import { applyServerErrors, summarizeErrors } from '../../../lib/validation';
import { usePatchLaptop, usePatchProduct } from '../hooks';
import type { LaptopPatch, LaptopSpecIdKey, Product, ProductPatch } from '../types';
import { EMPTY_SPEC_IDS, LaptopSpecSelects, useSpecPreview, type SpecIdValues } from './LaptopSpecSelects';
import { LaptopDetailsFields, laptopDetailsPayload, laptopFormDefaults, type LaptopFormValues } from './LaptopDetailsFields';
import { LaptopPreviewPanel, isDuplicate } from './LaptopPreviewPanel';

const SPEC_KEYS = Object.keys(EMPTY_SPEC_IDS) as LaptopSpecIdKey[];

function conflictMessage(e: ApiError, onConflict: () => void): string | null {
  if (e.status === 409) {
    onConflict();
    return 'Someone else changed this configuration. The latest version has been loaded; review and try again.';
  }
  return null;
}

/** Change the eight specifications of a DRAFT configuration (PATCH /laptops/:id, If-Match). */
export function EditSpecsModal({ open, onClose, product, onConflict }: { open: boolean; onClose: () => void; product: Product; onConflict: () => void }) {
  const patch = usePatchLaptop();
  const initial: SpecIdValues = { ...EMPTY_SPEC_IDS, ...(product.specIds ?? {}) };
  const [value, setValue] = useState<SpecIdValues>(initial);
  const [errors, setErrors] = useState<Partial<Record<LaptopSpecIdKey, string>>>({});
  const preview = useSpecPreview(value);
  const duplicate = isDuplicate(preview, product.id);

  useEffect(() => {
    if (open) {
      setValue({ ...EMPTY_SPEC_IDS, ...(product.specIds ?? {}) });
      setErrors({});
    }
  }, [open, product.specIds]);

  const changed = SPEC_KEYS.filter((k) => value[k] !== initial[k]);
  const merged = Object.fromEntries(SPEC_KEYS.map((k) => [k, errors[k] ?? preview.fieldErrors[k]])) as Partial<Record<LaptopSpecIdKey, string>>;

  const save = async () => {
    if (changed.length === 0) {
      onClose();
      return;
    }
    const body: LaptopPatch = Object.fromEntries(changed.map((k) => [k, value[k]]));
    try {
      await patch.mutateAsync({ id: product.id, patch: body, version: product.version });
      toast.success('Specifications updated');
      onClose();
    } catch (err) {
      const e = toApiError(err);
      const conflict = conflictMessage(e, onConflict);
      if (conflict) {
        toast.error(conflict);
        onClose();
        return;
      }
      const next: Partial<Record<LaptopSpecIdKey, string>> = {};
      for (const d of e.details) if (d.path && (SPEC_KEYS as string[]).includes(d.path)) next[d.path as LaptopSpecIdKey] = d.message;
      setErrors(next);
      toast.error(e.message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Edit specifications"
      description="Specifications can change only while the configuration is a draft. The SKU (and the default name) are regenerated from the new specifications."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={patch.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={patch.isPending} disabled={duplicate || !preview.allChosen}>
            Save specifications
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <LaptopSpecSelects
          value={value}
          onChange={(next, key) => {
            setValue(next);
            setErrors((prev) => ({ ...prev, [key]: undefined, ...(key === 'brandId' ? { modelId: undefined } : {}) }));
          }}
          errors={merged}
          disabled={patch.isPending}
          idPrefix="edit"
        />
        {changed.length > 0 && <LaptopPreviewPanel preview={preview} selfId={product.id} showSku={false} />}
      </div>
    </Modal>
  );
}

/** Name, SKU, prices, tax, HSN and notes; always editable (PATCH /laptops/:id or /products/:id for legacy items). */
export function EditDetailsModal({ open, onClose, product, onConflict }: { open: boolean; onClose: () => void; product: Product; onConflict: () => void }) {
  const patchLaptop = usePatchLaptop();
  const patchProduct = usePatchProduct();
  const pending = patchLaptop.isPending || patchProduct.isPending;
  const { register, handleSubmit, reset, setValue, setError, formState: { errors, isSubmitting } } = useForm<LaptopFormValues>({ defaultValues: laptopFormDefaults(product) });

  useEffect(() => {
    if (open) reset(laptopFormDefaults(product));
  }, [open, product, reset]);

  const submit = handleSubmit(async (v) => {
    const body = laptopDetailsPayload(v, 'patch');
    try {
      if (product.isLaptop) await patchLaptop.mutateAsync({ id: product.id, patch: body, version: product.version });
      else await patchProduct.mutateAsync({ id: product.id, patch: body as ProductPatch, version: product.version });
      toast.success(`${v.sku || product.sku} updated`);
      onClose();
    } catch (err) {
      const e = toApiError(err);
      const conflict = conflictMessage(e, onConflict);
      if (conflict) {
        toast.error(conflict);
        onClose();
        return;
      }
      toast.error(summarizeErrors(applyServerErrors(setError, e), e.message));
    }
  });
  const busy = pending || isSubmitting;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Edit pricing and details"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        <LaptopDetailsFields register={register} errors={errors} setValue={setValue} idPrefix="edit" />
      </form>
    </Modal>
  );
}
