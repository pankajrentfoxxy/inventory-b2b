import toast from 'react-hot-toast';
import { FormSkeleton, PageHeader, ErrorState } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { shouldRetryWithSameKey, useIdempotencyKey } from '../../../hooks/useIdempotencyKey';
import { useCreateParty, usePartyFormOptions } from '../hooks';
import { PARTY_META, type PartyType } from '../types';
import { PartyForm } from '../form/PartyForm';

export function PartyCreatePage({ type }: { type: PartyType }) {
  const meta = PARTY_META[type];
  const base = `/parties/${meta.route}`;
  const options = usePartyFormOptions(type);
  const create = useCreateParty(type);
  const idem = useIdempotencyKey();

  return (
    <>
      <PageHeader title={`New ${meta.singular}`} breadcrumbs={[{ label: 'Parties' }, { label: meta.plural, to: base }, { label: 'New' }]} />
      {options.isLoading ? (
        <FormSkeleton />
      ) : options.isError || !options.data ? (
        <ErrorState message={toApiError(options.error).message} onRetry={options.refetch} />
      ) : (
        <PartyForm
          type={type}
          options={options.data}
          submitting={create.isPending}
          onSubmit={async (payload, andNew) => {
            try {
              const saved = await create.mutateAsync({ payload, idempotencyKey: idem.keyFor(payload) });
              idem.reset();
              toast.success(andNew ? `${saved.displayName} created. Add the next ${meta.singular.toLowerCase()}.` : `${saved.displayName} created`);
              return saved;
            } catch (err) {
              // Unknown outcome (network / 5xx): keep the key so a retry replays instead of duplicating.
              if (!shouldRetryWithSameKey(toApiError(err).status)) idem.reset();
              throw err;
            }
          }}
        />
      )}
    </>
  );
}
