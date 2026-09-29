import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ComboboxProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  options: string[];
  placeholder?: string;
  error?: boolean;
  disabled?: boolean;
  className?: string;
}

/** Free-text input with a list of suggested values (Zoho-style "select or type to add"). */
export function Combobox({ id, value, onChange, onBlur, options, placeholder, error, disabled, className }: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const select = (v: string) => {
    onChange(v);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!options.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a <= 0 ? options.length - 1 : a - 1));
    } else if (e.key === 'Enter' && open && active >= 0) {
      e.preventDefault();
      select(options[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={root} className={cn('relative', className)}>
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => options.length && setOpen(true)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        className={cn(
          'w-full h-9 rounded-lg border bg-white pl-3 pr-9 text-sm text-slate-900 placeholder:text-slate-400 transition-colors disabled:bg-slate-50',
          error ? 'border-red-400 focus:border-red-500' : 'border-slate-300 hover:border-slate-400 focus:border-brand-500',
        )}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={open ? 'Hide suggestions' : 'Show suggestions'}
        disabled={disabled || options.length === 0}
        onClick={() => setOpen((o) => !o)}
        className="absolute right-0 top-0 h-9 w-9 flex items-center justify-center text-slate-400 hover:text-slate-700 disabled:opacity-40"
      >
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && options.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 w-full max-h-60 overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg py-1">
          {options.map((opt, i) => {
            const selected = opt === value;
            return (
              <li
                key={opt}
                role="option"
                aria-selected={selected}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(opt)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'flex items-center justify-between gap-2 px-3 py-2 text-sm cursor-pointer',
                  i === active ? 'bg-slate-100' : selected ? 'bg-slate-50' : '',
                  'text-slate-800',
                )}
              >
                <span className="truncate">{opt}</span>
                {selected && <Check className="w-4 h-4 text-brand-600 shrink-0" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
