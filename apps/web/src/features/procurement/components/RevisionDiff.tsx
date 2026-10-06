import { cn, formatMoney, formatQty } from '../../../lib/utils';
import type { PoLine, PurchaseOrder } from '../types';

type Change = 'added' | 'removed' | 'changed' | 'same';

interface DiffRow {
  key: string;
  change: Change;
  before: PoLine | null;
  after: PoLine | null;
}

/** "INR 3,500.00 x 12 months"; snapshots from before rental terms existed have none. */
function rentalTerms(l: PoLine, currency?: string): string {
  if (l.monthlyRentalAmount === null || l.monthlyRentalAmount === undefined || l.tenureMonths === null || l.tenureMonths === undefined) return '';
  return `${formatMoney(l.monthlyRentalAmount, currency)} x ${l.tenureMonths} months`;
}

/** Match lines by id (revisions keep ids for kept lines); fall back to itemId for lines that were replaced. */
export function diffLines(before: PoLine[], after: PoLine[]): DiffRow[] {
  const rows: DiffRow[] = [];
  const seenAfter = new Set<string>();
  for (const b of before) {
    const a = after.find((x) => x.id === b.id) ?? after.find((x) => x.itemId === b.itemId && !seenAfter.has(x.id) && !before.some((y) => y.id === x.id));
    if (!a) {
      rows.push({ key: b.id, change: 'removed', before: b, after: null });
      continue;
    }
    seenAfter.add(a.id);
    const changed = a.orderedQty !== b.orderedQty || a.unitPrice !== b.unitPrice || a.taxRate !== b.taxRate || a.itemId !== b.itemId || rentalTerms(a) !== rentalTerms(b);
    rows.push({ key: b.id, change: changed ? 'changed' : 'same', before: b, after: a });
  }
  for (const a of after) if (!seenAfter.has(a.id) && !rows.some((r) => r.after?.id === a.id)) rows.push({ key: a.id, change: 'added', before: null, after: a });
  return rows;
}

const TONE: Record<Change, string> = {
  added: 'bg-emerald-50/70',
  removed: 'bg-red-50/70',
  changed: 'bg-amber-50/70',
  same: '',
};
const LABEL: Record<Change, string> = { added: 'Added', removed: 'Removed', changed: 'Changed', same: '' };

function Cell({ value, other, format }: { value: number | null | undefined; other: number | null | undefined; format: (n: number) => string }) {
  if (value === null || value === undefined) return <span className="text-slate-300">-</span>;
  const diff = other !== null && other !== undefined && other !== value;
  return <span className={cn('tabular', diff && 'font-semibold text-amber-800 underline decoration-amber-400 decoration-2 underline-offset-2')}>{format(value)}</span>;
}

/** Side-by-side lines of a stored revision snapshot vs the current order. */
export function RevisionDiff({ snapshot, current }: { snapshot: PurchaseOrder; current: PurchaseOrder }) {
  const rows = diffLines(snapshot.lines, current.lines);
  const currency = current.currency;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-emerald-200" /> added
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-red-200" /> removed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-amber-200" /> changed
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm border-collapse">
          <thead className="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
            <tr>
              <th className="text-left px-3 py-2 font-semibold" rowSpan={2}>
                Product
              </th>
              <th className="text-center px-3 py-1 font-semibold border-l border-slate-200" colSpan={3}>
                Revision {snapshot.revision}
              </th>
              <th className="text-center px-3 py-1 font-semibold border-l border-slate-200" colSpan={3}>
                Current (revision {current.revision})
              </th>
              <th className="px-3 py-2" rowSpan={2} />
            </tr>
            <tr>
              <th className="text-right px-3 py-1 font-medium border-l border-slate-200">Qty</th>
              <th className="text-right px-3 py-1 font-medium">Price</th>
              <th className="text-right px-3 py-1 font-medium">GST</th>
              <th className="text-right px-3 py-1 font-medium border-l border-slate-200">Qty</th>
              <th className="text-right px-3 py-1 font-medium">Price</th>
              <th className="text-right px-3 py-1 font-medium">GST</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const item = (r.after ?? r.before)!.item;
              return (
                <tr key={r.key} className={TONE[r.change]}>
                  <td className="px-3 py-2">
                    <p className={cn('font-medium text-slate-900', r.change === 'removed' && 'line-through text-slate-500')}>{item.name}</p>
                    <p className="text-xs font-mono text-slate-500">{item.sku}</p>
                    {(() => {
                      const before = r.before ? rentalTerms(r.before, currency) : '';
                      const after = r.after ? rentalTerms(r.after, currency) : '';
                      if (!before && !after) return null;
                      return (
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Rental: {before === after || !r.before || !r.after ? after || before : <><span className="line-through">{before || '-'}</span> to <span className="font-medium text-slate-700">{after || '-'}</span></>}
                        </p>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2 text-right border-l border-slate-100">
                    <Cell value={r.before?.orderedQty} other={r.after?.orderedQty} format={formatQty} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Cell value={r.before?.unitPrice} other={r.after?.unitPrice} format={(n) => formatMoney(n, currency)} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Cell value={r.before?.taxRate} other={r.after?.taxRate} format={(n) => `${n}%`} />
                  </td>
                  <td className="px-3 py-2 text-right border-l border-slate-100">
                    <Cell value={r.after?.orderedQty} other={r.before?.orderedQty} format={formatQty} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Cell value={r.after?.unitPrice} other={r.before?.unitPrice} format={(n) => formatMoney(n, currency)} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Cell value={r.after?.taxRate} other={r.before?.taxRate} format={(n) => `${n}%`} />
                  </td>
                  <td className="px-3 py-2 text-right text-xs">
                    {r.change !== 'same' && <span className={cn('px-2 py-0.5 rounded-full ring-1 ring-inset', r.change === 'added' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : r.change === 'removed' ? 'bg-red-50 text-red-700 ring-red-200' : 'bg-amber-50 text-amber-700 ring-amber-200')}>{LABEL[r.change]}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-slate-200 text-sm">
            <tr>
              <td className="px-3 py-2 font-medium text-slate-700">Total</td>
              <td className="px-3 py-2 text-right tabular border-l border-slate-100" colSpan={3}>
                <Cell value={snapshot.total} other={current.total} format={(n) => formatMoney(n, currency)} />
              </td>
              <td className="px-3 py-2 text-right tabular border-l border-slate-100" colSpan={3}>
                <Cell value={current.total} other={snapshot.total} format={(n) => formatMoney(n, currency)} />
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {snapshot.expectedDate !== current.expectedDate && (
        <p className="text-xs text-slate-600">
          Expected date: <span className="tabular">{snapshot.expectedDate ? snapshot.expectedDate.slice(0, 10) : '-'}</span> to <span className="tabular font-medium">{current.expectedDate ? current.expectedDate.slice(0, 10) : '-'}</span>
        </p>
      )}
    </div>
  );
}
