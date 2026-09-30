/**
 * Where platform administrators' permissions come from.
 *   Phase 1: `platform_role_assignments` in auth_db.
 *   Phase 2: svc-iam (`GET /internal/v1/users/{id}/platform-permissions`) when IAM_URL is set.
 */
import { PLATFORM_ROLES, resolvePlatformRolePermissions } from '@b2b/contracts';
import { createServiceClient, type ServiceTokenSource } from '@b2b/platform-kit';
import type { PrismaClient } from '../db.js';

export interface PlatformDirectory {
  permissionsFor(userId: string): Promise<string[]>;
}

export class LocalPlatformDirectory implements PlatformDirectory {
  constructor(private readonly prisma: PrismaClient) {}
  async permissionsFor(userId: string): Promise<string[]> {
    const roles = await this.prisma.platformRoleAssignment.findMany({ where: { userId } });
    const perms = new Set<string>();
    for (const r of roles) {
      const def = PLATFORM_ROLES.find((p) => p.key === r.role);
      if (def) for (const c of resolvePlatformRolePermissions(def)) perms.add(c);
    }
    return [...perms];
  }
}

export class IamPlatformDirectory implements PlatformDirectory {
  private readonly client;
  constructor(iamUrl: string, tokens: ServiceTokenSource) {
    this.client = createServiceClient({ targetService: 'svc-iam', baseUrl: iamUrl, tokens });
  }
  async permissionsFor(userId: string): Promise<string[]> {
    const res = await this.client.call<{ data: { permissions: string[] } }>(`/internal/v1/users/${userId}/platform-permissions`, { correlationId: `auth-platform-${userId}`, retries: 1 });
    return res.data.permissions;
  }
}
