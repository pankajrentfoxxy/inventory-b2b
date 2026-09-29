import type { VendorStatus } from '@b2b/shared';
import { Badge } from '../../../components/ui';

export function VendorStatusBadge({ status }: { status: VendorStatus }) {
  return status === 'ACTIVE' ? (
    <Badge tone="green" dot>
      Active
    </Badge>
  ) : (
    <Badge tone="gray" dot>
      Inactive
    </Badge>
  );
}
