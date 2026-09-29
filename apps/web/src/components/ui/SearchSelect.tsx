import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Loader2, Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SearchSelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface SearchSelectProps {
  id?: string;
  value: string;
  onChange: (value: string, option: SearchSelectOption | null) => void;
  options: SearchSelectOption[];
  /** Called with the typed term (debounced by the caller if needed). */
  onSearch?: (term: string) => void;
  loading?: boolean;
  placeholder?: string;
  /** Label to show when the selected value is not among the current options. */
  selectedLabel?: string;
  error?: boolean;
  disabled?: boolean;
  allowClear?: boolean;
  className?: string;
  /** Rendered at the bottom of the list (e.g. "+ New Vendor"). */
  footer?: (close: () => void) => ReactNode;
  emptyText?: string;
  size?: 'sm' | 'md';
}

/** Zoho-style "Select a Vendor" control: a select that opens a search box with async results. */
export function SearchSelect({ id, value, onChange, options, onSearch, loading, placeholder = 'Select', selectedLabel, error, disabled, allowClear, className, footer, emptyText = 'No matches', size = 'md' }: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value);
  const label = selected?.label ?? (value ? selectedLabel : undefined);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0);
  }, [open]);

  const close = () => {
    setOpen(false);
    setTerm('');
    setActive(-1);
    onSearch?.('');
  };
  const pick = (o: SearchSelectOption) => {
    if (o.disabled) return;
    onChange(o.value, o);
    close();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && options[active]) pick(options[active]);
    } else if (e.key === 'Escape') {
      close();
    }
  };

  const h = size === 'sm' ? 'h-8 text-xs' : 'h-9 text-sm';

  return (
    <div ref={root} className={cn('relative', className)}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(
          'w-full flex items-center gap-2 rounded-lg border bg-white pl-3 pr-2 text-left transition-colors disabled:bg-slate-50 disabled:text-slate-500',
          h,
          error ? 'border-red-400' : 'border-slate-300 hover:border-slate-400',
          open && 'border-brand-500',
        )}
      >
        <span className={cn('flex-1 truncate', label ? 'text-slate-900' : 'text-slate-400')}>{label ?? placeholder}</span>
        {allowClear && value && !disabled && (
          <span
            role="button"
            aria-label="Clear selection"
            onClick={(e) => {
              e.stopPropagation();
              onChange('', null);
            }}
            className="text-slate-400 hover:text-slate-700"
          >
            <X className="w-3.5 h-3.5" />
          </span>
        )}
        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-40 mt-1 w-full min-w-[260px] rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
          {onSearch && (
            <div className="relative border-b border-slate-100">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                ref={input}
                value={term}
                onChange={(e) => {
                  setTerm(e.target.value);
                  setActive(0);
                  onSearch(e.target.value);
                }}
                onKeyDown={onKey}
                placeholder="Type to search"
                aria-label="Search"
                className="w-full h-9 pl-9 pr-8 text-sm outline-none"
              />
              {loading && <Loader2 className="w-4 h-4 text-slate-400 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />}
            </div>
          )}
          <ul id={listId} role="listbox" className="max-h-64 overflow-auto py-1" onKeyDown={onKey}>
            {options.length === 0 && <li className="px-3 py-3 text-sm text-slate-500">{loading ? 'Searching...' : emptyText}</li>}
            {options.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                aria-disabled={o.disabled}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
                className={cn('flex items-start justify-between gap-2 px-3 py-2 text-sm', o.disabled ? 'text-slate-400 cursor-not-allowed' : 'cursor-pointer text-slate-800', i === active && !o.disabled && 'bg-slate-100')}
              >
                <span className="min-w-0">
                  <span className="block truncate">{o.label}</span>
                  {o.description && <span className="block text-xs text-slate-500 truncate">{o.description}</span>}
                </span>
                {o.value === value && <Check className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />}
              </li>
            ))}
          </ul>
          {footer && <div className="border-t border-slate-100 px-2 py-1.5">{footer(close)}</div>}
        </div>
      )}
    </div>
  );
}
