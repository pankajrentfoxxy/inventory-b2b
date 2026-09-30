import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FormSkeleton, PageHeader, ErrorState } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useParty, usePartyFormOptions, useUpdateParty } from '../hooks';
import { PARTY_META, type PartyType } from '../types';
import { PartyForm } from '../form/PartyForm';
import { PartyStatusBadge } from '../components/PartyStatusBadge';

export function PartyEditPage({ type }: { type: PartyType }) {
  const meta = PARTY_META[type];
  const base = `/parties/${meta.route}`;
  const { id = '' } = useParams();
  const options = usePartyFormOptions(type);
  const party = useParty(type, id);
  const update = useUpdateParty(type, id);

  const loading = options.isLoading || party.isLoading;
  const error = options.isError ? options.error : party.isError ? party.error : null;

  return (
    <>
      <PageHeader
        title={party.data ? `Edit ${party.data.displayName}` : `Edit ${meta.singular}`}
        subtitle={party.data ? <PartyStatusBadge status={party.data.status} /> : undefined}
        breadcrumbs={[{ label: 'Parties' }, { label: meta.plural, to: base }, { label: party.data?.displayName ?? '...', to: `${base}/${id}` }, { label: 'Edit' }]}
      />
      {loading ? (
        <FormSkeleton />
      ) : error || !options.data || !party.data ? (
        <ErrorState
          title={toApiError(error).status === 404 ? `${meta.singular} not found` : `Could not load ${meta.singular.toLowerCase()}`}
          message={toApiError(error).message}
          onRetry={() => {
            options.refetch();
            void party.refetch();
          }}
        />
      ) : (
        <PartyForm
          type={type}
          options={options.data}
          party={party.data}
          submitting={update.isPending}
          onSubmit={async (payload) => {
            const saved = await update.mutateAsync({ payload, version: party.data!.version });
            toast.success(`${meta.singular} updated`);
            return saved;
          }}
          onError={(err) => {
            if (err.status !== 409) return false;
            toast.error(`This ${meta.singular.toLowerCase()} was changed by someone else. The latest version has been loaded; review your changes and save again.`);
            void party.refetch();
            return true;
          }}
        />
      )}
    </>
  );
}
