import type { ReactNode } from 'react';
import { Check, ChevronDown, MoreHorizontal, RefreshCw, X } from 'lucide-react';
import { Dropdown, type MenuItem } from './Dropdown';
import { IconButton } from './Button';
import { cn } from '../../lib/utils';

export interface ListView {
  value: string;
  label: string;
  count?: number;
}

/**
 * List page header used by every module: a view switcher (title with a dropdown of saved views,
 * e.g. "All Orders / Awaiting approval"), actions on the right, optional filter row below, and
 * chips for the active filters.
 */
export function ListToolbar({
  views,
  view,
  onViewChange,
  actions,
  filters,
  chips,
  onClearAll,
  onRefresh,
  refreshing,
  moreItems = [],
}: {
  views: ListView[];
  view: string;
  onViewChange: (value: string) => void;
  actions?: ReactNode;
  filters?: ReactNode;
  chips?: { label: ReactNode; onClear: () => void }[];
  onClearAll?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  moreItems?: MenuItem[];
}) {
  const current = views.find((v) => v.value === view) ?? views[0];
  const items: MenuItem[] = [...moreItems, ...(onRefresh ? [{ key: 'refresh', label: 'Refresh list', icon: RefreshCw, onSelect: onRefresh }] : [])];
  return (
    <div className="space-y-3 mb-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {views.length > 1 ? (
          <Dropdown
            align="left"
            trigger={({ toggle }) => (
              <button type="button" onClick={toggle} className="inline-flex items-center gap-1.5 text-xl font-semibold text-slate-900 hover:text-brand-700">
                {current.label}
                <ChevronDown className="w-5 h-5 text-brand-600" />
              </button>
            )}
            items={views.map((v) => ({
              key: v.value || 'all',
              label: (
                <span className="flex items-center justify-between w-full gap-4">
                  <span>{v.label}</span>
                  <span className="flex items-center gap-2">
                    {typeof v.count === 'number' && <span className="text-xs text-slate-400 tabular">{v.count}</span>}
                    {v.value === view && <Check className="w-4 h-4 text-brand-600" />}
                  </span>
                </span>
              ),
              onSelect: () => onViewChange(v.value),
            }))}
          />
        ) : (
          <h1 className="text-xl font-semibold text-slate-900">{current.label}</h1>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          {filters}
          {actions}
          {items.length > 0 && <Dropdown trigger={({ toggle }) => <IconButton icon={MoreHorizontal} label="More actions" onClick={toggle} className={cn('border border-slate-300 bg-white', refreshing && 'animate-pulse')} />} items={items} />}
        </div>
      </div>
      {chips && chips.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-xs text-slate-600">
          {chips.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full bg-brand-50 text-brand-700 px-2.5 py-1">
              {c.label}
              <button type="button" onClick={c.onClear} aria-label="Clear filter" className="hover:text-brand-900">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          {onClearAll && (
            <button type="button" onClick={onClearAll} className="text-slate-500 hover:text-slate-800 hover:underline">
              Clear all filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}
