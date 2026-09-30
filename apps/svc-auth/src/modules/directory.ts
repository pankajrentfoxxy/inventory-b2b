/**
 * Where a tenant user's memberships and effective permissions come from.
 *   Phase 1: the bootstrap table in auth_db (owner only, all tenant permissions).
 *   Phase 2: svc-iam `GET /internal/v1/users/{id}/memberships` (roles, permissions, permission version).
 * Selected by config (IAM_URL). Tenant status comes from the local replica fed by tenant events,
 * with a synchronous fallback to svc-tenant on a miss.
 */
import { TENANT_PERMISSION_CODES } from '@b2b/contracts';
import { createServiceClient, type ServiceTokenSource } from '@b2b/platform-kit';
import type { PrismaClient } from '../db.js';

export interface MembershipInfo {
  membershipId: string;
  tenantId: string;
  tenantName: string | null;
  roleKeys: string[];
  permissions: string[];
  permissionVersion: number;
  status: string;
  allWarehouses?: boolean;
  warehouseIds?: string[];
}

export interface MembershipDirectory {
  listActive(userId: string): Promise<MembershipInfo[]>;
  /** Re-resolves one membership (used on refresh so permission changes propagate). */
  get(membershipId: string): Promise<MembershipInfo | null>;
}

export class BootstrapDirectory implements MembershipDirectory {
  constructor(private readonly prisma: PrismaClient) {}

  private toInfo(row: { id: string; tenantId: string; status: string; role: string }): MembershipInfo {
    return { membershipId: row.id, tenantId: row.tenantId, tenantName: null, roleKeys: [row.role], permissions: [...TENANT_PERMISSION_CODES], permissionVersion: 1, status: row.status };
  }

  async listActive(userId: string): Promise<MembershipInfo[]> {
    const rows = await this.prisma.tenantMembershipBootstrap.findMany({ where: { userId, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => this.toInfo(r));
  }

  async get(membershipId: string): Promise<MembershipInfo | null> {
    const row = await this.prisma.tenantMembershipBootstrap.findUnique({ where: { id: membershipId } });
    return row ? this.toInfo(row) : null;
  }
}

interface IamMembershipsResponse {
  data: MembershipInfo[];
}

export class IamDirectory implements MembershipDirectory {
  private readonly client;
  constructor(iamUrl: string, tokens: ServiceTokenSource) {
    this.client = createServiceClient({ targetService: 'svc-iam', baseUrl: iamUrl, tokens });
  }

  async listActive(userId: string): Promise<MembershipInfo[]> {
    const res = await this.client.call<IamMembershipsResponse>(`/internal/v1/users/${userId}/memberships?status=ACTIVE`, { correlationId: `auth-${userId}`, retries: 1 });
    return res.data;
  }

  async get(membershipId: string): Promise<MembershipInfo | null> {
    try {
      const res = await this.client.call<{ data: MembershipInfo }>(`/internal/v1/memberships/${membershipId}/effective-permissions`, { correlationId: `auth-${membershipId}`, retries: 1 });
      return res.data;
    } catch (err) {
      if ((err as { status?: number }).status === 404) return null;
      throw err;
    }
  }
}

/* ---- tenant status ------------------------------------------------------ */

export interface TenantStatusSource {
  get(tenantId: string): Promise<{ status: string; version: number } | null>;
}

export class ReplicaTenantStatus implements TenantStatusSource {
  private readonly fallback;
  constructor(
    private readonly prisma: PrismaClient,
    tenantUrl: string | undefined,
    tokens: ServiceTokenSource,
  ) {
    this.fallback = tenantUrl ? createServiceClient({ targetService: 'svc-tenant', baseUrl: tenantUrl, tokens }) : null;
  }

  async get(tenantId: string) {
    const row = await this.prisma.tenantStatusReplica.findUnique({ where: { tenantId } });
    if (row) return { status: row.status, version: row.version };
    if (!this.fallback) return null;
    try {
      const res = await this.fallback.call<{ data: { status: string; version: number } }>(`/internal/v1/tenants/${tenantId}/status`, { correlationId: `auth-status-${tenantId}` });
      await this.prisma.tenantStatusReplica.upsert({ where: { tenantId }, update: { status: res.data.status, version: res.data.version }, create: { tenantId, status: res.data.status, version: res.data.version } });
      return res.data;
    } catch (err) {
      if ((err as { status?: number }).status === 404) return null;
      throw err;
    }
  }
}
