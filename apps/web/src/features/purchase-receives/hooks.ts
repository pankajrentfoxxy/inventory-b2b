import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PurchaseReceivePayload } from '@b2b/shared';
import { receiveApi } from './api';
import type { ReceiveListParams } from './types';

export const receiveKeys = {
  all: ['purchase-receives'] as const,
  list: (params: Partial<ReceiveListParams>) => ['purchase-receives', 'list', params] as const,
  detail: (id: string) => ['purchase-receives', 'detail', id] as const,
  nextNumber: ['purchase-receives', 'next-number'] as const,
};

export function usePurchaseReceives(params: Partial<ReceiveListParams>) {
  return useQuery({ queryKey: receiveKeys.list(params), queryFn: () => receiveApi.list(params), placeholderData: keepPreviousData });
}
export function usePurchaseReceive(id: string | undefined) {
  return useQuery({ queryKey: receiveKeys.detail(id ?? ''), queryFn: () => receiveApi.get(id!), enabled: Boolean(id) });
}
export function useNextReceiveNumber(enabled: boolean) {
  return useQuery({ queryKey: receiveKeys.nextNumber, queryFn: receiveApi.nextNumber, enabled, staleTime: 0 });
}

function useInvalidateReceives() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: receiveKeys.all });
    void qc.invalidateQueries({ queryKey: ['purchase-orders'] });
    void qc.invalidateQueries({ queryKey: ['vendors', 'transactions'] });
  };
}

export function useCreatePurchaseReceive() {
  const invalidate = useInvalidateReceives();
  return useMutation({ mutationFn: (payload: PurchaseReceivePayload) => receiveApi.create(payload), onSuccess: invalidate });
}
export function useCancelPurchaseReceive() {
  const invalidate = useInvalidateReceives();
  return useMutation({ mutationFn: ({ id, reason }: { id: string; reason?: string }) => receiveApi.cancel(id, reason), onSuccess: invalidate });
}
