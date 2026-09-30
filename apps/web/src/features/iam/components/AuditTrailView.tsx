import type { ReactNode } from 'react';
import type { UseInfiniteQueryResult, InfiniteData } from '@tanstack/react-query';
import { ActivityTimeline, Button, Card, CardBody, ErrorState, Skeleton, type ActivityItem } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import type { AuditEvent, CursorPage } from '../types';

/** Maps an audit_events row onto the timeline primitive. Reason is folded into the summary so it is never lost. */
export function toActivityItem(e: AuditEvent): ActivityItem {
  const parts = [e.summary, e.reason ? `Reason: ${e.reason}` : null].filter(Boolean);
  return {
    id: e.id,
    action: e.action,
    userName: e.actorName ?? (e.actorType === 'system' ? 'system' : null),
    summary: parts.length ? parts.join(' - ') : `${e.entityType} ${e.entityId}`,
    oldValue: e.oldValue,
    newValue: e.newValue,
    createdAt: e.occurredAt,
  };
}

function TimelineSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="h-3 w-3 rounded-full mt-1" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Cursor-paged audit trail shared by the tenant (/settings/audit) and platform (/admin/audit)
 * pages: loading skeleton, error with retry, empty state (from the timeline) and a Load more button.
 */
export function AuditTrailView({ query, filters }: { query: UseInfiniteQueryResult<InfiniteData<CursorPage<AuditEvent>>, unknown>; filters?: ReactNode }) {
  const items = (query.data?.pages ?? []).flatMap((p) => p.data).map(toActivityItem);
  return (
    <Card>
      {filters && <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-end gap-3">{filters}</div>}
      <CardBody>
        {query.isLoading ? (
          <TimelineSkeleton />
        ) : query.isError ? (
          <ErrorState title="Could not load the audit trail" message={toApiError(query.error).message} onRetry={() => void query.refetch()} />
        ) : (
          <>
            <ActivityTimeline items={items} />
            {query.hasNextPage && (
              <div className="mt-5 flex justify-center">
                <Button variant="secondary" size="sm" onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage}>
                  Load more
                </Button>
              </div>
            )}
            {!query.hasNextPage && items.length > 0 && <p className="mt-5 text-center text-xs text-slate-400">End of trail ({items.length} events)</p>}
          </>
        )}
      </CardBody>
    </Card>
  );
}
