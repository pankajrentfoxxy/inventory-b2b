import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { VendorPayload, VendorStatus } from '@b2b/shared';
import { vendorApi, type VendorListParams } from './api';

export const vendorKeys = {
  all: ['vendors'] as const,
  list: (params: VendorListParams) => ['vendors', 'list', params] as const,
  detail: (id: string) => ['vendors', 'detail', id] as const,
  activity: (id: string, page: number) => ['vendors', 'activity', id, page] as const,
  notes: (id: string) => ['vendors', 'notes', id] as const,
  documents: (id: string) => ['vendors', 'documents', id] as const,
  transactions: (id: string) => ['vendors', 'transactions', id] as const,
  formOptions: ['vendors', 'form-options'] as const,
};

export function useVendors(params: VendorListParams, enabled = true) {
  return useQuery({ queryKey: vendorKeys.list(params), queryFn: () => vendorApi.list(params), placeholderData: keepPreviousData, enabled });
}

export function useVendor(id: string | undefined) {
  return useQuery({ queryKey: vendorKeys.detail(id ?? ''), queryFn: () => vendorApi.get(id!), enabled: Boolean(id) });
}

export function useVendorFormOptions() {
  return useQuery({ queryKey: vendorKeys.formOptions, queryFn: vendorApi.formOptions, staleTime: 5 * 60_000 });
}

export function useVendorActivity(id: string, page: number) {
  return useQuery({ queryKey: vendorKeys.activity(id, page), queryFn: () => vendorApi.activity(id, page), placeholderData: keepPreviousData });
}

export function useVendorNotes(id: string) {
  return useQuery({ queryKey: vendorKeys.notes(id), queryFn: () => vendorApi.notes(id) });
}

export function useVendorDocuments(id: string) {
  return useQuery({ queryKey: vendorKeys.documents(id), queryFn: () => vendorApi.documents(id) });
}

export function useVendorTransactions(id: string) {
  return useQuery({ queryKey: vendorKeys.transactions(id), queryFn: () => vendorApi.transactions(id) });
}

/** Invalidates everything for a vendor after any write so detail, list and activity stay in sync. */
function useInvalidateVendor() {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: ['vendors', 'list'] });
    if (id) {
      void qc.invalidateQueries({ queryKey: vendorKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: ['vendors', 'activity', id] });
      void qc.invalidateQueries({ queryKey: vendorKeys.notes(id) });
      void qc.invalidateQueries({ queryKey: vendorKeys.documents(id) });
    }
  };
}

export function useCreateVendor() {
  const invalidate = useInvalidateVendor();
  return useMutation({ mutationFn: (payload: VendorPayload) => vendorApi.create(payload), onSuccess: () => invalidate() });
}

export function useUpdateVendor(id: string) {
  const invalidate = useInvalidateVendor();
  return useMutation({ mutationFn: (payload: VendorPayload) => vendorApi.update(id, payload), onSuccess: () => invalidate(id) });
}

export function useVendorStatusMutation() {
  const invalidate = useInvalidateVendor();
  return useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: VendorStatus; reason?: string }) => vendorApi.updateStatus(id, status, reason),
    onSuccess: (_d, vars) => invalidate(vars.id),
  });
}

export function useDeleteVendor() {
  const invalidate = useInvalidateVendor();
  return useMutation({ mutationFn: (id: string) => vendorApi.remove(id), onSuccess: (_d, id) => invalidate(id) });
}

/** Generic helper for the row-level sub-resource mutations on the detail page. */
export function useVendorChildMutation<TVars>(vendorId: string, fn: (vars: TVars) => Promise<unknown>) {
  const invalidate = useInvalidateVendor();
  return useMutation({ mutationFn: fn, onSuccess: () => invalidate(vendorId) });
}
