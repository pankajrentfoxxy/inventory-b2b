import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

const TONES = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-200',
  blue: 'bg-brand-50 text-brand-700 ring-brand-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  purple: 'bg-violet-50 text-violet-700 ring-violet-200',
} as const;

export function Badge({ tone = 'gray', className, children, dot }: { tone?: keyof typeof TONES; className?: string; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ring-1 ring-inset', TONES[tone], className)}>
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full', tone === 'green' ? 'bg-emerald-500' : tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-slate-400')} />}
      {children}
    </span>
  );
}
