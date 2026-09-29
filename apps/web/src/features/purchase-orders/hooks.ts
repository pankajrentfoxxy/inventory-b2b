import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PurchaseOrderPayload } from '@b2b/shared';
import { poApi } from './api';
import type { PoListParams } from './types';

export const poKeys = {
  all: ['purchase-orders'] as const,
  list: (params: Partial<PoListParams>) => ['purchase-orders', 'list', params] as const,
  detail: (id: string) => ['purchase-orders', 'detail', id] as const,
  activity: (id: string, page: number) => ['purchase-orders', 'activity', id, page] as const,
  documents: (id: string) => ['purchase-orders', 'documents', id] as const,
  formOptions: ['purchase-orders', 'form-options'] as const,
};

export function usePurchaseOrders(params: Partial<PoListParams>, enabled = true) {
  return useQuery({ queryKey: poKeys.list(params), queryFn: () => poApi.list(params), placeholderData: keepPreviousData, enabled });
}
export function usePurchaseOrder(id: string | undefined) {
  return useQuery({ queryKey: poKeys.detail(id ?? ''), queryFn: () => poApi.get(id!), enabled: Boolean(id) });
}
export function usePurchaseOrderFormOptions(enabled = true) {
  return useQuery({ queryKey: poKeys.formOptions, queryFn: poApi.formOptions, staleTime: 60_000, enabled });
}
export function usePurchaseOrderActivity(id: string, page: number) {
  return useQuery({ queryKey: poKeys.activity(id, page), queryFn: () => poApi.activity(id, page), placeholderData: keepPreviousData });
}
export function usePurchaseOrderDocuments(id: string, enabled = true) {
  return useQuery({ queryKey: poKeys.documents(id), queryFn: () => poApi.documents(id), enabled });
}

function useInvalidatePo() {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: ['purchase-orders', 'list'] });
    void qc.invalidateQueries({ queryKey: ['purchase-receives'] });
    void qc.invalidateQueries({ queryKey: ['vendors', 'transactions'] });
    void qc.invalidateQueries({ queryKey: poKeys.formOptions });
    if (id) {
      void qc.invalidateQueries({ queryKey: poKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: ['purchase-orders', 'activity', id] });
      void qc.invalidateQueries({ queryKey: poKeys.documents(id) });
    }
  };
}

export function useCreatePurchaseOrder() {
  const invalidate = useInvalidatePo();
  return useMutation({ mutationFn: ({ payload, issue }: { payload: PurchaseOrderPayload; issue: boolean }) => poApi.create(payload, issue), onSuccess: () => invalidate() });
}
export function useUpdatePurchaseOrder(id: string) {
  const invalidate = useInvalidatePo();
  return useMutation({ mutationFn: (payload: PurchaseOrderPayload) => poApi.update(id, payload), onSuccess: () => invalidate(id) });
}
export function usePurchaseOrderAction() {
  const invalidate = useInvalidatePo();
  return useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: 'issue' | 'cancel' | 'close' | 'reopen' | 'delete'; reason?: string }) => {
      if (action === 'issue') return poApi.issue(id);
      if (action === 'cancel') return poApi.cancel(id, reason);
      if (action === 'close') return poApi.close(id);
      if (action === 'reopen') return poApi.reopen(id);
      return poApi.remove(id);
    },
    onSuccess: (_d, vars) => invalidate(vars.id),
  });
}
export function usePoDocumentMutation<TVars>(id: string, fn: (vars: TVars) => Promise<unknown>) {
  const invalidate = useInvalidatePo();
  return useMutation({ mutationFn: fn, onSuccess: () => invalidate(id) });
}
