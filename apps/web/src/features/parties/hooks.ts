import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { partyApi } from './api';
import type { AddressPayload, BankAccountPayload, ContactPayload, PartyListParams, PartyPatch, PartyPayload, PartyType } from './types';

export const partyKeys = {
  all: (type: PartyType) => ['parties', type] as const,
  list: (type: PartyType, params: PartyListParams) => ['parties', type, 'list', params] as const,
  lookup: (type: PartyType, q: string) => ['parties', type, 'lookup', q] as const,
  detail: (type: PartyType, id: string) => ['parties', type, 'detail', id] as const,
};

/** Cursor-paged list; pages accumulate under "Load more". */
export function useParties(type: PartyType, params: Omit<PartyListParams, 'cursor'>) {
  return useInfiniteQuery({
    queryKey: partyKeys.list(type, params),
    queryFn: ({ pageParam }) => partyApi(type).list({ ...params, cursor: pageParam || undefined }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useParty(type: PartyType, id: string | undefined) {
  return useQuery({ queryKey: partyKeys.detail(type, id ?? ''), queryFn: () => partyApi(type).get(id!), enabled: Boolean(id) });
}

/** ACTIVE parties matching the term (display name, code or GSTIN), 20 rows. */
export function usePartyLookup(type: PartyType, term: string, enabled = true) {
  return useQuery({ queryKey: partyKeys.lookup(type, term), queryFn: () => partyApi(type).lookup(term || undefined), placeholderData: keepPreviousData, staleTime: 30_000, enabled });
}

function useInvalidateParty(type: PartyType) {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: ['parties', type, 'list'] });
    void qc.invalidateQueries({ queryKey: ['parties', type, 'lookup'] });
    if (id) void qc.invalidateQueries({ queryKey: partyKeys.detail(type, id) });
  };
}

export function useCreateParty(type: PartyType) {
  const invalidate = useInvalidateParty(type);
  return useMutation({ mutationFn: ({ payload, idempotencyKey }: { payload: PartyPayload; idempotencyKey?: string }) => partyApi(type).create(payload, idempotencyKey), onSuccess: () => invalidate() });
}
export function usePatchParty(type: PartyType) {
  const invalidate = useInvalidateParty(type);
  return useMutation({ mutationFn: ({ id, patch, version }: { id: string; patch: PartyPatch; version: number }) => partyApi(type).patch(id, patch, version), onSuccess: (_d, v) => invalidate(v.id) });
}
export function usePartyStatus(type: PartyType) {
  const invalidate = useInvalidateParty(type);
  return useMutation({ mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'INACTIVE' }) => partyApi(type).setStatus(id, status), onSuccess: (_d, v) => invalidate(v.id) });
}
export function useBlockParty(type: PartyType) {
  const invalidate = useInvalidateParty(type);
  return useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => partyApi(type).block(id, reason), onSuccess: (_d, v) => invalidate(v.id) });
}
export function useUnblockParty(type: PartyType) {
  const invalidate = useInvalidateParty(type);
  return useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => partyApi(type).unblock(id, reason), onSuccess: (_d, v) => invalidate(v.id) });
}
export function useDeleteParty(type: PartyType) {
  const invalidate = useInvalidateParty(type);
  return useMutation({ mutationFn: (id: string) => partyApi(type).remove(id), onSuccess: () => invalidate() });
}

/* ---- sub-resources ------------------------------------------------------------ */

export function useAddAddress(type: PartyType, partyId: string) {
  const invalidate = useInvalidateParty(type);
  return useMutation({ mutationFn: (payload: AddressPayload) => partyApi(type).addAddress(partyId, payload), onSuccess: () => invalidate(partyId) });
}
export function useRemoveAddress(type: PartyType, partyId: string) {
  const invalidate = useInvalidateParty(type);
  return useMutation({ mutationFn: (subId: string) => partyApi(type).removeAddress(partyId, subId), onSuccess: () => invalidate(partyId) });
}
export function useAddContact(type: PartyType, partyId: string) {
  const invalidate = useInvalidateParty(type);
  return useMutation({ mutationFn: (payload: ContactPayload) => partyApi(type).addContact(partyId, payload), onSuccess: () => invalidate(partyId) });
}
export function useRemoveContact(type: PartyType, partyId: string) {
  const invalidate = useInvalidateParty(type);
  return useMutation({ mutationFn: (subId: string) => partyApi(type).removeContact(partyId, subId), onSuccess: () => invalidate(partyId) });
}
export function useAddBankAccount(type: PartyType, partyId: string) {
  const invalidate = useInvalidateParty(type);
  return useMutation({ mutationFn: (payload: BankAccountPayload) => partyApi(type).addBankAccount(partyId, payload), onSuccess: () => invalidate(partyId) });
}
export function useRemoveBankAccount(type: PartyType, partyId: string) {
  const invalidate = useInvalidateParty(type);
  return useMutation({ mutationFn: (subId: string) => partyApi(type).removeBankAccount(partyId, subId), onSuccess: () => invalidate(partyId) });
}
