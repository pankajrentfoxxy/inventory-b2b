import { cn, formatQty } from '../../../lib/utils';

/** Small received / ordered bar used in PO lists and line tables. */
export function ProgressBar({ value, total, label, tone, className }: { value: number; total: number; label?: string; tone?: 'brand' | 'green' | 'amber' | 'red'; className?: string }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : 0;
  const auto = pct >= 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-amber-500' : 'bg-slate-300';
  const color = tone === 'green' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-500' : tone === 'red' ? 'bg-red-500' : tone === 'brand' ? 'bg-brand-600' : auto;
  return (
    <div className={cn('min-w-[110px]', className)} title={`${formatQty(value)} of ${formatQty(total)}`}>
      <div className="flex items-center justify-between text-[11px] text-slate-500 tabular mb-1">
        <span>{label ?? `${formatQty(value)} / ${formatQty(total)}`}</span>
        <span>{Math.round(pct)}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Coloured banner for async states (posting, failed, QC pending...). */
export function StatusBanner({ tone, title, message, action, className }: { tone: 'info' | 'warning' | 'danger' | 'success'; title: string; message?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  const tones = {
    info: 'bg-brand-50 border-brand-200 text-brand-800',
    warning: 'bg-amber-50 border-amber-200 text-amber-800',
    danger: 'bg-red-50 border-red-200 text-red-800',
    success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  };
  return (
    <div className={cn('rounded-xl border px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3', tones[tone], className)} role="status">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        {message && <div className="text-sm mt-0.5 break-words">{message}</div>}
      </div>
      {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
    </div>
  );
}
