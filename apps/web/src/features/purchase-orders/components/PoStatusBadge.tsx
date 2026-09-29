import { PURCHASE_ORDER_STATUS_LABELS, type PurchaseOrderStatus } from '@b2b/shared';
import { Badge } from '../../../components/ui';
import type { ReceiveState } from '../types';

const TONES: Record<PurchaseOrderStatus, 'gray' | 'blue' | 'amber' | 'green' | 'red' | 'purple'> = {
  DRAFT: 'gray',
  ISSUED: 'blue',
  PARTIALLY_RECEIVED: 'amber',
  RECEIVED: 'green',
  CLOSED: 'purple',
  CANCELLED: 'red',
};

export function PoStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return (
    <Badge tone={TONES[status]} dot>
      {PURCHASE_ORDER_STATUS_LABELS[status]}
    </Badge>
  );
}

export function ReceiveStateText({ state }: { state: ReceiveState | null }) {
  if (!state || state === 'NONE') return <span className="text-slate-400">Not received</span>;
  if (state === 'PARTIAL') return <span className="text-amber-700 font-medium">Partially received</span>;
  return <span className="text-emerald-700 font-medium">Received</span>;
}

export function ReceiveStatusBadge({ status }: { status: 'RECEIVED' | 'CANCELLED' }) {
  return status === 'RECEIVED' ? (
    <Badge tone="green" dot>
      Received
    </Badge>
  ) : (
    <Badge tone="red" dot>
      Cancelled
    </Badge>
  );
}
