import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Power, X } from 'lucide-react';
import { Button, Card, ConfirmDialog, ReasonDialog } from '../../../components/ui';
import { useUrlFilters } from '../../../hooks/useUrlFilters';
import { toApiError, type ApiError } from '../../../lib/api';
import { useBlockParty, useDeleteParty, useParties, usePartyStatus, useUnblockParty } from '../hooks';
import { PARTY_META, type PartyListItem, type PartyType } from '../types';
import { PartyToolbar } from '../components/PartyFilters';
import { PartyTable } from '../components/PartyTable';

const DEFAULTS = { q: '', status: '', gstTreatment: '' };
const PAGE_SIZE = 50;

/** MASTER_IN_USE carries the referencing services in details; show them with the message. */
export function partyErrorMessage(e: ApiError) {
  return e.code === 'MASTER_IN_USE' && e.details.length ? `${e.message} (${e.details.map((d) => d.message).join(', ')})` : e.message;
}

export function PartyListPage({ type }: { type: PartyType }) {
  const meta = PARTY_META[type];
  const noun = meta.singular.toLowerCase();
  const nouns = meta.plural.toLowerCase();
  const { filters, setFilters, reset } = useUrlFilters(DEFAULTS);
  const params = useMemo(() => ({ q: filters.q, status: filters.status, gstTreatment: filters.gstTreatment, limit: PAGE_SIZE }), [filters]);
  const query = useParties(type, params);
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);
  const statusMutation = usePartyStatus(type);
  const blockMutation = useBlockParty(type);
  const unblockMutation = useUnblockParty(type);
  const deleteMutation = useDeleteParty(type);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<PartyListItem | null>(null);
  const [pendingStatus, setPendingStatus] = useState<PartyListItem | null>(null);
  const [pendingBlock, setPendingBlock] = useState<PartyListItem | null>(null);
  const [bulk, setBulk] = useState<'ACTIVE' | 'INACTIVE' | null>(null);

  const hasFilters = Boolean(filters.q || filters.status || filters.gstTreatment);
  const error = query.isError ? toApiError(query.error).message : null;

  const changeStatus = async (row: PartyListItem) => {
    const next = row.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await statusMutation.mutateAsync({ id: row.id, status: next });
      toast.success(`${row.displayName} marked as ${next.toLowerCase()}`);
    } catch (err) {
      toast.error(toApiError(err).message);
    } finally {
      setPendingStatus(null);
    }
  };

  const changeBlock = async (row: PartyListItem, reason: string) => {
    const unblocking = row.status === 'BLOCKED';
    try {
      if (unblocking) await unblockMutation.mutateAsync({ id: row.id, reason });
      else await blockMutation.mutateAsync({ id: row.id, reason });
      toast.success(`${row.displayName} ${unblocking ? 'unblocked' : 'blocked'}`);
      setPendingBlock(null);
    } catch (err) {
      toast.error(toApiError(err).message);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteMutation.mutateAsync(pendingDelete.id);
      toast.success(`${pendingDelete.displayName} deleted`);
      setSelected((s) => {
        const n = new Set(s);
        n.delete(pendingDelete.id);
        return n;
      });
    } catch (err) {
      toast.error(partyErrorMessage(toApiError(err)));
    } finally {
      setPendingDelete(null);
    }
  };

  const runBulk = async () => {
    if (!bulk) return;
    // Blocked parties are released through Unblock (with a reason), not the status toggle.
    const ids = rows.filter((r) => selected.has(r.id) && r.status !== 'BLOCKED').map((r) => r.id);
    const skipped = selected.size - ids.length;
    const results = await Promise.allSettled(ids.map((id) => statusMutation.mutateAsync({ id, status: bulk })));
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed) toast.error(`${failed} of ${ids.length} ${nouns} could not be updated`);
    else if (ids.length) toast.success(`${ids.length} ${ids.length === 1 ? noun : nouns} marked as ${bulk.toLowerCase()}`);
    if (skipped) toast(`${skipped} blocked ${skipped === 1 ? noun : nouns} skipped; unblock them first`, { icon: 'i' });
    setSelected(new Set());
    setBulk(null);
  };

  const blocking = pendingBlock?.status !== 'BLOCKED';

  return (
    <>
      <div className="mb-4">
        <PartyToolbar type={type} filters={filters} onChange={(patch) => setFilters(patch)} onReset={reset} onRefresh={() => void query.refetch()} refreshing={query.isFetching && !query.isLoading} />
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">
          <span className="font-medium">{selected.size} selected</span>
          <Button size="xs" variant="secondary" icon={Power} onClick={() => setBulk('ACTIVE')}>
            Mark as Active
          </Button>
          <Button size="xs" variant="secondary" icon={Power} onClick={() => setBulk('INACTIVE')}>
            Mark as Inactive
          </Button>
          <Button size="xs" variant="ghost" icon={X} onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

      <Card className="overflow-hidden">
        <PartyTable
          type={type}
          rows={rows}
          loading={query.isLoading}
          error={error}
          onRetry={() => void query.refetch()}
          hasFilters={hasFilters}
          onClearFilters={reset}
          selected={selected}
          onSelectedChange={setSelected}
          onToggleStatus={(row) => setPendingStatus(row)}
          onBlock={(row) => setPendingBlock(row)}
          onDelete={(row) => setPendingDelete(row)}
        />
        {query.hasNextPage && (
          <div className="flex justify-center border-t border-slate-200 px-4 py-3">
            <Button variant="secondary" size="sm" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
              Load more
            </Button>
          </div>
        )}
        {!query.hasNextPage && rows.length > 0 && (
          <p className="px-4 py-2 text-xs text-slate-500 border-t border-slate-100 tabular">
            {rows.length} {rows.length === 1 ? noun : nouns}
          </p>
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(pendingStatus)}
        onClose={() => setPendingStatus(null)}
        onConfirm={() => pendingStatus && void changeStatus(pendingStatus)}
        loading={statusMutation.isPending}
        tone={pendingStatus?.status === 'ACTIVE' ? 'danger' : 'primary'}
        title={pendingStatus?.status === 'ACTIVE' ? `Mark ${noun} as inactive?` : `Mark ${noun} as active?`}
        confirmLabel={pendingStatus?.status === 'ACTIVE' ? 'Mark inactive' : 'Mark active'}
        message={
          pendingStatus?.status === 'ACTIVE' ? (
            <>
              <strong>{pendingStatus?.displayName}</strong> will no longer be selectable in new transactions. Existing records are kept.
            </>
          ) : (
            <>
              <strong>{pendingStatus?.displayName}</strong> will be available again for new transactions.
            </>
          )
        }
      />

      <ReasonDialog
        open={Boolean(pendingBlock)}
        onClose={() => setPendingBlock(null)}
        onConfirm={({ reason }) => pendingBlock && void changeBlock(pendingBlock, reason)}
        loading={blockMutation.isPending || unblockMutation.isPending}
        tone={blocking ? 'danger' : 'primary'}
        title={blocking ? `Block ${noun}?` : `Unblock ${noun}?`}
        confirmLabel={blocking ? 'Block' : 'Unblock'}
        message={
          blocking ? (
            <>
              No new documents can be raised for <strong>{pendingBlock?.displayName}</strong> while blocked. Existing documents are unaffected.
            </>
          ) : (
            <>
              <strong>{pendingBlock?.displayName}</strong> becomes active again and can be used on new documents.
            </>
          )
        }
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
        loading={deleteMutation.isPending}
        title={`Delete ${noun}?`}
        confirmLabel="Delete"
        message={
          <>
            <strong>{pendingDelete?.displayName}</strong> will be removed from all {noun} lists. Only {nouns} without any document can be deleted; otherwise mark it inactive or block it.
          </>
        }
      />

      <ConfirmDialog
        open={Boolean(bulk)}
        onClose={() => setBulk(null)}
        onConfirm={() => void runBulk()}
        loading={statusMutation.isPending}
        tone={bulk === 'INACTIVE' ? 'danger' : 'primary'}
        title={`Mark ${selected.size} ${selected.size === 1 ? noun : nouns} as ${bulk?.toLowerCase()}?`}
        confirmLabel="Apply"
        message={`Status changes are recorded in each ${noun}'s audit trail.`}
      />
    </>
  );
}
