import type { ItemPayload } from '@b2b/shared';
import { api } from '../../lib/api';
import type { Item, ItemListParams, ItemListResponse } from './types';

export const itemApi = {
  list: (params: Partial<ItemListParams>) => api.get<ItemListResponse>('/items', { params }).then((r) => r.data),
  get: (id: string) => api.get<{ data: Item }>(`/items/${id}`).then((r) => r.data.data),
  create: (payload: ItemPayload) => api.post<{ data: Item }>('/items', payload).then((r) => r.data.data),
  update: (id: string, payload: ItemPayload) => api.put<{ data: Item }>(`/items/${id}`, payload).then((r) => r.data.data),
  setActive: (id: string, isActive: boolean) => api.patch<{ data: Item }>(`/items/${id}/status`, { isActive }).then((r) => r.data.data),
  remove: (id: string) => api.delete(`/items/${id}`).then((r) => r.data),
};
