import { api, unwrap, withIdempotencyKey } from '../../lib/api';
import type { AuditEvent, AuditQuery } from '../iam/types';
import type { AddStaffPayload, CreateTenantPayload, CursorPage, Dashboard, PlatformRole, PlatformStaff, Tenant, TenantCommand, TenantCommandBody, TenantDetail, TenantListQuery, TenantSettings, TenantSettingsPayload, UpdateTenantPayload } from './types';

const BASE = '/v1/platform';

function clean<T extends Record<string, unknown>>(params: T): Partial<T> {
  const out: Partial<T> = {};
  (Object.keys(params) as (keyof T)[]).forEach((k) => {
    const v = params[k];
    if (v !== '' && v !== undefined && v !== null) out[k] = v;
  });
  return out;
}

/** The platform audit proxy returns svc-audit's body verbatim; be tolerant of an extra `data` wrapper. */
function asCursorPage<T>(body: unknown): CursorPage<T> {
  const b = body as { data?: unknown; nextCursor?: string | null };
  if (Array.isArray(b?.data)) return { data: b.data as T[], nextCursor: b.nextCursor ?? null };
  const inner = b?.data as { data?: T[]; nextCursor?: string | null } | undefined;
  return { data: inner?.data ?? [], nextCursor: inner?.nextCursor ?? null };
}

export const platformApi = {
  dashboard: () => api.get<{ data: Dashboard }>(`${BASE}/dashboard`).then(unwrap),

  /** Tenants live under `/vendors` in svc-tenant (the plan's "supplier"/"tenant" naming; see CLAUDE.md). */
  listTenants: (q: TenantListQuery) => api.get<CursorPage<Tenant>>(`${BASE}/vendors`, { params: clean(q as Record<string, unknown>) }).then((r) => r.data),
  getTenant: (id: string) => api.get<{ data: TenantDetail }>(`${BASE}/vendors/${id}`).then(unwrap),
  createTenant: (payload: CreateTenantPayload, idempotencyKey: string) => api.post<{ data: Tenant }>(`${BASE}/vendors`, payload, withIdempotencyKey(idempotencyKey)).then(unwrap),
  updateTenant: (id: string, payload: UpdateTenantPayload, version: number) => api.patch<{ data: Tenant }>(`${BASE}/vendors/${id}`, payload, { headers: { 'If-Match': String(version) } }).then(unwrap),
  updateSettings: (id: string, payload: TenantSettingsPayload) => api.put<{ data: TenantSettings }>(`${BASE}/vendors/${id}/settings`, payload).then(unwrap),
  transition: (id: string, command: TenantCommand, body: TenantCommandBody, idempotencyKey: string) => api.post<{ data: Tenant }>(`${BASE}/vendors/${id}/${command}`, body, withIdempotencyKey(idempotencyKey)).then(unwrap),
  resendOwnerInvite: (id: string) => api.post<{ data: { requested: boolean } }>(`${BASE}/vendors/${id}/resend-owner-invite`).then(unwrap),

  audit: (q: AuditQuery) => api.get<unknown>(`${BASE}/audit`, { params: clean(q as Record<string, unknown>) }).then((r) => asCursorPage<AuditEvent>(r.data)),

  platformRoles: () => api.get<{ data: PlatformRole[] }>(`${BASE}/iam/roles`).then(unwrap),
  staff: () => api.get<{ data: PlatformStaff[] }>(`${BASE}/iam/staff`).then(unwrap),
  addStaff: (payload: AddStaffPayload) => api.post<{ data: { id: string; roleKeys: string[]; permissionVersion: number } }>(`${BASE}/iam/staff`, payload).then(unwrap),
  setStaffRoles: (id: string, roleKeys: string[]) => api.put<{ data: { id: string; roleKeys: string[]; permissionVersion: number } }>(`${BASE}/iam/staff/${id}/roles`, { roleKeys }).then(unwrap),
};
