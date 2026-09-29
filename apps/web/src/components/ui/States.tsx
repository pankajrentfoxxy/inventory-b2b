import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, type LucideIcon } from 'lucide-react';
import { Button } from './Button';
import { cn } from '../../lib/utils';

export function EmptyState({ icon: Icon = Inbox, title, hint, action, className }: { icon?: LucideIcon; title: string; hint?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('text-center py-14 px-4', className)}>
      <span className="mx-auto w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center">
        <Icon className="w-6 h-6" />
      </span>
      <p className="font-semibold text-slate-800 mt-3">{title}</p>
      {hint && <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', message, onRetry, className }: { title?: string; message?: string; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn('text-center py-12 px-4', className)} role="alert">
      <span className="mx-auto w-12 h-12 rounded-full bg-red-50 text-red-500 flex items-center justify-center">
        <AlertTriangle className="w-6 h-6" />
      </span>
      <p className="font-semibold text-slate-800 mt-3">{title}</p>
      {message && <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">{message}</p>}
      {onRetry && (
        <div className="mt-4">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-slate-200/70', className)} aria-hidden="true" />;
}

export function TableSkeleton({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-slate-100">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3">
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} className={cn('h-4', c === 0 ? 'w-40' : c === cols - 1 ? 'w-16 ml-auto' : 'w-28')} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-40" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
        <Skeleton className="h-56 lg:col-span-2" />
        <Skeleton className="h-56" />
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}

export function FormSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
