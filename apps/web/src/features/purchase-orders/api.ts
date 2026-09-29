import type { PurchaseOrderPayload } from '@b2b/shared';
import { api } from '../../lib/api';
import type { Paginated, PoActivityItem, PoDetail, PoDocument, PoFormOptions, PoListParams, PoListResponse } from './types';

export const poApi = {
  list: (params: Partial<PoListParams>) => api.get<PoListResponse>('/purchase-orders', { params }).then((r) => r.data),
  get: (id: string) => api.get<{ data: PoDetail }>(`/purchase-orders/${id}`).then((r) => r.data.data),
  nextNumber: () => api.get<{ data: PoFormOptions['nextNumber'] }>('/purchase-orders/next-number').then((r) => r.data.data),
  create: (payload: PurchaseOrderPayload, issue: boolean) => api.post<{ data: PoDetail }>('/purchase-orders', payload, { params: issue ? { issue: 'true' } : undefined }).then((r) => r.data.data),
  update: (id: string, payload: PurchaseOrderPayload) => api.put<{ data: PoDetail }>(`/purchase-orders/${id}`, payload).then((r) => r.data.data),
  remove: (id: string) => api.delete(`/purchase-orders/${id}`).then((r) => r.data),
  issue: (id: string) => api.post<{ data: PoDetail }>(`/purchase-orders/${id}/issue`).then((r) => r.data.data),
  cancel: (id: string, reason?: string) => api.post<{ data: PoDetail }>(`/purchase-orders/${id}/cancel`, { reason }).then((r) => r.data.data),
  close: (id: string) => api.post<{ data: PoDetail }>(`/purchase-orders/${id}/close`).then((r) => r.data.data),
  reopen: (id: string) => api.post<{ data: PoDetail }>(`/purchase-orders/${id}/reopen`).then((r) => r.data.data),
  activity: (id: string, page = 1, limit = 25) => api.get<Paginated<PoActivityItem>>(`/purchase-orders/${id}/activity`, { params: { page, limit } }).then((r) => r.data),

  documents: (id: string) => api.get<{ data: PoDocument[] }>(`/purchase-orders/${id}/documents`).then((r) => r.data.data),
  uploadDocument: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<{ data: PoDocument }>(`/purchase-orders/${id}/documents`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data.data);
  },
  downloadDocument: async (id: string, doc: PoDocument) => {
    const res = await api.get(`/purchase-orders/${id}/documents/${doc.id}/download`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  removeDocument: (id: string, documentId: string) => api.delete(`/purchase-orders/${id}/documents/${documentId}`).then((r) => r.data),

  formOptions: () => api.get<{ data: PoFormOptions }>('/settings/purchase-order-form-options').then((r) => r.data.data),
};
