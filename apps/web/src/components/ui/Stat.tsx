import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Skeleton } from './States';

/** KPI tile for dashboards and detail headers. */
export function Stat({ label, value, hint, icon: Icon, tone = 'default', loading, onClick, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: LucideIcon; tone?: 'default' | 'green' | 'amber' | 'red' | 'blue'; loading?: boolean; onClick?: () => void; className?: string }) {
  const tones = { default: 'text-slate-900', green: 'text-emerald-700', amber: 'text-amber-700', red: 'text-red-700', blue: 'text-brand-700' };
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={cn('bg-white border border-slate-200 rounded-xl shadow-card px-4 py-3 text-left min-w-0', onClick && 'hover:border-brand-300 hover:shadow transition', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500 truncate">{label}</p>
        {Icon && <Icon className="w-4 h-4 text-slate-400 shrink-0" />}
      </div>
      {loading ? <Skeleton className="h-7 w-20 mt-1" /> : <p className={cn('text-2xl font-semibold tabular mt-0.5 truncate', tones[tone])}>{value}</p>}
      {hint && <p className="text-xs text-slate-500 mt-0.5 truncate">{hint}</p>}
    </Tag>
  );
}

export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-2 md:grid-cols-4 gap-3', className)}>{children}</div>;
}
