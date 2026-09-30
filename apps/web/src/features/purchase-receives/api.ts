import type { PurchaseReceivePayload } from '@b2b/shared';
import { api, withIdempotencyKey } from '../../lib/api';
import type { PurchaseReceive, ReceiveListParams, ReceiveListResponse } from './types';

export const receiveApi = {
  list: (params: Partial<ReceiveListParams>) => api.get<ReceiveListResponse>('/purchase-receives', { params }).then((r) => r.data),
  get: (id: string) => api.get<{ data: PurchaseReceive }>(`/purchase-receives/${id}`).then((r) => r.data.data),
  nextNumber: () => api.get<{ data: { preview: string } }>('/purchase-receives/next-number').then((r) => r.data.data),
  /** The API requires an Idempotency-Key here so a retried submit never records the goods twice. */
  create: (payload: PurchaseReceivePayload, idempotencyKey: string) =>
    api.post<{ data: PurchaseReceive }>('/purchase-receives', payload, withIdempotencyKey(idempotencyKey)).then((r) => r.data.data),
  cancel: (id: string, reason?: string) => api.post<{ data: PurchaseReceive }>(`/purchase-receives/${id}/cancel`, { reason }).then((r) => r.data.data),
};
