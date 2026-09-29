import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface MenuItem {
  key: string;
  label: ReactNode;
  icon?: LucideIcon;
  onSelect: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  hidden?: boolean;
}

/** Lightweight click-to-open menu (no external dependency). */
export function Dropdown({ trigger, items, align = 'right' }: { trigger: (props: { open: boolean; toggle: () => void }) => ReactNode; items: MenuItem[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const visible = items.filter((i) => !i.hidden);
  if (visible.length === 0) return null;

  return (
    <div ref={ref} className="relative inline-block">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div role="menu" className={cn('absolute z-30 mt-1 min-w-[180px] rounded-xl border border-slate-200 bg-white shadow-lg py-1', align === 'right' ? 'right-0' : 'left-0')}>
          {visible.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed',
                item.tone === 'danger' ? 'text-red-600' : 'text-slate-700',
              )}
            >
              {item.icon && <item.icon className="w-4 h-4" />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
