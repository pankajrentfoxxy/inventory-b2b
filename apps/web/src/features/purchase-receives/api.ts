import type { PurchaseReceivePayload } from '@b2b/shared';
import { api } from '../../lib/api';
import type { PurchaseReceive, ReceiveListParams, ReceiveListResponse } from './types';

export const receiveApi = {
  list: (params: Partial<ReceiveListParams>) => api.get<ReceiveListResponse>('/purchase-receives', { params }).then((r) => r.data),
  get: (id: string) => api.get<{ data: PurchaseReceive }>(`/purchase-receives/${id}`).then((r) => r.data.data),
  nextNumber: () => api.get<{ data: { preview: string } }>('/purchase-receives/next-number').then((r) => r.data.data),
  create: (payload: PurchaseReceivePayload) => api.post<{ data: PurchaseReceive }>('/purchase-receives', payload).then((r) => r.data.data),
  cancel: (id: string, reason?: string) => api.post<{ data: PurchaseReceive }>(`/purchase-receives/${id}/cancel`, { reason }).then((r) => r.data.data),
};
