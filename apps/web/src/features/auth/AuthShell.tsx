import type { ReactNode } from 'react';
import { Boxes, ShieldCheck } from 'lucide-react';
import { cn } from '../../lib/utils';

/** Centered card used by every public auth page (sign in, MFA, reset, invitation, apply). */
export function AuthShell({ title, subtitle, children, footer, variant = 'app', wide }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; variant?: 'app' | 'admin'; wide?: boolean }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10">
      <div className={cn('w-full', wide ? 'max-w-2xl' : 'max-w-md')}>
        <div className="flex items-center gap-2.5 mb-6 justify-center">
          <span className={cn('w-9 h-9 rounded-xl text-white flex items-center justify-center', variant === 'admin' ? 'bg-violet-600' : 'bg-brand-600')}>
            {variant === 'admin' ? <ShieldCheck className="w-5 h-5" /> : <Boxes className="w-5 h-5" />}
          </span>
          <span className="font-semibold text-slate-900 text-lg tracking-tight">{variant === 'admin' ? 'Platform Console' : 'B2B Inventory'}</span>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl shadow-card p-6 sm:p-8">
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          {subtitle && <div className="text-sm text-slate-500 mt-1">{subtitle}</div>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="text-center text-sm text-slate-500 mt-4">{footer}</div>}
      </div>
    </div>
  );
}
