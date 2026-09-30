import { Badge } from './Badge';
import { humanize } from '../../lib/utils';

type Tone = 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'purple';

const EXACT: Record<string, Tone> = {
  ACTIVE: 'green', POSTED: 'green', APPROVED: 'green', ISSUED: 'blue', RECEIVED: 'blue', CLOSED: 'gray', QC_COMPLETED: 'green', PASSED: 'green', PASS: 'green', DONE: 'green', AVAILABLE: 'green',
  DRAFT: 'gray', INACTIVE: 'gray', ARCHIVED: 'gray', DEACTIVATED: 'gray', REMOVED: 'gray', EXPIRED: 'gray', REVERSED: 'gray',
  PENDING: 'amber', PENDING_APPROVAL: 'amber', QC_PENDING: 'amber', QC_HOLD: 'amber', OPEN: 'amber', IN_INSPECTION: 'amber', INVITED: 'amber', PARTIALLY_RECEIVED: 'amber', CANCELLATION_PENDING: 'amber', SUSPENDED: 'amber', LOCKED: 'amber', IN_TRANSIT: 'blue', RESERVED: 'blue', DECIDED: 'blue',
  CANCELLED: 'red', REJECTED: 'red', BLOCKED: 'red', POSTING_FAILED: 'red', FAILED: 'red', FAIL: 'red', DISABLED: 'red',
  DELIVERED: 'purple',
};

export function toneFor(status: string): Tone {
  return EXACT[status] ?? (status.startsWith('PENDING') ? 'amber' : 'gray');
}

/** Status chip for every document / party / lot status; unknown statuses fall back to gray. */
export function StatusBadge({ status, label, dot = true }: { status: string; label?: string; dot?: boolean }) {
  return (
    <Badge tone={toneFor(status)} dot={dot}>
      {label ?? humanize(status)}
    </Badge>
  );
}
