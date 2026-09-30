import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Button, Field, Input, Modal, Select } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { applyServerErrors, summarizeErrors } from '../../../lib/validation';
import { useCreateSpec, useLaptopSpecs } from '../hooks';
import type { SpecKind } from '../types';

interface Values {
  name: string;
  code: string;
  brandId: string;
}

export interface SpecOptionFormModalProps {
  open: boolean;
  onClose: () => void;
  kind: SpecKind;
  /** Singular label ("Processor", "Screen size"). */
  label: string;
  /** Pre-selected brand for a new model (the Model card's brand filter). */
  defaultBrandId?: string;
}

/** Add one value to a laptop specification master (name, SKU code, brand for models). */
export function SpecOptionFormModal({ open, onClose, kind, label, defaultBrandId = '' }: SpecOptionFormModalProps) {
  const isModel = kind === 'MODEL';
  const brands = useLaptopSpecs({ kind: 'BRAND' }, open && isModel);
  const create = useCreateSpec();
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<Values>({ defaultValues: { name: '', code: '', brandId: defaultBrandId } });

  useEffect(() => {
    if (open) reset({ name: '', code: '', brandId: defaultBrandId });
  }, [open, defaultBrandId, reset]);

  const submit = handleSubmit(async (values) => {
    try {
      const saved = await create.mutateAsync({
        kind,
        name: values.name.trim(),
        code: values.code.trim() || undefined,
        brandId: isModel ? values.brandId || undefined : undefined,
      });
      toast.success(`${saved.name} added (code ${saved.code})`);
      onClose();
    } catch (err) {
      const e = toApiError(err);
      toast.error(summarizeErrors(applyServerErrors(setError, e, { mapPath: (p) => (p === 'kind' || p === 'sortOrder' ? null : p) }), e.message));
    }
  });
  const busy = create.isPending || isSubmitting;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`New ${label.toLowerCase()}`}
      description="Values are picked when you create a laptop configuration."
      size="sm"
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
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate className="space-y-4">
        {isModel && (
          <Field label="Brand" required htmlFor="spec-brand" error={errors.brandId?.message}>
            <Select
              id="spec-brand"
              placeholder={brands.isLoading ? 'Loading brands...' : 'Select a brand'}
              options={(brands.data ?? []).map((b) => ({ value: b.id, label: b.name }))}
              error={Boolean(errors.brandId)}
              {...register('brandId')}
            />
          </Field>
        )}
        <Field label="Name" required htmlFor="spec-name" error={errors.name?.message}>
          <Input id="spec-name" autoFocus maxLength={100} sanitize="singleLine" error={Boolean(errors.name)} {...register('name')} />
        </Field>
        <Field label="Code" htmlFor="spec-code" error={errors.code?.message}>
          <Input id="spec-code" maxLength={20} sanitize="upper" className="font-mono" placeholder="e.g. I5" error={Boolean(errors.code)} {...register('code')} />
          <p className="text-xs text-slate-500 mt-1">Used in the SKU, e.g. I5; leave blank to derive it from the name.</p>
        </Field>
      </form>
    </Modal>
  );
}
