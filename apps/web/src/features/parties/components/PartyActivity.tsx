import { History } from 'lucide-react';
import { ActivityTimeline, Button, EmptyState, ErrorState, Skeleton } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { toActivityItem } from '../../iam/components/AuditTrailView';
import { usePartyAudit } from '../hooks';

/** Audit trail for the party (svc-audit, filtered by entity id), newest first, cursor paged. */
export function PartyActivity({ partyId }: { partyId: string }) {
  const q = usePartyAudit(partyId);

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
  if (q.isError) {
    const e = toApiError(q.error);
    if (e.status === 403) return <EmptyState icon={History} title="No access to the audit trail" hint="You need the audit view permission to see who changed this record." />;
    return <ErrorState message={e.message} onRetry={() => void q.refetch()} />;
  }
  const items = (q.data?.pages ?? []).flatMap((p) => p.data).map(toActivityItem);
  if (items.length === 0) return <EmptyState icon={History} title="No activity yet" />;

  return (
    <div>
      <ActivityTimeline items={items} />
      {q.hasNextPage && (
        <div className="mt-5 flex justify-center">
          <Button variant="secondary" size="sm" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
