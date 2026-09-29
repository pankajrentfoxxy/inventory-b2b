import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { TableSkeleton } from './States';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  className?: string;
  /** Hide below this breakpoint to keep the table readable on small screens. */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl';
  width?: string;
}

const HIDE = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell' };

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  empty?: ReactNode;
  error?: ReactNode;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  onRowClick?: (row: T) => void;
  selectable?: boolean;
  selected?: Set<string>;
  onSelectedChange?: (next: Set<string>) => void;
  rowActions?: (row: T) => ReactNode;
  dense?: boolean;
}

export function DataTable<T>({ columns, rows, rowKey, loading, empty, error, sortBy, sortOrder, onSort, onRowClick, selectable, selected, onSelectedChange, rowActions, dense }: DataTableProps<T>) {
  const allSelected = selectable && rows.length > 0 && rows.every((r) => selected?.has(rowKey(r)));
  const someSelected = selectable && rows.some((r) => selected?.has(rowKey(r)));

  const toggleAll = () => {
    if (!onSelectedChange) return;
    const next = new Set(selected);
    if (allSelected) rows.forEach((r) => next.delete(rowKey(r)));
    else rows.forEach((r) => next.add(rowKey(r)));
    onSelectedChange(next);
  };
  const toggleOne = (id: string) => {
    if (!onSelectedChange) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next);
  };

  const align = (a?: Column<T>['align']) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');
  const pad = dense ? 'px-3 py-2' : 'px-4 py-3.5';

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead className="bg-white text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
          <tr>
            {selectable && (
              <th className={cn('w-10', pad)}>
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  className="h-4 w-4 rounded border-slate-300 text-brand-600"
                  checked={Boolean(allSelected)}
                  ref={(el) => {
                    if (el) el.indeterminate = Boolean(someSelected && !allSelected);
                  }}
                  onChange={toggleAll}
                />
              </th>
            )}
            {columns.map((c) => (
              <th key={c.key} className={cn('font-semibold', pad, align(c.align), c.hideBelow && HIDE[c.hideBelow], c.className)} style={c.width ? { width: c.width } : undefined}>
                {c.sortable && onSort ? (
                  <button type="button" onClick={() => onSort(c.key)} className={cn('inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-800', sortBy === c.key && 'text-slate-900')}>
                    {c.header}
                    {sortBy === c.key ? sortOrder === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" /> : <ChevronsUpDown className="w-3.5 h-3.5 opacity-40" />}
                  </button>
                ) : (
                  c.header
                )}
              </th>
            ))}
            {rowActions && <th className={cn('w-12', pad)} aria-label="Actions" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading ? (
            <tr>
              <td colSpan={columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)} className="p-0">
                <TableSkeleton cols={Math.min(columns.length, 6)} />
              </td>
            </tr>
          ) : error ? (
            <tr>
              <td colSpan={columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)}>{error}</td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)}>{empty}</td>
            </tr>
          ) : (
            rows.map((row) => {
              const id = rowKey(row);
              const isSelected = selected?.has(id);
              return (
                <tr
                  key={id}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn('group transition-colors', onRowClick && 'cursor-pointer hover:bg-slate-50', isSelected && 'bg-brand-50/50')}
                >
                  {selectable && (
                    <td className={pad} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label="Select row" className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={Boolean(isSelected)} onChange={() => toggleOne(id)} />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td key={c.key} className={cn(pad, align(c.align), c.hideBelow && HIDE[c.hideBelow], c.className)}>
                      {c.render(row)}
                    </td>
                  ))}
                  {rowActions && (
                    <td className={cn(pad, 'text-right')} onClick={(e) => e.stopPropagation()}>
                      {rowActions(row)}
                    </td>
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, totalPages, total, limit, onPageChange, onLimitChange }: { page: number; totalPages: number; total: number; limit: number; onPageChange: (p: number) => void; onLimitChange?: (l: number) => void }) {
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 text-sm text-slate-600">
      <div className="flex items-center gap-3">
        <span className="tabular">
          {from}-{to} of {total}
        </span>
        {onLimitChange && (
          <label className="flex items-center gap-1.5 text-xs">
            Rows
            <select value={limit} onChange={(e) => onLimitChange(Number(e.target.value))} className="h-7 rounded-md border border-slate-300 bg-white px-1.5 text-xs">
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button type="button" className="h-8 px-3 rounded-lg border border-slate-300 bg-white text-xs font-medium disabled:opacity-40 hover:bg-slate-50" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </button>
        <span className="px-2 text-xs tabular">
          Page {page} of {totalPages}
        </span>
        <button type="button" className="h-8 px-3 rounded-lg border border-slate-300 bg-white text-xs font-medium disabled:opacity-40 hover:bg-slate-50" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
