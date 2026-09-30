/**
 * IAM domain (phase-02): permission catalogue sync, system role seeding, custom roles with
 * anti-escalation, memberships and invitations, permission-version propagation.
 *
 * Every tenant operation runs inside `withTenantTx` (RLS context) and re-reads the caller's own
 * membership to evaluate the anti-escalation rules against current data, not token claims.
 */
import {
  EVENT_TYPES,
  PERMISSION_CATALOG,
  PLATFORM_ROLES,
  SYSTEM_ROLES,
  isPlatformPermission,
  isTenantPermission,
  resolvePlatformRolePermissions,
  resolveRolePermissions,
  type SystemRoleDef,
} from '@b2b/contracts';
import { HttpError, businessRuleError, conflict, enqueueEvent, forbidden, notFound, opaqueToken, setTenantContext, sha256, uuidv7, type TenantContext } from '@b2b/platform-kit';
import type { Prisma, PrismaClient, Tx } from '../db.js';

export const PRODUCER = 'svc-iam';

export interface Actor {
  userId: string | null;
  name: string | null;
  membershipId: string | null;
  correlationId: string;
  ip?: string | null;
  userAgent?: string | null;
}
export const actorFrom = (ctx: TenantContext, ip?: string | null, userAgent?: string | null): Actor => ({ userId: ctx.userId, name: ctx.userName, membershipId: ctx.membershipId, correlationId: ctx.correlationId, ip, userAgent });

/** Identity provider seam: production calls svc-auth, tests inject a fake. */
export interface IdentityProvider {
  ensureUser(input: { email: string; fullName: string; password?: string }, correlationId: string): Promise<{ userId: string; status: string }>;
}

export interface MembershipInfo {
  membershipId: string;
  tenantId: string | null;
  tenantName: string | null;
  roleKeys: string[];
  permissions: string[];
  permissionVersion: number;
  status: string;
  allWarehouses: boolean;
  warehouseIds: string[];
}

type MembershipWithRoles = Prisma.MembershipGetPayload<{ include: { roles: { include: { role: { include: { permissions: true } } } }; warehouseScopes: true } }>;

const membershipInclude = { roles: { include: { role: { include: { permissions: true } } } }, warehouseScopes: true } as const;

function effective(m: MembershipWithRoles): MembershipInfo {
  const perms = new Set<string>();
  for (const mr of m.roles) for (const p of mr.role.permissions) perms.add(p.permissionCode);
  return {
    membershipId: m.id,
    tenantId: m.tenantId,
    tenantName: null,
    roleKeys: m.roles.map((r) => r.role.key).sort(),
    permissions: [...perms].sort(),
    permissionVersion: m.permissionVersion,
    status: m.status,
    allWarehouses: m.allWarehouses,
    warehouseIds: m.warehouseScopes.map((s) => s.warehouseId),
  };
}

export class IamService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly identity: IdentityProvider,
    private readonly invitationTtlHours: number,
  ) {}

  /* ---- transactions ------------------------------------------------------ */

  tenantTx<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, tenantId);
      return fn(tx);
    }, { maxWait: 15_000, timeout: 30_000 });
  }

  platformTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, null);
      return fn(tx);
    }, { maxWait: 15_000, timeout: 30_000 });
  }

  private async audit(tx: Tx, actor: Actor, tenantId: string | null, entry: { action: string; entityType: string; entityId: string; summary?: string; oldValue?: unknown; newValue?: unknown; reason?: string | null; version?: number | null }) {
    await enqueueEvent(tx, PRODUCER, {
      eventType: EVENT_TYPES.AUDIT_RECORDED,
      tenantId,
      aggregate: { type: entry.entityType.toLowerCase(), id: entry.entityId, version: entry.version ?? null },
      actor: { type: actor.userId ? 'user' : 'system', id: actor.userId, name: actor.name },
      correlationId: actor.correlationId,
      payload: { action: entry.action, entityType: entry.entityType, entityId: entry.entityId, summary: entry.summary ?? null, oldValue: entry.oldValue ?? null, newValue: entry.newValue ?? null, reason: entry.reason ?? null, actorName: actor.name, ip: actor.ip ?? null, userAgent: actor.userAgent ?? null },
    });
  }

  /* ---- catalogue & seeding ----------------------------------------------- */

  /** Upserts the code-defined catalogue; codes missing from code are flagged deprecated, never deleted. */
  async syncCatalog(): Promise<void> {
    await this.platformTx(async (tx) => {
      const codes = new Set(PERMISSION_CATALOG.map((p) => p.code));
      for (const p of PERMISSION_CATALOG) {
        await tx.permission.upsert({ where: { code: p.code }, update: { module: p.module, scope: p.scope, description: p.description, isSensitive: p.sensitive ?? false, deprecatedAt: null }, create: { code: p.code, module: p.module, scope: p.scope, description: p.description, isSensitive: p.sensitive ?? false } });
      }
      await tx.permission.updateMany({ where: { code: { notIn: [...codes] }, deprecatedAt: null }, data: { deprecatedAt: new Date() } });
      for (const role of PLATFORM_ROLES) await this.upsertRole(tx, null, role, resolvePlatformRolePermissions(role));
    });
  }

  private async upsertRole(tx: Tx, tenantId: string | null, def: SystemRoleDef, codes: string[]): Promise<string> {
    const existing = await tx.role.findFirst({ where: { tenantId, key: def.key } });
    const id = existing?.id ?? uuidv7();
    if (!existing) await tx.role.create({ data: { id, tenantId, key: def.key, name: def.name, description: def.description, isSystem: true, rank: def.rank } });
    else await tx.role.update({ where: { id }, data: { name: def.name, description: def.description, rank: def.rank, isSystem: true } });
    const current = new Set((await tx.rolePermission.findMany({ where: { roleId: id } })).map((r) => r.permissionCode));
    const wanted = new Set(codes);
    const add = [...wanted].filter((c) => !current.has(c));
    const remove = [...current].filter((c) => !wanted.has(c));
    if (add.length) await tx.rolePermission.createMany({ data: add.map((c) => ({ roleId: id, permissionCode: c, tenantId })), skipDuplicates: true });
    if (remove.length) await tx.rolePermission.deleteMany({ where: { roleId: id, permissionCode: { in: remove } } });
    return id;
  }

  /** Seeds the 10 system roles for a tenant (idempotent). Called from the tenant.activated consumer. */
  async seedTenantRoles(tx: Tx, tenantId: string): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    for (const role of SYSTEM_ROLES) ids.set(role.key, await this.upsertRole(tx, tenantId, role, resolveRolePermissions(role)));
    return ids;
  }

  /** Owner membership from the auth.owner.invited event (idempotent). */
  async ensureOwnerMembership(tx: Tx, input: { tenantId: string; userId: string; email: string; fullName: string; correlationId: string }): Promise<void> {
    const roles = await this.seedTenantRoles(tx, input.tenantId);
    const ownerRoleId = roles.get('OWNER')!;
    let membership = await tx.membership.findFirst({ where: { tenantId: input.tenantId, userId: input.userId } });
    if (!membership) {
      membership = await tx.membership.create({ data: { id: uuidv7(), tenantId: input.tenantId, userId: input.userId, email: input.email.toLowerCase(), fullName: input.fullName, status: 'ACTIVE', joinedAt: new Date() } });
      await tx.membershipRole.create({ data: { membershipId: membership.id, roleId: ownerRoleId, tenantId: input.tenantId, assignedBy: null } });
      await this.emitMembership(tx, EVENT_TYPES.IAM_MEMBERSHIP_ACTIVATED, membership.id, input.tenantId, { userId: input.userId, name: null, membershipId: null, correlationId: input.correlationId }, null);
    } else if (membership.status !== 'ACTIVE') {
      await tx.membership.update({ where: { id: membership.id }, data: { status: 'ACTIVE', suspendedAt: null, removedAt: null, version: { increment: 1 }, permissionVersion: { increment: 1 } } });
      await tx.membershipRole.upsert({ where: { membershipId_roleId: { membershipId: membership.id, roleId: ownerRoleId } }, update: {}, create: { membershipId: membership.id, roleId: ownerRoleId, tenantId: input.tenantId } });
      await this.emitMembership(tx, EVENT_TYPES.IAM_MEMBERSHIP_REACTIVATED, membership.id, input.tenantId, { userId: input.userId, name: null, membershipId: null, correlationId: input.correlationId }, null);
    }
  }

  /* ---- reads --------------------------------------------------------------- */

  async listPermissions(scope: 'TENANT' | 'PLATFORM') {
    const rows = await this.prisma.permission.findMany({ where: { scope, deprecatedAt: null }, orderBy: [{ module: 'asc' }, { code: 'asc' }] });
    const modules = new Map<string, typeof rows>();
    for (const r of rows) modules.set(r.module, [...(modules.get(r.module) ?? []), r]);
    return [...modules.entries()].map(([module, permissions]) => ({ module, permissions: permissions.map((p) => ({ code: p.code, description: p.description, sensitive: p.isSensitive })) }));
  }

  async listRoles(tenantId: string | null) {
    const roles = await (tenantId ? this.tenantTx(tenantId, (tx) => tx.role.findMany({ where: { tenantId }, include: { permissions: true, _count: { select: { membershipRoles: true } } }, orderBy: [{ rank: 'desc' }, { name: 'asc' }] })) : this.platformTx((tx) => tx.role.findMany({ where: { tenantId: null }, include: { permissions: true, _count: { select: { membershipRoles: true } } }, orderBy: [{ rank: 'desc' }] })));
    return roles.map((r) => ({ id: r.id, key: r.key, name: r.name, description: r.description, isSystem: r.isSystem, rank: r.rank, memberCount: r._count.membershipRoles, permissionCodes: r.permissions.map((p) => p.permissionCode).sort(), version: r.version }));
  }

  async listMembers(tenantId: string, q: { status?: string; roleId?: string }) {
    const rows = await this.tenantTx(tenantId, (tx) => tx.membership.findMany({ where: { tenantId, ...(q.status ? { status: q.status } : {}), ...(q.roleId ? { roles: { some: { roleId: q.roleId } } } : {}) }, include: membershipInclude, orderBy: { createdAt: 'asc' } }));
    return rows.map((m) => ({ id: m.id, userId: m.userId, email: m.email, fullName: m.fullName, status: m.status, roles: m.roles.map((r) => ({ id: r.role.id, key: r.role.key, name: r.role.name, rank: r.role.rank })), allWarehouses: m.allWarehouses, warehouseIds: m.warehouseScopes.map((s) => s.warehouseId), permissionVersion: m.permissionVersion, joinedAt: m.joinedAt, statusReason: m.statusReason, version: m.version }));
  }

  async listInvitations(tenantId: string) {
    const { rows, roles } = await this.tenantTx(tenantId, async (tx) => {
      const rows = await tx.invitation.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
      const roleIds = [...new Set(rows.flatMap((i) => i.roleIds))];
      const roles = roleIds.length ? await tx.role.findMany({ where: { tenantId, id: { in: roleIds } }, select: { id: true, key: true, name: true } }) : [];
      return { rows, roles };
    });
    const byId = new Map(roles.map((r) => [r.id, r]));
    // Role names are embedded so that a viewer with only iam.member.view does not need GET /roles.
    return rows.map((i) => ({ id: i.id, email: i.email, fullName: i.fullName, roleIds: i.roleIds, roles: i.roleIds.map((id) => byId.get(id) ?? { id, key: null, name: null }), warehouseIds: i.warehouseIds, status: i.status, invitedByName: i.invitedByName, expiresAt: i.expiresAt, acceptedAt: i.acceptedAt, createdAt: i.createdAt }));
  }

  async me(ctx: TenantContext) {
    if (!ctx.tenantId || !ctx.membershipId) throw notFound('Membership not found');
    const m = await this.tenantTx(ctx.tenantId, (tx) => tx.membership.findFirst({ where: { id: ctx.membershipId!, tenantId: ctx.tenantId! }, include: membershipInclude }));
    if (!m) throw notFound('Membership not found');
    const info = effective(m);
    return { userId: m.userId, email: m.email, fullName: m.fullName, tenantId: m.tenantId, membershipId: m.id, status: m.status, roles: m.roles.map((r) => ({ id: r.role.id, key: r.role.key, name: r.role.name, rank: r.role.rank })), permissions: info.permissions, permissionVersion: info.permissionVersion, allWarehouses: info.allWarehouses, warehouseIds: info.warehouseIds };
  }

  /* ---- internal (svc-auth) --------------------------------------------------- */

  async membershipsForUser(userId: string, status?: string): Promise<MembershipInfo[]> {
    const rows = await this.platformTx((tx) => tx.membership.findMany({ where: { userId, tenantId: { not: null }, ...(status ? { status } : {}) }, include: membershipInclude, orderBy: { createdAt: 'asc' } }));
    return rows.map(effective);
  }

  async effectivePermissions(membershipId: string): Promise<MembershipInfo | null> {
    const m = await this.platformTx((tx) => tx.membership.findUnique({ where: { id: membershipId }, include: membershipInclude }));
    return m ? effective(m) : null;
  }

  async platformPermissionsForUser(userId: string): Promise<{ permissions: string[]; roleKeys: string[]; status: string | null }> {
    const m = await this.platformTx((tx) => tx.membership.findFirst({ where: { userId, tenantId: null }, include: membershipInclude }));
    if (!m) return { permissions: [], roleKeys: [], status: null };
    const info = effective(m);
    return { permissions: m.status === 'ACTIVE' ? info.permissions.filter(isPlatformPermission) : [], roleKeys: info.roleKeys, status: m.status };
  }

  /* ---- caller context ------------------------------------------------------- */

  private async caller(tx: Tx, tenantId: string, actor: Actor): Promise<{ membership: MembershipWithRoles; maxRank: number; permissions: Set<string> }> {
    const membership = actor.membershipId ? await tx.membership.findFirst({ where: { id: actor.membershipId, tenantId }, include: membershipInclude }) : null;
    if (!membership || membership.status !== 'ACTIVE') throw forbidden('Your membership is not active', 'MEMBER_SUSPENDED');
    const info = effective(membership);
    return { membership, maxRank: Math.max(0, ...membership.roles.map((r) => r.role.rank)), permissions: new Set(info.permissions) };
  }

  private assertGrantable(codes: string[], held: Set<string>) {
    const platform = codes.filter(isPlatformPermission);
    if (platform.length) throw businessRuleError('IAM_PLATFORM_PERMISSION_IN_TENANT', 'Platform permissions cannot be granted in an organisation', platform.map((c) => ({ path: 'permissionCodes', message: c })));
    const unknown = codes.filter((c) => !isTenantPermission(c));
    if (unknown.length) throw businessRuleError('VALIDATION_FAILED', 'Unknown permission codes', unknown.map((c) => ({ path: 'permissionCodes', message: c })));
    const missing = codes.filter((c) => !held.has(c));
    if (missing.length) throw forbidden('You can only grant permissions you hold yourself', 'IAM_ESCALATION_DENIED', missing.map((c) => ({ path: 'permissionCodes', message: c })));
  }

  /* ---- roles -------------------------------------------------------------------- */

  async createRole(tenantId: string, actor: Actor, input: { name: string; description?: string | null; permissionCodes: string[]; rank: number }) {
    return this.tenantTx(tenantId, async (tx) => {
      const me = await this.caller(tx, tenantId, actor);
      this.assertGrantable(input.permissionCodes, me.permissions);
      if (input.rank >= me.maxRank) throw forbidden(`Custom roles must rank below your own (${me.maxRank})`, 'IAM_ESCALATION_DENIED');
      const key = `custom_${input.name.toLowerCase().split('').filter((c) => (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === ' ').join('').trim().split(/\s+/).join('_').slice(0, 40)}`;
      if (await tx.role.findFirst({ where: { tenantId, key } })) throw conflict('A role with this name already exists', 'DUPLICATE');
      const role = await tx.role.create({ data: { id: uuidv7(), tenantId, key, name: input.name, description: input.description ?? null, isSystem: false, rank: input.rank, createdBy: actor.userId } });
      if (input.permissionCodes.length) await tx.rolePermission.createMany({ data: [...new Set(input.permissionCodes)].map((c) => ({ roleId: role.id, permissionCode: c, tenantId })) });
      await this.audit(tx, actor, tenantId, { action: 'ROLE_CREATED', entityType: 'ROLE', entityId: role.id, summary: `Role ${role.name} created`, newValue: { name: role.name, rank: role.rank, permissions: input.permissionCodes }, version: 0 });
      return { id: role.id, key, name: role.name, rank: role.rank, permissionCodes: [...new Set(input.permissionCodes)].sort(), isSystem: false, version: 0 };
    });
  }

  async cloneRole(tenantId: string, actor: Actor, roleId: string, input: { name: string; rank?: number }) {
    const source = await this.tenantTx(tenantId, (tx) => tx.role.findFirst({ where: { id: roleId, tenantId }, include: { permissions: true } }));
    if (!source) throw notFound('Role not found');
    return this.createRole(tenantId, actor, { name: input.name, description: source.description, permissionCodes: source.permissions.map((p) => p.permissionCode), rank: input.rank ?? Math.min(source.rank, 99) });
  }

  async replaceRolePermissions(tenantId: string, actor: Actor, roleId: string, codes: string[], expectedVersion: number | null) {
    return this.tenantTx(tenantId, async (tx) => {
      const me = await this.caller(tx, tenantId, actor);
      const role = await tx.role.findFirst({ where: { id: roleId, tenantId }, include: { permissions: true } });
      if (!role) throw notFound('Role not found');
      if (role.isSystem) throw businessRuleError('IAM_SYSTEM_ROLE_IMMUTABLE', 'System roles cannot be edited; clone the role instead');
      if (role.rank >= me.maxRank) throw forbidden('You can only edit roles ranked below your own', 'IAM_ESCALATION_DENIED');
      if (expectedVersion !== null && expectedVersion !== role.version) throw conflict('The role was modified by someone else', 'VERSION_CONFLICT');
      this.assertGrantable(codes, me.permissions);
      const before = role.permissions.map((p) => p.permissionCode).sort();
      const after = [...new Set(codes)].sort();
      await tx.rolePermission.deleteMany({ where: { roleId } });
      if (after.length) await tx.rolePermission.createMany({ data: after.map((c) => ({ roleId, permissionCode: c, tenantId })) });
      await tx.role.update({ where: { id: roleId }, data: { version: { increment: 1 } } });
      const affected = await this.bumpMembershipsWithRole(tx, tenantId, roleId);
      await this.emitPermissionsChanged(tx, tenantId, actor, affected, role.id, role.key, 'role permissions changed');
      await this.audit(tx, actor, tenantId, { action: 'ROLE_PERMISSIONS_CHANGED', entityType: 'ROLE', entityId: roleId, summary: `Permissions of ${role.name} changed`, oldValue: { permissions: before }, newValue: { permissions: after }, version: role.version + 1 });
      return { id: roleId, permissionCodes: after, version: role.version + 1, affectedMemberships: affected.length };
    });
  }

  async deleteRole(tenantId: string, actor: Actor, roleId: string) {
    return this.tenantTx(tenantId, async (tx) => {
      const me = await this.caller(tx, tenantId, actor);
      const role = await tx.role.findFirst({ where: { id: roleId, tenantId }, include: { _count: { select: { membershipRoles: true } } } });
      if (!role) throw notFound('Role not found');
      if (role.isSystem) throw businessRuleError('IAM_SYSTEM_ROLE_IMMUTABLE', 'System roles cannot be deleted');
      if (role.rank >= me.maxRank) throw forbidden('You can only delete roles ranked below your own', 'IAM_ESCALATION_DENIED');
      if (role._count.membershipRoles > 0) throw businessRuleError('IAM_ROLE_IN_USE', `Role is assigned to ${role._count.membershipRoles} member(s)`);
      await tx.role.delete({ where: { id: roleId } });
      await this.audit(tx, actor, tenantId, { action: 'ROLE_DELETED', entityType: 'ROLE', entityId: roleId, summary: `Role ${role.name} deleted`, oldValue: { name: role.name } });
      return { id: roleId, deleted: true };
    });
  }

  private async bumpMembershipsWithRole(tx: Tx, tenantId: string, roleId: string): Promise<{ membershipId: string; permissionVersion: number }[]> {
    const members = await tx.membership.findMany({ where: { tenantId, roles: { some: { roleId } }, status: { in: ['ACTIVE', 'SUSPENDED'] } }, select: { id: true } });
    const out: { membershipId: string; permissionVersion: number }[] = [];
    for (const m of members) {
      const updated = await tx.membership.update({ where: { id: m.id }, data: { permissionVersion: { increment: 1 } }, select: { id: true, permissionVersion: true } });
      out.push({ membershipId: updated.id, permissionVersion: updated.permissionVersion });
    }
    return out;
  }

  private async emitPermissionsChanged(tx: Tx, tenantId: string | null, actor: Actor, memberships: { membershipId: string; permissionVersion: number }[], roleId: string | null, roleKey: string | null, reason: string) {
    if (!memberships.length) return;
    await enqueueEvent(tx, PRODUCER, { eventType: EVENT_TYPES.IAM_PERMISSIONS_CHANGED, tenantId, aggregate: { type: 'role', id: roleId ?? memberships[0].membershipId, version: null }, actor: { type: actor.userId ? 'user' : 'system', id: actor.userId, name: actor.name }, correlationId: actor.correlationId, payload: { tenantId, memberships, roleId, roleKey, reason } });
  }

  private async emitMembership(tx: Tx, eventType: string, membershipId: string, tenantId: string | null, actor: Actor, reason: string | null) {
    const m = await tx.membership.findUniqueOrThrow({ where: { id: membershipId }, include: membershipInclude });
    const info = effective(m);
    await enqueueEvent(tx, PRODUCER, { eventType, tenantId, aggregate: { type: 'membership', id: membershipId, version: m.version }, actor: { type: actor.userId ? 'user' : 'system', id: actor.userId, name: actor.name }, correlationId: actor.correlationId, payload: { membershipId, tenantId, userId: m.userId, status: m.status, roleKeys: info.roleKeys, permissionVersion: m.permissionVersion, reason } });
  }

  /* ---- invitations ------------------------------------------------------------ */

  async invite(tenantId: string, actor: Actor, input: { email: string; fullName?: string | null; roleIds: string[]; warehouseIds?: string[] }, tenantName: string | null = null) {
    return this.tenantTx(tenantId, async (tx) => {
      const me = await this.caller(tx, tenantId, actor);
      const roles = await tx.role.findMany({ where: { id: { in: input.roleIds }, tenantId }, include: { permissions: true } });
      if (roles.length !== new Set(input.roleIds).size) throw businessRuleError('VALIDATION_FAILED', 'Unknown role', [{ path: 'roleIds', message: 'One or more roles do not exist' }]);
      this.assertAssignable(roles, me);
      const email = input.email.toLowerCase();
      const existing = await tx.membership.findFirst({ where: { tenantId, email, status: { in: ['ACTIVE', 'SUSPENDED'] } } });
      if (existing) throw conflict('This person is already a member', 'MEMBER_EXISTS');
      const pending = await tx.invitation.findFirst({ where: { tenantId, email, status: 'PENDING' } });
      if (pending) throw conflict('An invitation for this email is already pending', 'IAM_INVITE_PENDING_EXISTS');
      const { token, hash } = opaqueToken();
      const expiresAt = new Date(Date.now() + this.invitationTtlHours * 3600_000);
      const invitation = await tx.invitation.create({ data: { id: uuidv7(), tenantId, email, fullName: input.fullName ?? null, roleIds: input.roleIds, warehouseIds: input.warehouseIds ?? [], tokenHash: hash, status: 'PENDING', invitedBy: actor.userId, invitedByName: actor.name, expiresAt } });
      await enqueueEvent(tx, PRODUCER, { eventType: EVENT_TYPES.IAM_INVITATION_CREATED, tenantId, aggregate: { type: 'invitation', id: invitation.id, version: 0 }, actor: { type: 'user', id: actor.userId, name: actor.name }, correlationId: actor.correlationId, payload: { invitationId: invitation.id, tenantId, email, roleKeys: roles.map((r) => r.key), invitedByName: actor.name, acceptToken: token, expiresAt: expiresAt.toISOString(), tenantName } });
      await this.audit(tx, actor, tenantId, { action: 'USER_INVITED', entityType: 'INVITATION', entityId: invitation.id, summary: `${email} invited as ${roles.map((r) => r.key).join(', ')}`, newValue: { email, roles: roles.map((r) => r.key), warehouseIds: input.warehouseIds ?? [] } });
      return { id: invitation.id, email, roleIds: input.roleIds, status: 'PENDING', expiresAt };
    });
  }

  async resendInvitation(tenantId: string, actor: Actor, invitationId: string, tenantName: string | null = null) {
    return this.tenantTx(tenantId, async (tx) => {
      await this.caller(tx, tenantId, actor);
      const inv = await tx.invitation.findFirst({ where: { id: invitationId, tenantId } });
      if (!inv) throw notFound('Invitation not found');
      if (inv.status !== 'PENDING') throw conflict('Only pending invitations can be resent', 'IAM_INVALID_TRANSITION');
      const { token, hash } = opaqueToken();
      const expiresAt = new Date(Date.now() + this.invitationTtlHours * 3600_000);
      await tx.invitation.update({ where: { id: inv.id }, data: { tokenHash: hash, expiresAt } });
      const roles = await tx.role.findMany({ where: { id: { in: inv.roleIds } } });
      await enqueueEvent(tx, PRODUCER, { eventType: EVENT_TYPES.IAM_INVITATION_CREATED, tenantId, aggregate: { type: 'invitation', id: inv.id, version: 1 }, actor: { type: 'user', id: actor.userId, name: actor.name }, correlationId: actor.correlationId, payload: { invitationId: inv.id, tenantId, email: inv.email, roleKeys: roles.map((r) => r.key), invitedByName: actor.name, acceptToken: token, expiresAt: expiresAt.toISOString(), tenantName } });
      await this.audit(tx, actor, tenantId, { action: 'INVITATION_RESENT', entityType: 'INVITATION', entityId: inv.id });
      return { id: inv.id, expiresAt };
    });
  }

  async revokeInvitation(tenantId: string, actor: Actor, invitationId: string) {
    return this.tenantTx(tenantId, async (tx) => {
      await this.caller(tx, tenantId, actor);
      const inv = await tx.invitation.findFirst({ where: { id: invitationId, tenantId } });
      if (!inv) throw notFound('Invitation not found');
      if (inv.status !== 'PENDING') throw conflict('Only pending invitations can be revoked', 'IAM_INVALID_TRANSITION');
      await tx.invitation.update({ where: { id: inv.id }, data: { status: 'REVOKED' } });
      await this.audit(tx, actor, tenantId, { action: 'INVITATION_REVOKED', entityType: 'INVITATION', entityId: inv.id });
      return { id: inv.id, status: 'REVOKED' };
    });
  }

  /** Public: the invitee accepts. Identity is created/activated in svc-auth, then the membership goes ACTIVE. */
  async acceptInvitation(rawToken: string, input: { fullName?: string; password?: string }, correlationId: string) {
    const hash = sha256(rawToken);
    const inv = await this.platformTx((tx) => tx.invitation.findUnique({ where: { tokenHash: hash } }));
    if (!inv || inv.status === 'REVOKED' || inv.status === 'ACCEPTED') throw new HttpError(401, 'IAM_INVITE_INVALID', 'This invitation is invalid or was already used');
    if (inv.status === 'EXPIRED' || inv.expiresAt.getTime() <= Date.now()) {
      await this.platformTx((tx) => tx.invitation.updateMany({ where: { id: inv.id, status: 'PENDING' }, data: { status: 'EXPIRED' } }));
      throw new HttpError(410, 'IAM_INVITE_EXPIRED', 'This invitation has expired');
    }
    const fullName = input.fullName ?? inv.fullName ?? inv.email.split('@')[0];
    const identity = await this.identity.ensureUser({ email: inv.email, fullName, password: input.password }, correlationId);
    const actor: Actor = { userId: identity.userId, name: fullName, membershipId: null, correlationId };
    return this.platformTx(async (tx) => {
      const locked = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "invitations" WHERE "id" = ${inv.id}::uuid FOR UPDATE`;
      if (locked[0]?.status !== 'PENDING') throw new HttpError(401, 'IAM_INVITE_INVALID', 'This invitation is invalid or was already used');
      await tx.invitation.update({ where: { id: inv.id }, data: { status: 'ACCEPTED', acceptedAt: new Date() } });
      let membership = await tx.membership.findFirst({ where: { tenantId: inv.tenantId, userId: identity.userId } });
      if (!membership) membership = await tx.membership.create({ data: { id: uuidv7(), tenantId: inv.tenantId, userId: identity.userId, email: inv.email, fullName, status: 'ACTIVE', joinedAt: new Date(), allWarehouses: inv.warehouseIds.length === 0 } });
      else await tx.membership.update({ where: { id: membership.id }, data: { status: 'ACTIVE', suspendedAt: null, removedAt: null, joinedAt: membership.joinedAt ?? new Date(), allWarehouses: inv.warehouseIds.length === 0, version: { increment: 1 }, permissionVersion: { increment: 1 } } });
      await tx.membershipRole.deleteMany({ where: { membershipId: membership.id } });
      await tx.membershipRole.createMany({ data: inv.roleIds.map((roleId) => ({ membershipId: membership!.id, roleId, tenantId: inv.tenantId, assignedBy: inv.invitedBy })) });
      await tx.membershipWarehouseScope.deleteMany({ where: { membershipId: membership.id } });
      if (inv.warehouseIds.length && inv.tenantId) await tx.membershipWarehouseScope.createMany({ data: inv.warehouseIds.map((warehouseId) => ({ membershipId: membership!.id, warehouseId, tenantId: inv.tenantId! })) });
      await this.emitMembership(tx, EVENT_TYPES.IAM_MEMBERSHIP_ACTIVATED, membership.id, inv.tenantId, actor, null);
      await this.audit(tx, actor, inv.tenantId, { action: 'MEMBERSHIP_ACTIVATED', entityType: 'MEMBERSHIP', entityId: membership.id, summary: `${inv.email} joined`, newValue: { roleIds: inv.roleIds } });
      return { membershipId: membership.id, tenantId: inv.tenantId, userId: identity.userId, identityStatus: identity.status };
    });
  }

  /* ---- members ------------------------------------------------------------------ */

  /** Rule 2: strictly lower rank, except that iam.owner.transfer holders may act on peers of equal rank. */
  private outranks(me: { maxRank: number; permissions: Set<string> }, rank: number): boolean {
    return rank < me.maxRank || (rank === me.maxRank && me.permissions.has('iam.owner.transfer'));
  }

  private assertAssignable(roles: { rank: number; key: string; permissions: { permissionCode: string }[] }[], me: { maxRank: number; permissions: Set<string> }) {
    for (const r of roles) {
      if (!this.outranks(me, r.rank)) throw forbidden(`You cannot assign the ${r.key} role (rank ${r.rank} is not below yours)`, 'IAM_ESCALATION_DENIED');
      const missing = r.permissions.map((p) => p.permissionCode).filter((c) => !me.permissions.has(c));
      if (missing.length) throw forbidden(`Assigning ${r.key} would grant permissions you do not hold`, 'IAM_ESCALATION_DENIED', missing.map((c) => ({ path: 'roleIds', message: c })));
    }
  }

  private async target(tx: Tx, tenantId: string, membershipId: string): Promise<MembershipWithRoles> {
    const m = await tx.membership.findFirst({ where: { id: membershipId, tenantId }, include: membershipInclude });
    if (!m) throw notFound('Member not found');
    return m;
  }

  /** Rule 3 (defence in depth; the rank rules normally stop the API path first). */
  async checkLastOwnerRule(tenantId: string, membershipId: string, nextRoleIds?: string[]): Promise<void> {
    await this.tenantTx(tenantId, async (tx) => {
      const target = await this.target(tx, tenantId, membershipId);
      await this.assertNotLastOwner(tx, tenantId, target, nextRoleIds);
    });
  }

  private async assertNotLastOwner(tx: Tx, tenantId: string, membership: MembershipWithRoles, nextRoleIds?: string[]) {
    const isOwner = membership.roles.some((r) => r.role.key === 'OWNER');
    if (!isOwner) return;
    if (nextRoleIds) {
      const ownerRole = await tx.role.findFirst({ where: { tenantId, key: 'OWNER' }, select: { id: true } });
      if (ownerRole && nextRoleIds.includes(ownerRole.id)) return; // still an owner
    }
    const otherOwners = await tx.membership.count({ where: { tenantId, status: 'ACTIVE', id: { not: membership.id }, roles: { some: { role: { key: 'OWNER' } } } } });
    if (otherOwners === 0) throw businessRuleError('IAM_LAST_OWNER', 'The last active owner cannot be suspended, removed or demoted');
  }

  async replaceMemberRoles(tenantId: string, actor: Actor, membershipId: string, roleIds: string[]) {
    return this.tenantTx(tenantId, async (tx) => {
      const me = await this.caller(tx, tenantId, actor);
      if (me.membership.id === membershipId) throw forbidden('You cannot change your own roles', 'IAM_SELF_ROLE_CHANGE');
      const target = await this.target(tx, tenantId, membershipId);
      const targetMax = Math.max(0, ...target.roles.map((r) => r.role.rank));
      if (!this.outranks(me, targetMax)) throw forbidden('You cannot change roles of a member ranked at or above you', 'IAM_ESCALATION_DENIED');
      const roles = await tx.role.findMany({ where: { id: { in: roleIds }, tenantId }, include: { permissions: true } });
      if (roles.length !== new Set(roleIds).size) throw businessRuleError('VALIDATION_FAILED', 'Unknown role', [{ path: 'roleIds', message: 'One or more roles do not exist' }]);
      this.assertAssignable(roles, me);
      await this.assertNotLastOwner(tx, tenantId, target, roleIds);
      const before = target.roles.map((r) => r.role.key).sort();
      await tx.membershipRole.deleteMany({ where: { membershipId } });
      await tx.membershipRole.createMany({ data: roleIds.map((roleId) => ({ membershipId, roleId, tenantId, assignedBy: actor.userId })) });
      const updated = await tx.membership.update({ where: { id: membershipId }, data: { permissionVersion: { increment: 1 }, version: { increment: 1 } }, select: { permissionVersion: true } });
      await this.emitPermissionsChanged(tx, tenantId, actor, [{ membershipId, permissionVersion: updated.permissionVersion }], null, null, 'member roles changed');
      const after = roles.map((r) => r.key).sort();
      await this.audit(tx, actor, tenantId, { action: 'USER_ROLE_CHANGED', entityType: 'MEMBERSHIP', entityId: membershipId, summary: `${target.email}: ${before.join(',')} -> ${after.join(',')}`, oldValue: { roles: before }, newValue: { roles: after } });
      return { id: membershipId, roleKeys: after, permissionVersion: updated.permissionVersion };
    });
  }

  async transitionMember(tenantId: string, actor: Actor, membershipId: string, command: 'suspend' | 'reactivate' | 'remove', reason: string) {
    const table: Record<typeof command, { from: string[]; to: string; event: string; action: string }> = {
      suspend: { from: ['ACTIVE'], to: 'SUSPENDED', event: EVENT_TYPES.IAM_MEMBERSHIP_SUSPENDED, action: 'MEMBER_SUSPENDED' },
      reactivate: { from: ['SUSPENDED'], to: 'ACTIVE', event: EVENT_TYPES.IAM_MEMBERSHIP_REACTIVATED, action: 'MEMBER_REACTIVATED' },
      remove: { from: ['ACTIVE', 'SUSPENDED', 'INVITED'], to: 'REMOVED', event: EVENT_TYPES.IAM_MEMBERSHIP_REMOVED, action: 'MEMBER_REMOVED' },
    };
    const spec = table[command];
    return this.tenantTx(tenantId, async (tx) => {
      const me = await this.caller(tx, tenantId, actor);
      if (me.membership.id === membershipId) throw forbidden('You cannot change your own membership', 'IAM_SELF_ROLE_CHANGE');
      const target = await this.target(tx, tenantId, membershipId);
      if (!spec.from.includes(target.status)) throw conflict(`Member is ${target.status}; cannot ${command}`, 'IAM_INVALID_TRANSITION');
      const targetMax = Math.max(0, ...target.roles.map((r) => r.role.rank));
      if (!this.outranks(me, targetMax)) throw forbidden('You cannot change a member ranked at or above you', 'IAM_ESCALATION_DENIED');
      if (command !== 'reactivate') await this.assertNotLastOwner(tx, tenantId, target);
      const now = new Date();
      const result = await tx.membership.updateMany({ where: { id: membershipId, status: target.status, version: target.version }, data: { status: spec.to, statusReason: reason, version: target.version + 1, permissionVersion: { increment: 1 }, ...(command === 'suspend' ? { suspendedAt: now } : {}), ...(command === 'remove' ? { removedAt: now } : {}), ...(command === 'reactivate' ? { suspendedAt: null } : {}) } });
      if (result.count !== 1) throw conflict('The member was modified by someone else', 'VERSION_CONFLICT');
      await this.emitMembership(tx, spec.event, membershipId, tenantId, actor, reason);
      await this.audit(tx, actor, tenantId, { action: spec.action, entityType: 'MEMBERSHIP', entityId: membershipId, summary: `${target.email}: ${target.status} -> ${spec.to}`, oldValue: { status: target.status }, newValue: { status: spec.to }, reason, version: target.version + 1 });
      return { id: membershipId, status: spec.to, version: target.version + 1 };
    });
  }

  async setWarehouseScope(tenantId: string, actor: Actor, membershipId: string, input: { allWarehouses: boolean; warehouseIds: string[] }) {
    return this.tenantTx(tenantId, async (tx) => {
      const me = await this.caller(tx, tenantId, actor);
      const target = await this.target(tx, tenantId, membershipId);
      const targetMax = Math.max(0, ...target.roles.map((r) => r.role.rank));
      if (me.membership.id !== membershipId && !this.outranks(me, targetMax)) throw forbidden('You cannot change a member ranked at or above you', 'IAM_ESCALATION_DENIED');
      if (!input.allWarehouses && input.warehouseIds.length === 0) throw businessRuleError('VALIDATION_FAILED', 'Select at least one warehouse or allow all', [{ path: 'warehouseIds', message: 'Required when allWarehouses is false' }]);
      await tx.membershipWarehouseScope.deleteMany({ where: { membershipId } });
      if (!input.allWarehouses) await tx.membershipWarehouseScope.createMany({ data: input.warehouseIds.map((warehouseId) => ({ membershipId, warehouseId, tenantId })) });
      const updated = await tx.membership.update({ where: { id: membershipId }, data: { allWarehouses: input.allWarehouses, permissionVersion: { increment: 1 }, version: { increment: 1 } }, select: { permissionVersion: true } });
      await this.emitPermissionsChanged(tx, tenantId, actor, [{ membershipId, permissionVersion: updated.permissionVersion }], null, null, 'warehouse scope changed');
      await this.audit(tx, actor, tenantId, { action: 'MEMBER_SCOPE_CHANGED', entityType: 'MEMBERSHIP', entityId: membershipId, oldValue: { allWarehouses: target.allWarehouses, warehouseIds: target.warehouseScopes.map((s) => s.warehouseId) }, newValue: input });
      return { id: membershipId, allWarehouses: input.allWarehouses, warehouseIds: input.allWarehouses ? [] : input.warehouseIds, permissionVersion: updated.permissionVersion };
    });
  }

  /* ---- platform staff (moved here from svc-auth in Phase 2) ------------------------ */

  async listPlatformStaff() {
    const rows = await this.platformTx((tx) => tx.membership.findMany({ where: { tenantId: null }, include: membershipInclude, orderBy: { createdAt: 'asc' } }));
    return rows.map((m) => ({ id: m.id, userId: m.userId, email: m.email, fullName: m.fullName, status: m.status, roleKeys: m.roles.map((r) => r.role.key), permissionVersion: m.permissionVersion }));
  }

  /** Ensures a platform membership with the given roles (used by the CLI seed and the bootstrap migration). */
  async upsertPlatformStaff(input: { userId: string; email: string; fullName: string; roleKeys: string[] }, actor: Actor) {
    return this.platformTx(async (tx) => {
      const roles = await tx.role.findMany({ where: { tenantId: null, key: { in: input.roleKeys } } });
      if (roles.length !== new Set(input.roleKeys).size) throw businessRuleError('VALIDATION_FAILED', 'Unknown platform role', [{ path: 'roleKeys', message: 'Unknown role key' }]);
      let m = await tx.membership.findFirst({ where: { tenantId: null, userId: input.userId } });
      if (!m) m = await tx.membership.create({ data: { id: uuidv7(), tenantId: null, userId: input.userId, email: input.email.toLowerCase(), fullName: input.fullName, status: 'ACTIVE', joinedAt: new Date() } });
      await tx.membershipRole.deleteMany({ where: { membershipId: m.id } });
      await tx.membershipRole.createMany({ data: roles.map((r) => ({ membershipId: m!.id, roleId: r.id, tenantId: null, assignedBy: actor.userId })) });
      const updated = await tx.membership.update({ where: { id: m.id }, data: { permissionVersion: { increment: 1 }, version: { increment: 1 } }, select: { permissionVersion: true } });
      await this.emitPermissionsChanged(tx, null, actor, [{ membershipId: m.id, permissionVersion: updated.permissionVersion }], null, null, 'platform roles changed');
      await this.audit(tx, actor, null, { action: 'PLATFORM_ROLE_CHANGED', entityType: 'MEMBERSHIP', entityId: m.id, newValue: { roleKeys: input.roleKeys } });
      return { id: m.id, roleKeys: input.roleKeys, permissionVersion: updated.permissionVersion };
    });
  }
}
