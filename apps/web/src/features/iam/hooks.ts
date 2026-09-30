import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { auditApi, iamApi } from './api';
import type { AuditQuery, CloneRolePayload, CreateRolePayload, InvitePayload, MemberCommand, MembersQuery, WarehouseScopePayload } from './types';

export const iamKeys = {
  all: ['iam'] as const,
  permissions: ['iam', 'permissions'] as const,
  roles: ['iam', 'roles'] as const,
  members: (q: MembersQuery) => ['iam', 'members', q] as const,
  invitations: ['iam', 'invitations'] as const,
  warehouses: ['iam', 'warehouses'] as const,
  audit: (q: AuditQuery) => ['audit', 'tenant', q] as const,
};

export function usePermissionCatalog(enabled = true) {
  return useQuery({ queryKey: iamKeys.permissions, queryFn: iamApi.permissions, staleTime: 10 * 60_000, enabled });
}

export function useRoles(enabled = true) {
  return useQuery({ queryKey: iamKeys.roles, queryFn: iamApi.roles, staleTime: 60_000, enabled });
}

export function useMembers(q: MembersQuery) {
  return useQuery({ queryKey: iamKeys.members(q), queryFn: () => iamApi.members(q), placeholderData: keepPreviousData });
}

export function useInvitations(enabled = true) {
  return useQuery({ queryKey: iamKeys.invitations, queryFn: iamApi.invitations, enabled });
}

export function useWarehouseOptions(enabled = true) {
  return useQuery({ queryKey: iamKeys.warehouses, queryFn: iamApi.warehouses, staleTime: 5 * 60_000, enabled, retry: false });
}

function useInvalidateIam() {
  const qc = useQueryClient();
  return {
    roles: () => void qc.invalidateQueries({ queryKey: iamKeys.roles }),
    members: () => {
      void qc.invalidateQueries({ queryKey: ['iam', 'members'] });
      void qc.invalidateQueries({ queryKey: iamKeys.roles }); // member counts
    },
    invitations: () => void qc.invalidateQueries({ queryKey: iamKeys.invitations }),
  };
}

/* ---- roles ---------------------------------------------------------------- */

export function useCreateRole() {
  const inv = useInvalidateIam();
  return useMutation({ mutationFn: (payload: CreateRolePayload) => iamApi.createRole(payload), onSuccess: inv.roles });
}

export function useCloneRole() {
  const inv = useInvalidateIam();
  return useMutation({ mutationFn: ({ id, payload }: { id: string; payload: CloneRolePayload }) => iamApi.cloneRole(id, payload), onSuccess: inv.roles });
}

export function useReplaceRolePermissions() {
  const inv = useInvalidateIam();
  return useMutation({ mutationFn: ({ id, permissionCodes, version }: { id: string; permissionCodes: string[]; version: number }) => iamApi.replaceRolePermissions(id, permissionCodes, version), onSuccess: inv.roles });
}

export function useDeleteRole() {
  const inv = useInvalidateIam();
  return useMutation({ mutationFn: (id: string) => iamApi.deleteRole(id), onSuccess: inv.roles });
}

/* ---- members & invitations ------------------------------------------------- */

export function useInviteMember() {
  const inv = useInvalidateIam();
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: { payload: InvitePayload; idempotencyKey: string }) => iamApi.invite(payload, idempotencyKey),
    onSuccess: () => {
      inv.invitations();
      inv.members();
    },
  });
}

export function useResendInvitation() {
  const inv = useInvalidateIam();
  return useMutation({ mutationFn: (id: string) => iamApi.resendInvitation(id), onSuccess: inv.invitations });
}

export function useRevokeInvitation() {
  const inv = useInvalidateIam();
  return useMutation({ mutationFn: (id: string) => iamApi.revokeInvitation(id), onSuccess: inv.invitations });
}

export function useReplaceMemberRoles() {
  const inv = useInvalidateIam();
  return useMutation({ mutationFn: ({ id, roleIds }: { id: string; roleIds: string[] }) => iamApi.replaceMemberRoles(id, roleIds), onSuccess: inv.members });
}

export function useTransitionMember() {
  const inv = useInvalidateIam();
  return useMutation({ mutationFn: ({ id, command, reason }: { id: string; command: MemberCommand; reason: string }) => iamApi.transitionMember(id, command, reason), onSuccess: inv.members });
}

export function useSetWarehouseScope() {
  const inv = useInvalidateIam();
  return useMutation({ mutationFn: ({ id, payload }: { id: string; payload: WarehouseScopePayload }) => iamApi.setWarehouseScope(id, payload), onSuccess: inv.members });
}

/* ---- audit ------------------------------------------------------------------ */

/** Cursor-paged tenant audit trail; `fetchNextPage` powers the "Load more" button. */
export function useTenantAudit(q: AuditQuery) {
  return useInfiniteQuery({
    queryKey: iamKeys.audit(q),
    queryFn: ({ pageParam }) => auditApi.list({ ...q, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
