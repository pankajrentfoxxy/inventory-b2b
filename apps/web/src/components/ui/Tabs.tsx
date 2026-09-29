import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface TabItem<T extends string> {
  key: T;
  label: ReactNode;
  count?: number;
  hasError?: boolean;
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: TabItem<T>[]; value: T; onChange: (key: T) => void; className?: string }) {
  return (
    <div className={cn('border-b border-slate-200 overflow-x-auto', className)}>
      <div role="tablist" className="flex gap-1 -mb-px min-w-max">
        {tabs.map((t) => {
          const active = t.key === value;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(t.key)}
              className={cn(
                'relative px-3 h-10 text-sm font-medium border-b-2 transition-colors whitespace-nowrap inline-flex items-center gap-1.5',
                active ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300',
              )}
            >
              {t.label}
              {typeof t.count === 'number' && (
                <span className={cn('text-[11px] px-1.5 py-0.5 rounded-full tabular', active ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600')}>{t.count}</span>
              )}
              {t.hasError && <span className="w-1.5 h-1.5 rounded-full bg-red-500" aria-label="Has errors" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
