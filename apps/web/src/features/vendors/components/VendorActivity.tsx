import { useState } from 'react';
import { History, ChevronDown, ChevronRight } from 'lucide-react';
import { EmptyState, ErrorState, Pagination, Skeleton } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { formatDateTime, humanize } from '../../../lib/utils';
import { useVendorActivity } from '../hooks';
import type { VendorActivityItem } from '../types';

const TONE: Record<string, string> = {
  VENDOR_CREATED: 'bg-emerald-500',
  VENDOR_DELETED: 'bg-red-500',
  VENDOR_STATUS_CHANGED: 'bg-amber-500',
  BANK_ACCOUNT_REVEALED: 'bg-violet-500',
};

function DiffTable({ oldValue, newValue }: { oldValue: Record<string, unknown> | null; newValue: Record<string, unknown> | null }) {
  const keys = Array.from(new Set([...Object.keys(oldValue ?? {}), ...Object.keys(newValue ?? {})]));
  if (keys.length === 0) return null;
  const show = (v: unknown) => (v === null || v === undefined || v === '' ? <span className="text-slate-400">empty</span> : typeof v === 'object' ? <code className="text-[11px]">{JSON.stringify(v)}</code> : String(v));
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

function ActivityRow({ item }: { item: VendorActivityItem }) {
  const [open, setOpen] = useState(false);
  const hasDiff = Boolean(item.oldValue || item.newValue);
  return (
    <li className="relative pl-6 pb-5 last:pb-0">
      <span className={`absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-white ${TONE[item.action] ?? 'bg-brand-500'}`} />
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-medium text-slate-900">{humanize(item.action)}</span>
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

export function VendorActivity({ vendorId }: { vendorId: string }) {
  const [page, setPage] = useState(1);
  const q = useVendorActivity(vendorId, page);

  if (q.isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-3 w-80" />
          </div>
        ))}
      </div>
    );
  }
  if (q.isError) return <ErrorState message={toApiError(q.error).message} onRetry={() => void q.refetch()} />;
  const data = q.data!;
  if (data.data.length === 0) return <EmptyState icon={History} title="No activity yet" />;

  return (
    <div>
      <ol className="relative border-l border-slate-200 ml-1">
        {data.data.map((item) => (
          <ActivityRow key={item.id} item={item} />
        ))}
      </ol>
      {data.pagination.totalPages > 1 && <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} total={data.pagination.total} limit={data.pagination.limit} onPageChange={setPage} />}
    </div>
  );
}
