import { Link } from 'react-router-dom';
import { humanize } from '../../../lib/utils';

/** Where a stock movement's source document lives in the app; null when there is no page for it. */
export function refPath(refType: string, refId: string): string | null {
  switch (refType) {
    case 'GRN':
      return `/purchases/receipts/${refId}`;
    case 'QC_LOT':
      return `/qc/lots/${refId}`;
    case 'ADJUSTMENT':
      return `/inventory/adjustments/${refId}`;
    case 'PO':
      return `/purchases/orders/${refId}`;
    case 'OPENING':
    case 'BIN_MOVE':
      return `/inventory/ledger?refType=${refType}`;
    default:
      return null;
  }
}

/** "GRN GRN-00012" with a link to the source document when the app has a page for it. */
export function RefLink({ refType, refId, refNumber, className }: { refType: string; refId: string; refNumber: string | null; className?: string }) {
  const path = refPath(refType, refId);
  const label = refNumber ?? `${refId.slice(0, 8)}...`;
  return (
    <span className={className}>
      <span className="text-xs text-slate-500 mr-1">{humanize(refType)}</span>
      {path ? (
        <Link to={path} onClick={(e) => e.stopPropagation()} className="font-mono text-[13px] text-brand-700 hover:underline">
          {label}
        </Link>
      ) : (
        <span className="font-mono text-[13px] text-slate-800">{label}</span>
      )}
    </span>
  );
}
