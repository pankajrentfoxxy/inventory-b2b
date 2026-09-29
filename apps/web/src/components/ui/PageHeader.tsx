import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

export interface Crumb {
  label: string;
  to?: string;
}

export function PageHeader({ title, subtitle, actions, breadcrumbs, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; breadcrumbs?: Crumb[]; children?: ReactNode }) {
  return (
    <div className="mb-5">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="flex items-center gap-1 text-xs text-slate-500 mb-2" aria-label="Breadcrumb">
          {breadcrumbs.map((c, i) => (
            <span key={`${c.label}-${i}`} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="w-3 h-3 text-slate-400" />}
              {c.to ? (
                <Link to={c.to} className="hover:text-slate-800">
                  {c.label}
                </Link>
              ) : (
                <span className="text-slate-700">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-slate-900 truncate">{title}</h1>
          {subtitle && <div className="text-sm text-slate-500 mt-0.5">{subtitle}</div>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
