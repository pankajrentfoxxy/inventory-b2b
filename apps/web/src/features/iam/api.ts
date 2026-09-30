import { api, unwrap, withIdempotencyKey } from '../../lib/api';
import type {
  AuditEvent,
  AuditQuery,
  CloneRolePayload,
  CreateRolePayload,
  CursorPage,
  Invitation,
  InvitePayload,
  Member,
  MemberCommand,
  MembersQuery,
  PermissionGroup,
  Role,
  WarehouseOption,
  WarehouseScopePayload,
} from './types';

const BASE = '/v1/iam';

/** Drops empty-string / undefined params so the API's zod query schema does not see "" for enums. */
function clean<T extends Record<string, unknown>>(params: T): Partial<T> {
  const out: Partial<T> = {};
  (Object.keys(params) as (keyof T)[]).forEach((k) => {
    const v = params[k];
    if (v !== '' && v !== undefined && v !== null) out[k] = v;
  });
  return out;
}

export const iamApi = {
  permissions: () => api.get<{ data: PermissionGroup[] }>(`${BASE}/permissions`).then(unwrap),
  roles: () => api.get<{ data: Role[] }>(`${BASE}/roles`).then(unwrap),
  createRole: (payload: CreateRolePayload) => api.post<{ data: Pick<Role, 'id' | 'key' | 'name' | 'rank' | 'permissionCodes' | 'isSystem' | 'version'> }>(`${BASE}/roles`, payload).then(unwrap),
  cloneRole: (id: string, payload: CloneRolePayload) => api.post<{ data: Pick<Role, 'id' | 'key' | 'name' | 'rank' | 'permissionCodes' | 'isSystem' | 'version'> }>(`${BASE}/roles/${id}/clone`, payload).then(unwrap),
  replaceRolePermissions: (id: string, permissionCodes: string[], version: number) =>
    api.put<{ data: { id: string; permissionCodes: string[]; version: number; affectedMemberships: number } }>(`${BASE}/roles/${id}/permissions`, { permissionCodes }, { headers: { 'If-Match': String(version) } }).then(unwrap),
  deleteRole: (id: string) => api.delete<{ data: { id: string; deleted: boolean } }>(`${BASE}/roles/${id}`).then(unwrap),

  members: (q: MembersQuery) => api.get<{ data: Member[] }>(`${BASE}/members`, { params: clean(q as Record<string, unknown>) }).then(unwrap),
  invitations: () => api.get<{ data: Invitation[] }>(`${BASE}/invitations`).then(unwrap),
  invite: (payload: InvitePayload, idempotencyKey: string) =>
    api.post<{ data: { id: string; email: string; roleIds: string[]; status: string; expiresAt: string } }>(`${BASE}/invitations`, payload, withIdempotencyKey(idempotencyKey)).then(unwrap),
  resendInvitation: (id: string) => api.post<{ data: { id: string; expiresAt: string } }>(`${BASE}/invitations/${id}/resend`).then(unwrap),
  revokeInvitation: (id: string) => api.post<{ data: { id: string; status: string } }>(`${BASE}/invitations/${id}/revoke`).then(unwrap),

  replaceMemberRoles: (id: string, roleIds: string[]) => api.post<{ data: { id: string; roleKeys: string[]; permissionVersion: number } }>(`${BASE}/members/${id}/roles`, { roleIds }).then(unwrap),
  transitionMember: (id: string, command: MemberCommand, reason: string) => api.post<{ data: { id: string; status: string; version: number } }>(`${BASE}/members/${id}/${command}`, { reason }).then(unwrap),
  setWarehouseScope: (id: string, payload: WarehouseScopePayload) =>
    api.put<{ data: { id: string; allWarehouses: boolean; warehouseIds: string[]; permissionVersion: number } }>(`${BASE}/members/${id}/warehouse-scope`, payload).then(unwrap),

  /** Master warehouses for the scope picker (needs warehouse.view; the picker degrades when denied). */
  warehouses: () => api.get<{ data: WarehouseOption[] }>('/v1/master/warehouses').then(unwrap),
};

/** Tenant audit trail. The response is `{ data, nextCursor }` (not wrapped in another `data`). */
export const auditApi = {
  list: (q: AuditQuery) => api.get<CursorPage<AuditEvent>>('/v1/audit', { params: clean(q as Record<string, unknown>) }).then((r) => r.data),
};
