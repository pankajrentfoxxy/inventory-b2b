import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, X } from 'lucide-react';
import { Button, Checkbox, Field, IconButton, Input, Modal, Select } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { ProductPicker } from '../../procurement/components/pickers';
import { useCreateChecklist } from '../hooks';
import type { ChecklistInput, ChecklistItemKind } from '../types';

interface ItemDraft {
  label: string;
  kind: ChecklistItemKind;
  critical: boolean;
  minValue: string;
  maxValue: string;
}
const KINDS: { value: ChecklistItemKind; label: string }[] = [
  { value: 'PASS_FAIL', label: 'Pass / fail' },
  { value: 'NUMERIC', label: 'Numeric' },
  { value: 'TEXT', label: 'Text' },
  { value: 'PHOTO', label: 'Photo' },
];
const emptyItem = (): ItemDraft => ({ label: '', kind: 'PASS_FAIL', critical: false, minValue: '', maxValue: '' });

/** Create a checklist: name, which products it applies to (or default), and its items. */
export function ChecklistFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateChecklist();
  const [name, setName] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [products, setProducts] = useState<{ id: string; label: string }[]>([]);
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setName('');
    setIsDefault(false);
    setProducts([]);
    setItems([emptyItem()]);
    setErrors({});
  }, [open]);

  const updateItem = (i: number, patch: Partial<ItemDraft>) => setItems((prev) => prev.map((it, k) => (k === i ? { ...it, ...patch } : it)));

  const submit = async () => {
    const payload: ChecklistInput = {
      name: name.trim(),
      appliesTo: { itemIds: products.map((p) => p.id), categoryIds: [], isDefault },
      items: items.map((it) => ({ label: it.label.trim(), kind: it.kind, critical: it.critical, minValue: it.kind === 'NUMERIC' && it.minValue.trim() !== '' ? Number(it.minValue) : null, maxValue: it.kind === 'NUMERIC' && it.maxValue.trim() !== '' ? Number(it.maxValue) : null })),
    };
    setErrors({});
    try {
      const saved = await create.mutateAsync(payload);
      toast.success(`Checklist ${saved.name} created`);
      onClose();
    } catch (err) {
      const e = toApiError(err);
      setErrors(e.fieldErrors);
      toast.error(e.message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New checklist"
      description="Items are answered per unit during inspection. A failed critical item fails the unit."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={create.isPending} disabled={!name.trim() || items.length === 0}>
            Create checklist
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" required error={errors.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} sanitize="singleLine" autoFocus error={Boolean(errors.name)} />
        </Field>
        <Checkbox label="Default checklist" description="Used for every product that has no product-specific checklist." checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
        <Field label="Applies to products" hint="Pick products one at a time; leave empty for a default-only checklist" error={errors['appliesTo.itemIds']}>
          <ProductPicker value="" placeholder="Add a product" onChange={(id, p) => id && p && !products.some((x) => x.id === id) && setProducts([...products, { id, label: `${p.name} (${p.sku})` }])} />
          {products.length > 0 && (
            <ul className="flex flex-wrap gap-1.5 mt-2">
              {products.map((p) => (
                <li key={p.id} className="inline-flex items-center gap-1 rounded-full bg-brand-50 text-brand-700 px-2.5 py-1 text-xs">
                  {p.label}
                  <button type="button" onClick={() => setProducts(products.filter((x) => x.id !== p.id))} aria-label={`Remove ${p.label}`} className="hover:text-brand-900">
                    <X className="w-3 h-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Field>

        <div>
          <p className="text-xs font-medium text-slate-600 mb-2">Items</p>
          <ul className="space-y-2">
            {items.map((it, i) => (
              <li key={i} className="rounded-lg border border-slate-200 p-3 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_150px_auto] gap-2 items-start">
                  <Field error={errors[`items.${i}.label`]}>
                    <Input value={it.label} onChange={(e) => updateItem(i, { label: e.target.value })} placeholder={`Item ${i + 1} label`} maxLength={200} error={Boolean(errors[`items.${i}.label`])} aria-label={`Item ${i + 1} label`} />
                  </Field>
                  <Select value={it.kind} onChange={(e) => updateItem(i, { kind: e.target.value as ChecklistItemKind })} options={KINDS} aria-label="Item kind" />
                  <IconButton icon={Trash2} label="Remove item" disabled={items.length === 1} onClick={() => setItems(items.filter((_, k) => k !== i))} className="text-slate-400 hover:text-red-600" />
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <Checkbox label="Critical" description="A failing answer fails the unit" checked={it.critical} onChange={(e) => updateItem(i, { critical: e.target.checked })} />
                  {it.kind === 'NUMERIC' && (
                    <div className="flex items-center gap-2">
                      <Input sanitize="signedDecimal" value={it.minValue} onChange={(e) => updateItem(i, { minValue: e.target.value })} placeholder="Min" className="w-24 tabular" aria-label="Minimum" error={Boolean(errors[`items.${i}.minValue`])} />
                      <span className="text-xs text-slate-500">to</span>
                      <Input sanitize="signedDecimal" value={it.maxValue} onChange={(e) => updateItem(i, { maxValue: e.target.value })} placeholder="Max" className="w-24 tabular" aria-label="Maximum" error={Boolean(errors[`items.${i}.maxValue`])} />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {errors.items && <p className="text-xs text-red-600 mt-1">{errors.items}</p>}
          <Button variant="secondary" size="sm" icon={Plus} className="mt-2" onClick={() => setItems([...items, emptyItem()])} disabled={items.length >= 100}>
            Add item
          </Button>
        </div>
      </div>
    </Modal>
  );
}
