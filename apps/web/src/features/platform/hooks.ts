import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuditQuery } from '../iam/types';
import { platformApi } from './api';
import type { AddStaffPayload, CreateTenantPayload, TenantCommand, TenantCommandBody, TenantListQuery, TenantSettingsPayload, UpdateTenantPayload } from './types';

export const platformKeys = {
  dashboard: ['platform', 'dashboard'] as const,
  tenants: (q: TenantListQuery) => ['platform', 'tenants', q] as const,
  tenant: (id: string) => ['platform', 'tenant', id] as const,
  audit: (q: AuditQuery) => ['audit', 'platform', q] as const,
  roles: ['platform', 'iam', 'roles'] as const,
  staff: ['platform', 'iam', 'staff'] as const,
};

export function useDashboard() {
  return useQuery({ queryKey: platformKeys.dashboard, queryFn: platformApi.dashboard, refetchInterval: 60_000 });
}

/** Cursor-paged tenant list; `fetchNextPage` powers "Load more". */
export function useTenants(q: TenantListQuery) {
  return useInfiniteQuery({
    queryKey: platformKeys.tenants(q),
    queryFn: ({ pageParam }) => platformApi.listTenants({ ...q, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useTenant(id: string | undefined) {
  return useQuery({ queryKey: platformKeys.tenant(id ?? ''), queryFn: () => platformApi.getTenant(id!), enabled: Boolean(id) });
}

function useInvalidateTenant() {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: ['platform', 'tenants'] });
    void qc.invalidateQueries({ queryKey: platformKeys.dashboard });
    if (id) void qc.invalidateQueries({ queryKey: platformKeys.tenant(id) });
  };
}

export function useCreateTenant() {
  const invalidate = useInvalidateTenant();
  return useMutation({ mutationFn: ({ payload, idempotencyKey }: { payload: CreateTenantPayload; idempotencyKey: string }) => platformApi.createTenant(payload, idempotencyKey), onSuccess: () => invalidate() });
}

export function useUpdateTenant() {
  const invalidate = useInvalidateTenant();
  return useMutation({ mutationFn: ({ id, payload, version }: { id: string; payload: UpdateTenantPayload; version: number }) => platformApi.updateTenant(id, payload, version), onSuccess: (_d, v) => invalidate(v.id) });
}

export function useUpdateTenantSettings() {
  const invalidate = useInvalidateTenant();
  return useMutation({ mutationFn: ({ id, payload }: { id: string; payload: TenantSettingsPayload }) => platformApi.updateSettings(id, payload), onSuccess: (_d, v) => invalidate(v.id) });
}

export function useTenantTransition() {
  const invalidate = useInvalidateTenant();
  return useMutation({
    mutationFn: ({ id, command, body, idempotencyKey }: { id: string; command: TenantCommand; body: TenantCommandBody; idempotencyKey: string }) => platformApi.transition(id, command, body, idempotencyKey),
    onSuccess: (_d, v) => invalidate(v.id),
  });
}

export function useResendOwnerInvite() {
  const invalidate = useInvalidateTenant();
  return useMutation({ mutationFn: (id: string) => platformApi.resendOwnerInvite(id), onSuccess: (_d, id) => invalidate(id) });
}

export function usePlatformAudit(q: AuditQuery) {
  return useInfiniteQuery({
    queryKey: platformKeys.audit(q),
    queryFn: ({ pageParam }) => platformApi.audit({ ...q, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/* ---- platform staff -------------------------------------------------------------- */

export function usePlatformRoles(enabled = true) {
  return useQuery({ queryKey: platformKeys.roles, queryFn: platformApi.platformRoles, staleTime: 5 * 60_000, enabled });
}

export function usePlatformStaff() {
  return useQuery({ queryKey: platformKeys.staff, queryFn: platformApi.staff });
}

export function useAddStaff() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (payload: AddStaffPayload) => platformApi.addStaff(payload), onSuccess: () => void qc.invalidateQueries({ queryKey: platformKeys.staff }) });
}

export function useSetStaffRoles() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, roleKeys }: { id: string; roleKeys: string[] }) => platformApi.setStaffRoles(id, roleKeys), onSuccess: () => void qc.invalidateQueries({ queryKey: platformKeys.staff }) });
}
