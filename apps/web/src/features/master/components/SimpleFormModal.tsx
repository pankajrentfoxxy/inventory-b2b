import { useEffect, useMemo, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import type { InputSanitizer } from '@b2b/shared';
import { Button, Checkbox, Field, Input, Modal, Select, Textarea } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { applyServerErrors, summarizeErrors } from '../../../lib/validation';
import { cn } from '../../../lib/utils';

interface BaseSpec {
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
  span?: 2;
  defaultValue?: string | boolean;
}
export type FieldSpec =
  | (BaseSpec & { type: 'text'; sanitize?: InputSanitizer; placeholder?: string; maxLength?: number; mono?: boolean })
  | (BaseSpec & { type: 'number'; min?: number; max?: number; step?: number; integer?: boolean; prefix?: string; suffix?: string })
  | (BaseSpec & { type: 'select'; options: { value: string; label: string }[]; placeholder?: string; numeric?: boolean; nullable?: boolean })
  | (BaseSpec & { type: 'checkbox'; description?: string })
  | (BaseSpec & { type: 'date' })
  | (BaseSpec & { type: 'textarea'; maxLength?: number; rows?: number })
  /** One value per line -> string[] */
  | (BaseSpec & { type: 'lines'; rows?: number });

type Values = Record<string, string | boolean>;

function defaultsFor(fields: FieldSpec[]): Values {
  const out: Values = {};
  for (const f of fields) out[f.name] = f.defaultValue ?? (f.type === 'checkbox' ? false : '');
  return out;
}

/** Converts the string/boolean form state into the JSON the service expects. */
export function specToPayload(fields: FieldSpec[], values: Values): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = values[f.name];
    switch (f.type) {
      case 'checkbox':
        out[f.name] = Boolean(raw);
        break;
      case 'number': {
        const s = String(raw ?? '').trim();
        if (s !== '') out[f.name] = Number(s);
        break;
      }
      case 'select': {
        const s = String(raw ?? '');
        if (s === '') {
          if (f.nullable) out[f.name] = null;
        } else out[f.name] = f.numeric ? Number(s) : s;
        break;
      }
      case 'lines': {
        const lines = String(raw ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
        if (lines.length) out[f.name] = lines;
        break;
      }
      default: {
        const s = String(raw ?? '').trim();
        if (s !== '' || f.required) out[f.name] = s;
      }
    }
  }
  return out;
}

export interface SimpleFormModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  fields: FieldSpec[];
  /** Receives the converted payload; throw (axios error) to have field errors mapped back. */
  onSubmit: (payload: Record<string, unknown>, values: Values) => Promise<unknown>;
  submitLabel?: string;
  pending?: boolean;
  successMessage?: string | ((result: unknown) => string);
  /** Rename API error paths to form field names (e.g. "options" -> "optionsText"). */
  mapPath?: (path: string) => string | null;
  size?: 'sm' | 'md' | 'lg';
}

/** Spec-driven modal form for the small masters (units, tax rates, HSN, brands, locations, bins...). */
export function SimpleFormModal({ open, onClose, title, description, fields, onSubmit, submitLabel = 'Save', pending, successMessage, mapPath, size = 'md' }: SimpleFormModalProps) {
  const defaults = useMemo(() => defaultsFor(fields), [fields]);
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<Values>({ defaultValues: defaults });

  useEffect(() => {
    if (open) reset(defaults);
  }, [open, defaults, reset]);

  const submit = handleSubmit(async (values) => {
    try {
      const result = await onSubmit(specToPayload(fields, values), values);
      if (successMessage) toast.success(typeof successMessage === 'function' ? successMessage(result) : successMessage);
      onClose();
    } catch (err) {
      const e = toApiError(err);
      toast.error(summarizeErrors(applyServerErrors(setError, e, { mapPath }), e.message));
    }
  });
  const busy = pending || isSubmitting;
  const errorOf = (name: string) => errors[name]?.message as string | undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size={size}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {fields.map((f, i) => {
          const id = `sf-${f.name}`;
          const wrap = cn(f.span === 2 || f.type === 'textarea' || f.type === 'lines' ? 'sm:col-span-2' : undefined);
          if (f.type === 'checkbox') {
            return (
              <div key={f.name} className={cn(wrap, 'flex items-end pb-1')}>
                <Checkbox id={id} label={f.label} description={f.description} {...register(f.name)} />
                {errorOf(f.name) && <p className="text-xs text-red-600 mt-1">{errorOf(f.name)}</p>}
              </div>
            );
          }
          return (
            <Field key={f.name} label={f.label} required={f.required} hint={f.hint} htmlFor={id} error={errorOf(f.name)} className={wrap}>
              {f.type === 'text' && <Input id={id} autoFocus={i === 0} sanitize={f.sanitize} placeholder={f.placeholder} maxLength={f.maxLength} className={f.mono ? 'font-mono' : undefined} error={Boolean(errors[f.name])} {...register(f.name)} />}
              {f.type === 'number' && <Input id={id} autoFocus={i === 0} sanitize={f.integer ? 'integer' : 'decimal'} prefix={f.prefix} suffix={f.suffix} className="tabular" error={Boolean(errors[f.name])} {...register(f.name)} />}
              {f.type === 'select' && <Select id={id} options={f.options} placeholder={f.placeholder} error={Boolean(errors[f.name])} {...register(f.name)} />}
              {f.type === 'date' && <Input id={id} type="date" error={Boolean(errors[f.name])} {...register(f.name)} />}
              {f.type === 'textarea' && <Textarea id={id} rows={f.rows ?? 3} maxLength={f.maxLength} error={Boolean(errors[f.name])} {...register(f.name)} />}
              {f.type === 'lines' && <Textarea id={id} rows={f.rows ?? 4} placeholder="One value per line" className="font-mono text-[13px]" error={Boolean(errors[f.name])} {...register(f.name)} />}
            </Field>
          );
        })}
      </form>
    </Modal>
  );
}
