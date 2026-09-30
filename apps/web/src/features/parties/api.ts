import type { AxiosRequestConfig } from 'axios';
import { api, unwrap, withIdempotencyKey } from '../../lib/api';
import { PARTY_META, type AddressPayload, type BankAccountPayload, type ContactPayload, type CursorPage, type Party, type PartyAddress, type PartyBankAccount, type PartyContact, type PartyDetail, type PartyListParams, type PartyPatch, type PartyPayload, type PartySnapshot, type PartyType } from './types';

const BASE = '/v1/party';

function clean(params: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) if (v !== '' && v !== undefined && v !== null) out[k] = v;
  return out;
}
const ifMatch = (version: number): AxiosRequestConfig => ({ headers: { 'If-Match': String(version) } });

/** Suppliers and customers share one contract; the type only picks the path. */
export function partyApi(type: PartyType) {
  const root = `${BASE}/${PARTY_META[type].path}`;
  return {
    list: (params: PartyListParams) => api.get<CursorPage<Party>>(root, { params: clean(params) }).then((r) => r.data),
    lookup: (q?: string) => api.get<{ data: PartySnapshot[] }>(`${BASE}/lookups/${PARTY_META[type].path}`, { params: clean({ q }) }).then(unwrap),
    get: (id: string) => api.get<{ data: PartyDetail }>(`${root}/${id}`).then(unwrap),
    create: (payload: PartyPayload, idempotencyKey?: string) => api.post<{ data: Party }>(root, payload, idempotencyKey ? withIdempotencyKey(idempotencyKey) : undefined).then(unwrap),
    patch: (id: string, patch: PartyPatch, version: number) => api.patch<{ data: Party }>(`${root}/${id}`, patch, ifMatch(version)).then(unwrap),
    setStatus: (id: string, status: 'ACTIVE' | 'INACTIVE') => api.post<{ data: Party }>(`${root}/${id}/status`, { status }).then(unwrap),
    block: (id: string, reason: string) => api.post<{ data: Party }>(`${root}/${id}/block`, { reason }).then(unwrap),
    unblock: (id: string, reason: string) => api.post<{ data: Party }>(`${root}/${id}/unblock`, { reason }).then(unwrap),
    remove: (id: string) => api.delete<{ data: { id: string; deleted: boolean } }>(`${root}/${id}`).then(unwrap),
    addAddress: (id: string, payload: AddressPayload) => api.post<{ data: PartyAddress }>(`${root}/${id}/addresses`, payload).then(unwrap),
    removeAddress: (id: string, subId: string) => api.delete<{ data: { id: string; deleted: boolean } }>(`${root}/${id}/addresses/${subId}`).then(unwrap),
    addContact: (id: string, payload: ContactPayload) => api.post<{ data: PartyContact }>(`${root}/${id}/contacts`, payload).then(unwrap),
    removeContact: (id: string, subId: string) => api.delete<{ data: { id: string; deleted: boolean } }>(`${root}/${id}/contacts/${subId}`).then(unwrap),
    addBankAccount: (id: string, payload: BankAccountPayload) => api.post<{ data: PartyBankAccount }>(`${root}/${id}/bank-accounts`, payload).then(unwrap),
    removeBankAccount: (id: string, subId: string) => api.delete<{ data: { id: string; deleted: boolean } }>(`${root}/${id}/bank-accounts/${subId}`).then(unwrap),
    /** Audited; returns the full account number. Show it only after the click and re-mask after 30 s. */
    revealBankAccount: (id: string, subId: string) => api.post<{ data: { id: string; accountNumber: string } }>(`${root}/${id}/bank-accounts/${subId}/reveal`).then(unwrap),
  };
}
