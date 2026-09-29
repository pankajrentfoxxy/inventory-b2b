import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('bg-white border border-slate-200 rounded-xl shadow-card', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100', className)}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('px-5 py-4', className)}>{children}</div>;
}

/** Label / value pair used across detail views. */
export function DescriptionList({ items, columns = 2 }: { items: { label: string; value: ReactNode; mono?: boolean; span?: 2 }[]; columns?: 1 | 2 | 3 }) {
  const cols = columns === 1 ? 'grid-cols-1' : columns === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2';
  return (
    <dl className={cn('grid gap-x-6 gap-y-3', cols)}>
      {items.map((item) => (
        <div key={item.label} className={cn('min-w-0', item.span === 2 && 'sm:col-span-2')}>
          <dt className="text-xs text-slate-500">{item.label}</dt>
          <dd className={cn('text-sm text-slate-900 mt-0.5 break-words', item.mono && 'font-mono tabular text-[13px]')}>
            {item.value === null || item.value === undefined || item.value === '' ? <span className="text-slate-400">-</span> : item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
