import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Button, Card, CardBody, CardHeader, PageHeader } from '../../../components/ui';
import { shouldRetryWithSameKey, useIdempotencyKey } from '../../../hooks/useIdempotencyKey';
import { toApiError } from '../../../lib/api';
import { applyServerErrors, summarizeErrors } from '../../../lib/validation';
import { useCreateLaptop } from '../hooks';
import type { LaptopPayload, LaptopSpecIdKey } from '../types';
import { LaptopSpecSelects, useSpecPreview, type SpecIdValues } from '../components/LaptopSpecSelects';
import { LaptopDetailsFields, laptopDetailsPayload, laptopFormDefaults, type LaptopFormValues } from '../components/LaptopDetailsFields';
import { LaptopPreviewPanel, isDuplicate } from '../components/LaptopPreviewPanel';

const SPEC_KEYS: LaptopSpecIdKey[] = ['brandId', 'modelId', 'generationId', 'processorId', 'ramId', 'ssdId', 'gpuId', 'screenSizeId'];

/** New laptop configuration: eight specs -> generated SKU (duplicate-checked), then prices and tax. */
export function LaptopCreatePage() {
  const navigate = useNavigate();
  const create = useCreateLaptop();
  const idem = useIdempotencyKey();
  const { register, handleSubmit, setValue, watch, setError, clearErrors, formState: { errors, isSubmitting } } = useForm<LaptopFormValues>({ defaultValues: laptopFormDefaults() });

  const values = watch();
  const specValues: SpecIdValues = { brandId: values.brandId, modelId: values.modelId, generationId: values.generationId, processorId: values.processorId, ramId: values.ramId, ssdId: values.ssdId, gpuId: values.gpuId, screenSizeId: values.screenSizeId };
  const preview = useSpecPreview(specValues);
  const duplicate = isDuplicate(preview);

  const specErrors = Object.fromEntries(SPEC_KEYS.map((k) => [k, (errors[k]?.message as string | undefined) ?? preview.fieldErrors[k]])) as Partial<Record<LaptopSpecIdKey, string>>;

  const onSpecsChange = (next: SpecIdValues) => {
    for (const k of SPEC_KEYS) {
      if (next[k] !== values[k]) {
        setValue(k, next[k], { shouldDirty: true });
        clearErrors(k);
      }
    }
  };

  const save = (activate: boolean) =>
    handleSubmit(async (v) => {
      const payload: LaptopPayload = { ...laptopDetailsPayload(v, 'create'), brandId: v.brandId, modelId: v.modelId, generationId: v.generationId, processorId: v.processorId, ramId: v.ramId, ssdId: v.ssdId, gpuId: v.gpuId, screenSizeId: v.screenSizeId, activate };
      try {
        const saved = await create.mutateAsync({ payload, idempotencyKey: idem.keyFor(payload) });
        idem.reset();
        toast.success(`${saved.sku} created${activate ? ' and activated' : ' as draft'}`);
        navigate(`/masters/products/${saved.id}`, { replace: true });
      } catch (err) {
        const e = toApiError(err);
        if (!shouldRetryWithSameKey(e.status)) idem.reset();
        toast.error(summarizeErrors(applyServerErrors(setError, e), e.message));
      }
    })();

  const busy = create.isPending || isSubmitting;

  return (
    <>
      <PageHeader
        title="New laptop configuration"
        subtitle="One purchasable variant, identified by its eight specifications. The SKU is generated from the brand, model, processor, RAM and SSD codes."
        breadcrumbs={[{ label: 'Masters' }, { label: 'Laptop configurations', to: '/masters/products' }, { label: 'New' }]}
      />
      <form onSubmit={(e) => { e.preventDefault(); void save(false); }} noValidate className="space-y-4">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card className="xl:col-span-2">
            <CardHeader title="Specifications" description="All eight are required. Missing a value? Add it under Masters > Laptop specifications." />
            <CardBody>
              <LaptopSpecSelects value={specValues} onChange={onSpecsChange} errors={specErrors} disabled={busy} idPrefix="new" />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Generated" />
            <CardBody>
              <LaptopPreviewPanel preview={preview} />
            </CardBody>
          </Card>
        </div>
        <Card>
          <CardHeader title="Identity" description="Optional overrides of the generated SKU and name." />
          <CardBody>
            <LaptopDetailsFields register={register} errors={errors} setValue={setValue} generated={preview.data ?? undefined} sections={{ identity: true }} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Pricing and tax" description="GST defaults to 18%." />
          <CardBody>
            <LaptopDetailsFields register={register} errors={errors} setValue={setValue} defaultTax sections={{ pricing: true }} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Advanced" />
          <CardBody>
            <LaptopDetailsFields register={register} errors={errors} setValue={setValue} sections={{ advanced: true }} />
          </CardBody>
        </Card>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {duplicate && <span className="text-sm text-amber-700 mr-auto">This configuration already exists; open it instead of creating a duplicate.</span>}
          <Button variant="secondary" onClick={() => navigate('/masters/products')} disabled={busy}>
            Cancel
          </Button>
          <Button variant="secondary" type="submit" loading={busy} disabled={duplicate}>
            Save as draft
          </Button>
          <Button onClick={() => void save(true)} loading={busy} disabled={duplicate}>
            Save and activate
          </Button>
        </div>
      </form>
    </>
  );
}
