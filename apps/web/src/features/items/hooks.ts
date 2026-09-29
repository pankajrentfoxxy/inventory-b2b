import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ItemPayload } from '@b2b/shared';
import { itemApi } from './api';
import type { ItemListParams } from './types';

export const itemKeys = {
  all: ['items'] as const,
  list: (params: Partial<ItemListParams>) => ['items', 'list', params] as const,
  detail: (id: string) => ['items', 'detail', id] as const,
};

export function useItems(params: Partial<ItemListParams>, enabled = true) {
  return useQuery({ queryKey: itemKeys.list(params), queryFn: () => itemApi.list(params), placeholderData: keepPreviousData, enabled });
}

/** Lightweight active-item search for pickers. */
export function useItemSearch(term: string) {
  return useQuery({ queryKey: itemKeys.list({ search: term, status: 'ACTIVE', limit: 20, sortBy: 'name', sortOrder: 'asc' }), queryFn: () => itemApi.list({ search: term, status: 'ACTIVE', limit: 20, sortBy: 'name', sortOrder: 'asc' }), placeholderData: keepPreviousData, staleTime: 30_000 });
}

function useInvalidateItems() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: itemKeys.all });
}

export function useCreateItem() {
  const invalidate = useInvalidateItems();
  return useMutation({ mutationFn: (payload: ItemPayload) => itemApi.create(payload), onSuccess: invalidate });
}
export function useUpdateItem() {
  const invalidate = useInvalidateItems();
  return useMutation({ mutationFn: ({ id, payload }: { id: string; payload: ItemPayload }) => itemApi.update(id, payload), onSuccess: invalidate });
}
export function useItemStatus() {
  const invalidate = useInvalidateItems();
  return useMutation({ mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => itemApi.setActive(id, isActive), onSuccess: invalidate });
}
export function useDeleteItem() {
  const invalidate = useInvalidateItems();
  return useMutation({ mutationFn: (id: string) => itemApi.remove(id), onSuccess: invalidate });
}
