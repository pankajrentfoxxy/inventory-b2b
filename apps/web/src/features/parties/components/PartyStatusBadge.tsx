import { Badge } from '../../../components/ui';
import type { PartyStatus } from '../types';

export function PartyStatusBadge({ status }: { status: PartyStatus }) {
  if (status === 'ACTIVE') {
    return (
      <Badge tone="green" dot>
        Active
      </Badge>
    );
  }
  if (status === 'BLOCKED') {
    return (
      <Badge tone="red" dot>
        Blocked
      </Badge>
    );
  }
  return (
    <Badge tone="gray" dot>
      Inactive
    </Badge>
  );
}
