import { useState } from 'react';
import { ChevronDown, ChevronRight, History } from 'lucide-react';
import { EmptyState } from './States';
import { Pagination } from './DataTable';
import { formatDateTime, humanize } from '../../lib/utils';

export interface ActivityItem {
  id: string;
  action: string;
  userName: string | null;
  summary: string | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  createdAt: string;
}

const show = (v: unknown) => (v === null || v === undefined || v === '' ? <span className="text-slate-400">empty</span> : typeof v === 'object' ? <code className="text-[11px]">{JSON.stringify(v)}</code> : String(v));

function DiffTable({ oldValue, newValue }: { oldValue: Record<string, unknown> | null; newValue: Record<string, unknown> | null }) {
  const keys = Array.from(new Set([...Object.keys(oldValue ?? {}), ...Object.keys(newValue ?? {})]));
  if (keys.length === 0) return null;
  return (
    <table className="mt-2 w-full text-xs border border-slate-200 rounded-md overflow-hidden">
      <thead className="bg-slate-50 text-slate-500">
        <tr>
          <th className="text-left px-2 py-1 font-medium w-1/4">Field</th>
          <th className="text-left px-2 py-1 font-medium">Before</th>
          <th className="text-left px-2 py-1 font-medium">After</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {keys.map((k) => (
          <tr key={k}>
            <td className="px-2 py-1 text-slate-600">{humanize(k)}</td>
            <td className="px-2 py-1 text-slate-700 break-all">{oldValue ? show(oldValue[k]) : <span className="text-slate-300">-</span>}</td>
            <td className="px-2 py-1 text-slate-900 break-all">{newValue ? show(newValue[k]) : <span className="text-slate-300">-</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Row({ item, tone }: { item: ActivityItem; tone: string }) {
  const [open, setOpen] = useState(false);
  const hasDiff = Boolean(item.oldValue || item.newValue);
  return (
    <li className="relative pl-6 pb-5 last:pb-0">
      <span className={`absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-white ${tone}`} />
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-medium text-slate-900">{humanize(item.action.replace(/^PO_/, 'PURCHASE_ORDER_'))}</span>
        <span className="text-xs text-slate-500">
          by {item.userName ?? 'system'} on {formatDateTime(item.createdAt)}
        </span>
      </div>
      {item.summary && <p className="text-sm text-slate-600 mt-0.5">{item.summary}</p>}
      {hasDiff && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 inline-flex items-center gap-1 text-xs text-brand-700 hover:underline">
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          {open ? 'Hide details' : 'Show details'}
        </button>
      )}
      {open && <DiffTable oldValue={item.oldValue} newValue={item.newValue} />}
    </li>
  );
}

const DEFAULT_TONES: Record<string, string> = {
  CREATED: 'bg-emerald-500',
  ISSUED: 'bg-brand-600',
  CANCELLED: 'bg-red-500',
  DELETED: 'bg-red-500',
  CLOSED: 'bg-slate-500',
  RECEIVE_CREATED: 'bg-emerald-500',
};

export function ActivityTimeline({ items, pagination, onPageChange, tones = {} }: { items: ActivityItem[]; pagination?: { page: number; totalPages: number; total: number; limit: number }; onPageChange?: (p: number) => void; tones?: Record<string, string> }) {
  if (items.length === 0) return <EmptyState icon={History} title="No activity yet" />;
  const toneFor = (action: string) => tones[action] ?? Object.entries(DEFAULT_TONES).find(([k]) => action.includes(k))?.[1] ?? 'bg-brand-500';
  return (
    <div>
      <ol className="relative border-l border-slate-200 ml-1">
        {items.map((item) => (
          <Row key={item.id} item={item} tone={toneFor(item.action)} />
        ))}
      </ol>
      {pagination && onPageChange && pagination.totalPages > 1 && <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} limit={pagination.limit} onPageChange={onPageChange} />}
    </div>
  );
}
