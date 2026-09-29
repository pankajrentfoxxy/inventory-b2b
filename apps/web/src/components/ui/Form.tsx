import { forwardRef, useId, type ChangeEvent, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import { sanitizeInput, type InputSanitizer } from '@b2b/shared';
import { cn } from '../../lib/utils';

/* ---- Field wrapper ------------------------------------------------------- */

export interface FieldProps {
  label?: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  className?: string;
  htmlFor?: string;
  children: ReactNode;
  inline?: boolean;
}

export function Field({ label, required, hint, error, className, htmlFor, children, inline }: FieldProps) {
  return (
    <div className={cn(inline ? 'grid grid-cols-1 md:grid-cols-[180px_1fr] md:items-start gap-1 md:gap-4' : 'flex flex-col gap-1', className)}>
      {label !== undefined && (
        <label htmlFor={htmlFor} className={cn('text-xs font-medium text-slate-600 flex items-center gap-1', inline && 'md:pt-2.5', error && 'text-red-600')}>
          {label}
          {required && <span className="text-red-500" aria-hidden="true">*</span>}
          {hint && (
            <span className="text-slate-400" title={typeof hint === 'string' ? hint : undefined}>
              <Info className="w-3.5 h-3.5" />
            </span>
          )}
        </label>
      )}
      <div className="min-w-0">
        {children}
        {error && (
          <p className="text-xs text-red-600 mt-1" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/* ---- controls ------------------------------------------------------------ */

const controlBase =
  'w-full h-9 rounded-lg border bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 transition-colors disabled:bg-slate-50 disabled:text-slate-500 read-only:bg-slate-50';
const controlTone = (error?: boolean) =>
  error ? 'border-red-400 focus:border-red-500' : 'border-slate-300 hover:border-slate-400 focus:border-brand-500';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  error?: boolean;
  prefix?: ReactNode;
  suffix?: ReactNode;
  /**
   * Typing-time filter from the shared validation system (digits, mobile, gstin, decimal, ...).
   * Invalid characters are removed before react-hook-form or local state sees the value; the
   * zod schema still validates on blur / submit and the API validates again.
   */
  sanitize?: InputSanitizer;
}

/** Default inputMode per sanitizer so mobile keyboards match the accepted characters. */
const SANITIZER_INPUT_MODE: Partial<Record<InputSanitizer, InputHTMLAttributes<HTMLInputElement>['inputMode']>> = {
  digits: 'numeric',
  integer: 'numeric',
  mobile: 'tel',
  phone: 'tel',
  pincode: 'numeric',
  hsn: 'numeric',
  accountNumber: 'numeric',
  decimal: 'decimal',
  signedDecimal: 'decimal',
  email: 'email',
  url: 'url',
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, error, prefix, suffix, sanitize, onChange, inputMode, ...props }, ref) {
  const handleChange = sanitize
    ? (e: ChangeEvent<HTMLInputElement>) => {
        const clean = sanitizeInput(sanitize, e.target.value);
        if (clean !== e.target.value) e.target.value = clean;
        onChange?.(e);
      }
    : onChange;
  const mode = inputMode ?? (sanitize ? SANITIZER_INPUT_MODE[sanitize] : undefined);
  const upperKinds: InputSanitizer[] = ['gstin', 'pan', 'ifsc', 'code', 'upper'];
  const shared = { ...props, ref, onChange: handleChange, inputMode: mode, autoCapitalize: props.autoCapitalize ?? (sanitize && upperKinds.includes(sanitize) ? 'characters' : undefined) };
  if (prefix || suffix) {
    return (
      <div className={cn('flex items-stretch rounded-lg border bg-white overflow-hidden', controlTone(error), props.disabled && 'bg-slate-50')}>
        {prefix && <span className="flex items-center px-3 text-sm text-slate-500 bg-slate-50 border-r border-slate-200">{prefix}</span>}
        <input className={cn('flex-1 min-w-0 h-9 px-3 text-sm bg-transparent placeholder:text-slate-400 outline-none disabled:text-slate-500', className)} {...shared} />
        {suffix && <span className="flex items-center px-3 text-sm text-slate-500">{suffix}</span>}
      </div>
    );
  }
  return <input className={cn(controlBase, controlTone(error), className)} {...shared} />;
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
  placeholder?: string;
  options: { value: string; label: string; disabled?: boolean }[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, error, placeholder, options, ...props }, ref) {
  return (
    <div className="relative">
      <select ref={ref} className={cn(controlBase, controlTone(error), 'appearance-none pr-9', className)} {...props}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
    </div>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, error, rows = 4, ...props }, ref) {
  return <textarea ref={ref} rows={rows} className={cn(controlBase, controlTone(error), 'h-auto py-2 resize-y', className)} {...props} />;
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  description?: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, description, className, id, ...props }, ref) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <label htmlFor={inputId} className={cn('flex items-start gap-2.5 cursor-pointer select-none', props.disabled && 'opacity-60 cursor-not-allowed', className)}>
      <input ref={ref} id={inputId} type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" {...props} />
      <span className="text-sm text-slate-700">
        {label}
        {description && <span className="block text-xs text-slate-500">{description}</span>}
      </span>
    </label>
  );
});

export function RadioPill<T extends string>({ value, onChange, options, name }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; name: string }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('px-3 h-7 text-xs font-medium rounded-md transition-colors', value === o.value ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Section wrapper for grouped form fields. */
export function FormSection({ title, description, children, className }: { title?: string; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-4', className)}>
      {(title || description) && (
        <div>
          {title && <h3 className="text-sm font-semibold text-slate-900">{title}</h3>}
          {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
        </div>
      )}
      {children}
    </section>
  );
}
