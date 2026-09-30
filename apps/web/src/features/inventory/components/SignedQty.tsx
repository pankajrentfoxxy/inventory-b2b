import { cn, formatQty } from '../../../lib/utils';

/** Signed quantity: green for receipts, red for issues. */
export function SignedQty({ value, className }: { value: number; className?: string }) {
  const sign = value > 0 ? '+' : '';
  return <span className={cn('tabular font-medium', value > 0 ? 'text-emerald-700' : value < 0 ? 'text-red-600' : 'text-slate-500', className)}>{`${sign}${formatQty(value)}`}</span>;
}
