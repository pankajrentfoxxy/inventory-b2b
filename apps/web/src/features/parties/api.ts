import type { AxiosRequestConfig } from 'axios';
import type { PartyFormPayload } from '@b2b/shared';
import { api, unwrap, withIdempotencyKey } from '../../lib/api';
import type { AuditEvent } from '../iam/types';
import { PARTY_META, type CursorPage, type GstLookupResult, type PartyDetail, type PartyListItem, type PartyListParams, type PartyPurchaseOrderRow, type PartySnapshot, type PartyType } from './types';

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
    /** Top-level `{ data, nextCursor }` (not double-wrapped). */
    list: (params: PartyListParams) => api.get<CursorPage<PartyListItem>>(root, { params: clean(params) }).then((r) => r.data),
    lookup: (q?: string) => api.get<{ data: PartySnapshot[] }>(`${BASE}/lookups/${PARTY_META[type].path}`, { params: clean({ q }) }).then(unwrap),
    /** Vendor-form shaped read / create / full update. */
    getForm: (id: string) => api.get<{ data: PartyDetail }>(`${root}/${id}/form`).then(unwrap),
    createForm: (payload: PartyFormPayload, idempotencyKey: string) => api.post<{ data: PartyDetail }>(`${root}/form`, payload, withIdempotencyKey(idempotencyKey)).then(unwrap),
    updateForm: (id: string, payload: PartyFormPayload, version: number) => api.put<{ data: PartyDetail }>(`${root}/${id}/form`, payload, ifMatch(version)).then(unwrap),
    setStatus: (id: string, status: 'ACTIVE' | 'INACTIVE') => api.post<{ data: unknown }>(`${root}/${id}/status`, { status }).then(unwrap),
    block: (id: string, reason: string) => api.post<{ data: unknown }>(`${root}/${id}/block`, { reason }).then(unwrap),
    unblock: (id: string, reason: string) => api.post<{ data: unknown }>(`${root}/${id}/unblock`, { reason }).then(unwrap),
    remove: (id: string) => api.delete<{ data: { id: string; deleted: boolean } }>(`${root}/${id}`).then(unwrap),
    /** Audited; returns the full account number. Show it only after the click and re-mask after 30 s. */
    revealBankAccount: (id: string, bankId: string) => api.post<{ data: { id: string; accountNumber: string } }>(`${root}/${id}/bank-accounts/${bankId}/reveal`).then(unwrap),
  };
}

/** GSTIN lookup (public route, both party types). 501 = no provider configured. */
export const gstLookup = (gstin: string) => api.get<{ data: GstLookupResult }>('/public/gst/lookup', { params: { gstin } }).then(unwrap);

/** Purchase orders raised against a supplier (svc-procurement). */
export const partyPurchaseOrders = (supplierId: string) => api.get<{ data: PartyPurchaseOrderRow[] }>('/v1/procurement/purchase-orders', { params: { supplierId, limit: 50 } }).then(unwrap);

/** Audit trail for one entity (svc-audit); top-level `{ data, nextCursor }`. */
export const partyAudit = (entityId: string, cursor?: string) => api.get<CursorPage<AuditEvent>>('/v1/audit', { params: clean({ entityId, limit: 50, cursor }) }).then((r) => r.data);
