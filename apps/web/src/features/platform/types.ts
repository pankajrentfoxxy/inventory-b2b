/** Shapes returned by svc-tenant (`/v1/platform`) and svc-iam (`/v1/platform/iam`). */

export type TenantStatus = 'PENDING' | 'APPROVED' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED' | 'REJECTED';

export const TENANT_STATUSES: TenantStatus[] = ['PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'REJECTED'];

export interface TenantAddress {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  country: string;
}

export interface Tenant {
  id: string;
  code: string;
  legalName: string;
  displayName: string;
  pan: string | null;
  gstin: string | null;
  registeredAddress: TenantAddress | null;
  stateCode: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string | null;
  status: TenantStatus;
  statusReason: string | null;
  source: 'ADMIN_CREATED' | 'APPLICATION' | 'LEGACY_MIGRATION' | string;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  activatedAt: string | null;
  suspendedAt: string | null;
  deactivatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface TenantHistoryRow {
  id: string;
  fromStatus: TenantStatus | null;
  toStatus: TenantStatus;
  reason: string | null;
  actorId: string | null;
  actorName: string | null;
  occurredAt: string;
}

export interface TenantSettings {
  tenantId: string;
  timezone: string;
  fyStartMonth: number;
  baseCurrency: string;
  features: Record<string, unknown>;
  limits: Record<string, unknown>;
}

export interface TenantDetail extends Tenant {
  history: TenantHistoryRow[];
  settings: TenantSettings | null;
}

export interface TenantListQuery {
  status?: TenantStatus | '';
  q?: string;
  limit?: number;
  cursor?: string;
}

export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
}

export interface CreateTenantPayload {
  code?: string;
  legalName: string;
  displayName: string;
  pan?: string;
  gstin?: string;
  registeredAddress: TenantAddress;
  ownerName: string;
  ownerEmail: string;
  ownerPhone?: string;
}

export type UpdateTenantPayload = Partial<Omit<CreateTenantPayload, 'code'>>;

export interface TenantSettingsPayload {
  timezone?: string;
  fyStartMonth?: number;
  baseCurrency?: string;
}

export type TenantCommand = 'approve' | 'reject' | 'activate' | 'suspend' | 'reactivate' | 'deactivate';

export interface TenantCommandBody {
  reason?: string;
  note?: string;
  confirmCode?: string;
}

export interface Dashboard {
  counts: Record<TenantStatus, number>;
  pendingApprovals: { id: string; code: string; displayName: string; createdAt: string; ageHours: number }[];
  recentActions: { tenantId: string; code: string; displayName: string; fromStatus: TenantStatus | null; toStatus: TenantStatus; reason: string | null; actorName: string | null; occurredAt: string }[];
}

/* ---- platform IAM -------------------------------------------------------------- */

export interface PlatformRole {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  rank: number;
  memberCount: number;
  permissionCodes: string[];
  version: number;
}

export interface PlatformStaff {
  id: string;
  userId: string;
  email: string;
  fullName: string;
  status: string;
  roleKeys: string[];
  permissionVersion: number;
}

export interface AddStaffPayload {
  userId: string;
  email: string;
  fullName?: string;
  roleKeys: string[];
}
