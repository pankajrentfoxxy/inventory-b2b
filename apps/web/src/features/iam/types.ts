/** Shapes returned by svc-iam (`/v1/iam`) and svc-audit (`/v1/audit`). Mirrors the service functions, never guessed. */

export interface PermissionEntry {
  code: string;
  description: string;
  sensitive: boolean;
}

export interface PermissionGroup {
  module: string;
  permissions: PermissionEntry[];
}

export interface Role {
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

export type MemberStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'REMOVED';

export interface MemberRole {
  id: string;
  key: string;
  name: string;
  rank: number;
}

export interface Member {
  id: string;
  userId: string;
  email: string;
  fullName: string;
  status: MemberStatus;
  roles: MemberRole[];
  allWarehouses: boolean;
  warehouseIds: string[];
  permissionVersion: number;
  joinedAt: string | null;
  statusReason: string | null;
  version: number;
}

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

export interface Invitation {
  id: string;
  email: string;
  fullName: string | null;
  roleIds: string[];
  /** Embedded by the server; name is null when the role has since been deleted. */
  roles?: { id: string; key: string | null; name: string | null }[];
  warehouseIds: string[];
  status: InvitationStatus;
  invitedByName: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

export interface MembersQuery {
  status?: MemberStatus | '';
  roleId?: string;
}

export interface InvitePayload {
  email: string;
  fullName?: string;
  roleIds: string[];
  warehouseIds?: string[];
}

export interface CreateRolePayload {
  name: string;
  description?: string;
  permissionCodes: string[];
  rank: number;
}

export interface CloneRolePayload {
  name: string;
  rank?: number;
}

export interface WarehouseScopePayload {
  allWarehouses: boolean;
  warehouseIds: string[];
}

export type MemberCommand = 'suspend' | 'reactivate' | 'remove';

/** Minimal warehouse shape from GET /v1/master/warehouses used by the scope picker. */
export interface WarehouseOption {
  id: string;
  code: string;
  name: string;
  status: string;
}

/** One row of svc-audit `audit_events`. */
export interface AuditEvent {
  id: string;
  eventId: string;
  tenantId: string | null;
  producer: string;
  actorType: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  entityVersion: number | null;
  summary: string | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  correlationId: string;
  occurredAt: string;
  recordedAt: string;
}

export interface AuditQuery {
  tenantId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  correlationId?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
}
