/**
 * Login, MFA, tenant selection, refresh, logout, password reset, owner invite acceptance
 * (phase-01 section 1.6). Every security-relevant outcome writes an audit / auth event through the
 * outbox in the same transaction.
 */
import { authenticator } from 'otplib';
import { EVENT_TYPES } from '@b2b/contracts';
import {
  HttpError,
  businessRuleError,
  createTokenVerifier,
  enqueueEvent,
  forbidden,
  notFound,
  opaqueToken,
  sha256,
  unauthorized,
  uuidv7,
  type SecretBox,
  type TokenClaims,
  type TokenVerifier,
} from '@b2b/platform-kit';
import type { AuthConfig } from '../config.js';
import type { PrismaClient, Tx } from '../db.js';
import type { MembershipDirectory, MembershipInfo, TenantStatusSource } from './directory.js';
import type { PlatformDirectory } from './platform-directory.js';
import type { SigningKeys } from './keys.js';
import { burnTime, hashPassword, passwordProblem, verifyPassword, type PasswordAlgo } from './passwords.js';
import { TokenService, type IssuedTokens, type SessionMeta } from './tokens.js';

export const PRODUCER = 'svc-auth';
const MFA_ISSUER = 'B2B Inventory';
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

export type LoginResult =
  | { kind: 'tokens'; tokens: IssuedTokens; tokenType: 'tenant' | 'platform'; tenant?: { id: string; name: string | null } }
  | { kind: 'mfa'; mfaToken: string; enrolmentRequired: boolean; otpauthUrl?: string }
  | { kind: 'select'; selectionToken: string; tenants: { id: string; name: string | null; roleKeys: string[] }[] };

export interface AuthServiceDeps {
  prisma: PrismaClient;
  config: AuthConfig;
  keys: SigningKeys;
  box: SecretBox;
  directory: MembershipDirectory;
  tenantStatus: TenantStatusSource;
  platformDirectory: PlatformDirectory;
}

function actorOf(user: { id: string; fullName: string } | null) {
  return { type: 'user' as const, id: user?.id ?? null, name: user?.fullName ?? null };
}

export class AuthService {
  readonly tokens: TokenService;
  readonly verifier: TokenVerifier;
  private readonly prisma: PrismaClient;
  private readonly config: AuthConfig;

  constructor(private readonly deps: AuthServiceDeps) {
    this.prisma = deps.prisma;
    this.config = deps.config;
    this.tokens = new TokenService(deps.prisma, deps.keys, deps.config);
    this.verifier = createTokenVerifier({ keys: deps.keys, issuer: deps.config.AUTH_ISSUER, audience: deps.config.AUTH_AUDIENCE });
  }

  /* ---- helpers ---------------------------------------------------------- */

  private async audit(tx: Tx, input: { action: string; entityType: string; entityId: string; tenantId: string | null; actor: { type: 'user' | 'system'; id: string | null; name?: string | null }; correlationId: string; summary?: string; newValue?: unknown; oldValue?: unknown; meta?: SessionMeta }) {
    await enqueueEvent(tx, PRODUCER, {
      eventType: EVENT_TYPES.AUDIT_RECORDED,
      tenantId: input.tenantId,
      aggregate: { type: input.entityType.toLowerCase(), id: input.entityId, version: null },
      actor: input.actor,
      correlationId: input.correlationId,
      payload: { action: input.action, entityType: input.entityType, entityId: input.entityId, summary: input.summary ?? null, newValue: input.newValue ?? null, oldValue: input.oldValue ?? null, actorName: input.actor.name ?? null, ip: input.meta?.ip ?? null, userAgent: input.meta?.userAgent ?? null },
    });
  }

  private async platformPermissions(userId: string): Promise<string[]> {
    return this.deps.platformDirectory.permissionsFor(userId);
  }

  /** Organisations the user can switch to (web-app tenant switcher). */
  async tenantsFor(userId: string): Promise<{ id: string; name: string | null; roleKeys: string[] }[]> {
    const memberships = await this.activeMemberships(userId);
    return memberships.map((m) => ({ id: m.tenantId, name: m.tenantName, roleKeys: m.roleKeys }));
  }

  private async activeMemberships(userId: string): Promise<MembershipInfo[]> {
    const memberships = await this.deps.directory.listActive(userId);
    const out: MembershipInfo[] = [];
    for (const m of memberships) {
      const status = await this.deps.tenantStatus.get(m.tenantId);
      if (status?.status === 'ACTIVE') out.push(m);
    }
    return out;
  }

  private async assertTenantActive(tenantId: string): Promise<void> {
    const status = await this.deps.tenantStatus.get(tenantId);
    if (!status || status.status !== 'ACTIVE') {
      throw forbidden(status?.status === 'SUSPENDED' ? 'This organisation is suspended. Contact support.' : 'This organisation is not active.', 'TENANT_NOT_ACTIVE');
    }
  }

  /* ---- login ------------------------------------------------------------ */

  async login(input: { email: string; password: string; portal: 'app' | 'admin' }, meta: SessionMeta, correlationId: string): Promise<LoginResult> {
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    const fail = async (reason: string, code = 'AUTH_INVALID_CREDENTIALS', status = 401, message = 'Incorrect email or password') => {
      await this.prisma.$transaction(async (tx) => {
        if (user && reason === 'BAD_PASSWORD') {
          const count = user.failedLoginCount + 1;
          const lock = count >= this.config.LOCKOUT_THRESHOLD;
          await tx.user.update({
            where: { id: user.id },
            data: { failedLoginCount: lock ? 0 : count, lockedUntil: lock ? new Date(Date.now() + this.config.LOCKOUT_MINUTES * 60_000) : undefined, status: lock ? 'LOCKED' : undefined, version: { increment: 1 } },
          });
          if (lock) await this.audit(tx, { action: 'USER_LOCKED', entityType: 'USER', entityId: user.id, tenantId: null, actor: { type: 'system', id: null }, correlationId, summary: `Account locked after ${count} failed logins`, meta });
        }
        await enqueueEvent(tx, PRODUCER, { eventType: EVENT_TYPES.AUTH_LOGIN_FAILED, tenantId: null, aggregate: { type: 'user', id: user?.id ?? '00000000-0000-0000-0000-000000000000', version: null }, actor: actorOf(user), correlationId, payload: { userId: user?.id ?? null, email, tenantId: null, ip: meta.ip, userAgent: meta.userAgent, reason } });
      });
      throw new HttpError(status, code, message);
    };

    if (!user || !user.passwordHash) {
      await burnTime(input.password);
      await fail(user ? 'NO_PASSWORD' : 'UNKNOWN_USER');
      throw unauthorized();
    }
    if (user.status === 'DISABLED') await fail('DISABLED', 'AUTH_ACCOUNT_DISABLED', 403, 'This account is disabled');
    if (user.status === 'INVITED') await fail('INVITED', 'AUTH_INVALID_CREDENTIALS', 401, 'Incorrect email or password');
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await fail('LOCKED', 'AUTH_ACCOUNT_LOCKED', 403, `Too many failed attempts. Try again after ${this.config.LOCKOUT_MINUTES} minutes.`);
    }
    if (user.status === 'LOCKED' && user.lockedUntil && user.lockedUntil.getTime() <= Date.now()) {
      await this.prisma.user.update({ where: { id: user.id }, data: { status: 'ACTIVE', lockedUntil: null } });
    }
    const ok = await verifyPassword(input.password, user.passwordHash, user.passwordAlgo as PasswordAlgo);
    if (!ok) await fail('BAD_PASSWORD');

    // Success: reset counters, rehash legacy bcrypt hashes.
    const rehash = user.passwordAlgo !== 'argon2id' ? await hashPassword(input.password) : null;
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, status: 'ACTIVE', lastLoginAt: new Date(), ...(rehash ? { passwordHash: rehash, passwordAlgo: 'argon2id' } : {}) } });

    if (user.userType === 'PLATFORM') {
      if (input.portal !== 'admin') throw forbidden('Platform accounts sign in on the admin portal', 'PLATFORM_ONLY');
      if (this.config.PLATFORM_MFA_REQUIRED === 'on') {
        const mfaToken = this.tokens.signFlowToken('mfa', user.id, { portal: 'admin' });
        if (user.mfaEnabled) return { kind: 'mfa', mfaToken, enrolmentRequired: false };
        const { secret, otpauthUrl } = await this.beginMfaEnrolment(user.id, user.email);
        return { kind: 'mfa', mfaToken: this.tokens.signFlowToken('mfa', user.id, { portal: 'admin', enrol: secret }), enrolmentRequired: true, otpauthUrl };
      }
      return this.finishPlatformLogin(user, meta, correlationId);
    }

    if (input.portal === 'admin') throw forbidden('Use the application portal to sign in', 'TENANT_ONLY');
    const memberships = await this.activeMemberships(user.id);
    if (memberships.length === 0) {
      const any = await this.deps.directory.listActive(user.id);
      throw forbidden(any.length ? 'Your organisation is not active. Contact support.' : 'You are not a member of any organisation', any.length ? 'TENANT_NOT_ACTIVE' : 'AUTH_NO_MEMBERSHIP');
    }
    if (memberships.length > 1) {
      return { kind: 'select', selectionToken: this.tokens.signFlowToken('select', user.id), tenants: memberships.map((m) => ({ id: m.tenantId, name: m.tenantName, roleKeys: m.roleKeys })) };
    }
    return this.finishTenantLogin(user, memberships[0], meta, correlationId);
  }

  private async finishTenantLogin(user: { id: string; email: string; fullName: string }, membership: MembershipInfo, meta: SessionMeta, correlationId: string): Promise<LoginResult> {
    const tokens = await this.prisma.$transaction(async (tx) => {
      const issued = await this.tokens.issueTenantSession(tx, user, membership, meta);
      await enqueueEvent(tx, PRODUCER, { eventType: EVENT_TYPES.AUTH_LOGGED_IN, tenantId: membership.tenantId, aggregate: { type: 'session', id: issued.sessionId, version: null }, actor: actorOf(user), correlationId, payload: { userId: user.id, email: user.email, tenantId: membership.tenantId, ip: meta.ip, userAgent: meta.userAgent } });
      await this.audit(tx, { action: 'USER_LOGGED_IN', entityType: 'SESSION', entityId: issued.sessionId, tenantId: membership.tenantId, actor: actorOf(user), correlationId, meta });
      return issued;
    });
    return { kind: 'tokens', tokens, tokenType: 'tenant', tenant: { id: membership.tenantId, name: membership.tenantName } };
  }

  private async finishPlatformLogin(user: { id: string; email: string; fullName: string }, meta: SessionMeta, correlationId: string): Promise<LoginResult> {
    const perms = await this.platformPermissions(user.id);
    const tokens = await this.prisma.$transaction(async (tx) => {
      const issued = await this.tokens.issuePlatformSession(tx, user, perms, meta);
      await enqueueEvent(tx, PRODUCER, { eventType: EVENT_TYPES.AUTH_LOGGED_IN, tenantId: null, aggregate: { type: 'session', id: issued.sessionId, version: null }, actor: actorOf(user), correlationId, payload: { userId: user.id, email: user.email, tenantId: null, ip: meta.ip, userAgent: meta.userAgent } });
      await this.audit(tx, { action: 'PLATFORM_ADMIN_LOGGED_IN', entityType: 'SESSION', entityId: issued.sessionId, tenantId: null, actor: actorOf(user), correlationId, meta });
      return issued;
    });
    return { kind: 'tokens', tokens, tokenType: 'platform' };
  }

  /* ---- MFA --------------------------------------------------------------- */

  private async beginMfaEnrolment(userId: string, email: string): Promise<{ secret: string; otpauthUrl: string }> {
    const secret = authenticator.generateSecret();
    return { secret: this.deps.box.encrypt(secret), otpauthUrl: authenticator.keyuri(email, MFA_ISSUER, secret) };
  }

  async verifyMfa(mfaToken: string, code: string, meta: SessionMeta, correlationId: string): Promise<LoginResult> {
    const claims = (await this.verifier.verify(mfaToken, { types: ['mfa'] })) as TokenClaims & { enrol?: string };
    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user || user.userType !== 'PLATFORM' || user.status !== 'ACTIVE') throw unauthorized('Invalid MFA session', 'AUTH_TOKEN_INVALID');
    let secretEnc = user.mfaSecretEnc;
    const enrolling = Boolean(claims.enrol);
    if (enrolling) secretEnc = claims.enrol!;
    const bypass = this.config.MFA_DEV_BYPASS_CODE;
    if (bypass && !this.config.isProd && code === bypass) {
      // Development bypass: sign in without touching the account's enrolment, and leave a trace.
      await this.prisma.$transaction((tx) => this.audit(tx, { action: 'MFA_DEV_BYPASS_USED', entityType: 'USER', entityId: user.id, tenantId: null, actor: actorOf(user), correlationId, meta }));
      return this.finishPlatformLogin(user, meta, correlationId);
    }
    if (!secretEnc) throw unauthorized('MFA is not set up for this account', 'AUTH_MFA_ENROLMENT_REQUIRED');
    const secret = this.deps.box.decrypt(secretEnc);
    if (!authenticator.verify({ token: code, secret })) throw unauthorized('Incorrect verification code', 'AUTH_MFA_INVALID');
    if (enrolling) {
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { mfaSecretEnc: secretEnc, mfaEnabled: true, version: { increment: 1 } } });
        await this.audit(tx, { action: 'MFA_ENROLLED', entityType: 'USER', entityId: user.id, tenantId: null, actor: actorOf(user), correlationId, meta });
      });
    }
    return this.finishPlatformLogin(user, meta, correlationId);
  }

  /* ---- tenant selection --------------------------------------------------- */

  async selectTenant(selectionToken: string, tenantId: string, meta: SessionMeta, correlationId: string): Promise<LoginResult> {
    const claims = await this.verifier.verify(selectionToken, { types: ['select', 'tenant'] });
    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user || user.status !== 'ACTIVE') throw unauthorized('Invalid selection session', 'AUTH_TOKEN_INVALID');
    const memberships = await this.deps.directory.listActive(user.id);
    const membership = memberships.find((m) => m.tenantId === tenantId);
    if (!membership) throw notFound('Organisation not found');
    await this.assertTenantActive(tenantId);
    return this.finishTenantLogin(user, membership, meta, correlationId);
  }

  /* ---- refresh / logout --------------------------------------------------- */

  async refresh(rawToken: string): Promise<{ tokens: IssuedTokens; tokenType: 'tenant' | 'platform' }> {
    let tokenType: 'tenant' | 'platform' = 'tenant';
    const tokens = await this.tokens.rotate(rawToken, async (session) => {
      const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
      if (!user || user.status !== 'ACTIVE') throw unauthorized('Account is not active', 'AUTH_REFRESH_INVALID');
      if (session.tokenType === 'platform') {
        tokenType = 'platform';
        return { sub: user.id, typ: 'platform', perms: await this.platformPermissions(user.id), sid: session.id, email: user.email, name: user.fullName };
      }
      if (!session.tenantId || !session.membershipId) throw unauthorized('Session is not valid', 'AUTH_REFRESH_INVALID');
      await this.assertTenantActive(session.tenantId);
      const membership = await this.deps.directory.get(session.membershipId);
      if (!membership || membership.status !== 'ACTIVE') throw forbidden('Your membership is not active', 'MEMBER_SUSPENDED');
      return { sub: user.id, typ: 'tenant', tid: membership.tenantId, mid: membership.membershipId, perms: membership.permissions, pv: membership.permissionVersion, wh: membership.allWarehouses === false ? membership.warehouseIds ?? [] : null, sid: session.id, email: user.email, name: user.fullName };
    });
    return { tokens, tokenType };
  }

  async logout(sessionId: string): Promise<void> {
    await this.tokens.revokeSession(sessionId, 'LOGOUT');
  }

  /* ---- password reset ----------------------------------------------------- */

  /** Always resolves (202) so an attacker cannot learn whether the email exists. */
  async forgotPassword(email: string, correlationId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user || user.status === 'DISABLED') return;
    const { token, hash } = opaqueToken();
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.create({ data: { id: uuidv7(), userId: user.id, tokenHash: hash, expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) } });
      await enqueueEvent(tx, PRODUCER, { eventType: EVENT_TYPES.AUTH_PASSWORD_RESET_REQUESTED, tenantId: null, aggregate: { type: 'user', id: user.id, version: null }, actor: actorOf(user), correlationId, payload: { userId: user.id, email: user.email, fullName: user.fullName, resetToken: token, expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString() } });
      await this.audit(tx, { action: 'PASSWORD_RESET_REQUESTED', entityType: 'USER', entityId: user.id, tenantId: null, actor: actorOf(user), correlationId });
    });
  }

  async resetPassword(rawToken: string, newPassword: string, correlationId: string): Promise<void> {
    const problem = passwordProblem(newPassword);
    if (problem) throw businessRuleError('AUTH_PASSWORD_WEAK', problem, [{ path: 'password', message: problem }]);
    const hash = sha256(rawToken);
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; user_id: string; expires_at: Date; used_at: Date | null }[]>`SELECT "id", "user_id", "expires_at", "used_at" FROM "password_reset_tokens" WHERE "token_hash" = ${hash} FOR UPDATE`;
      const t = rows[0];
      if (!t || t.used_at || new Date(t.expires_at).getTime() <= Date.now()) throw unauthorized('This reset link is invalid or has expired', 'AUTH_TOKEN_INVALID');
      await tx.passwordResetToken.update({ where: { id: t.id }, data: { usedAt: new Date() } });
      await tx.user.update({ where: { id: t.user_id }, data: { passwordHash: await hashPassword(newPassword), passwordAlgo: 'argon2id', failedLoginCount: 0, lockedUntil: null, status: 'ACTIVE', version: { increment: 1 } } });
      await this.tokens.revokeSessions(tx, { userId: t.user_id }, 'PASSWORD_RESET');
      await this.audit(tx, { action: 'PASSWORD_RESET', entityType: 'USER', entityId: t.user_id, tenantId: null, actor: { type: 'user', id: t.user_id }, correlationId });
    });
  }

  /* ---- owner invites ------------------------------------------------------ */

  /** Creates (or reuses) the owner identity for an activated tenant and a single-use invite token. */
  async createOwnerInvite(tx: Tx, input: { tenantId: string; email: string; fullName: string; correlationId: string; actorId: string | null }): Promise<{ userId: string; inviteToken: string; expiresAt: Date; alreadyActive: boolean }> {
    const email = input.email.trim().toLowerCase();
    let user = await tx.user.findUnique({ where: { email } });
    if (!user) user = await tx.user.create({ data: { id: uuidv7(), email, fullName: input.fullName, userType: 'TENANT', status: 'INVITED', passwordHash: null } });
    await tx.tenantMembershipBootstrap.upsert({ where: { tenantId_userId: { tenantId: input.tenantId, userId: user.id } }, update: { status: 'ACTIVE', role: 'OWNER' }, create: { id: uuidv7(), tenantId: input.tenantId, userId: user.id, role: 'OWNER', status: 'ACTIVE' } });
    // Invalidate earlier invites for this tenant, then issue a fresh one.
    await tx.inviteToken.updateMany({ where: { userId: user.id, tenantId: input.tenantId, usedAt: null }, data: { usedAt: new Date() } });
    const { token, hash } = opaqueToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    await tx.inviteToken.create({ data: { id: uuidv7(), userId: user.id, tenantId: input.tenantId, kind: 'OWNER', tokenHash: hash, expiresAt } });
    await enqueueEvent(tx, PRODUCER, { eventType: EVENT_TYPES.AUTH_OWNER_INVITED, tenantId: input.tenantId, aggregate: { type: 'user', id: user.id, version: null }, actor: { type: input.actorId ? 'user' : 'system', id: input.actorId }, correlationId: input.correlationId, payload: { userId: user.id, tenantId: input.tenantId, email, fullName: user.fullName, inviteToken: token, expiresAt: expiresAt.toISOString(), alreadyActive: user.status === 'ACTIVE' } });
    await this.audit(tx, { action: 'OWNER_INVITED', entityType: 'USER', entityId: user.id, tenantId: input.tenantId, actor: { type: input.actorId ? 'user' : 'system', id: input.actorId }, correlationId: input.correlationId, summary: `Owner invite sent to ${email}` });
    return { userId: user.id, inviteToken: token, expiresAt, alreadyActive: user.status === 'ACTIVE' };
  }

  async acceptInvite(rawToken: string, input: { password: string; fullName?: string }, correlationId: string): Promise<{ userId: string; tenantId: string | null }> {
    const problem = passwordProblem(input.password);
    if (problem) throw businessRuleError('AUTH_PASSWORD_WEAK', problem, [{ path: 'password', message: problem }]);
    const hash = sha256(rawToken);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; user_id: string; tenant_id: string | null; expires_at: Date; used_at: Date | null }[]>`SELECT "id", "user_id", "tenant_id", "expires_at", "used_at" FROM "invite_tokens" WHERE "token_hash" = ${hash} FOR UPDATE`;
      const t = rows[0];
      if (!t || t.used_at) throw unauthorized('This invitation is invalid or was already used', 'AUTH_INVITE_INVALID');
      if (new Date(t.expires_at).getTime() <= Date.now()) throw new HttpError(410, 'AUTH_INVITE_INVALID', 'This invitation has expired');
      await tx.inviteToken.update({ where: { id: t.id }, data: { usedAt: new Date() } });
      await tx.user.update({ where: { id: t.user_id }, data: { passwordHash: await hashPassword(input.password), passwordAlgo: 'argon2id', status: 'ACTIVE', ...(input.fullName ? { fullName: input.fullName } : {}), version: { increment: 1 } } });
      await this.audit(tx, { action: 'INVITE_ACCEPTED', entityType: 'USER', entityId: t.user_id, tenantId: t.tenant_id, actor: { type: 'user', id: t.user_id }, correlationId });
      return { userId: t.user_id, tenantId: t.tenant_id };
    });
  }

  /* ---- identities for other services ------------------------------------- */

  /** Used by svc-iam (Phase 2) when an invited member accepts: creates or activates the identity. */
  async ensureUser(input: { email: string; fullName: string; password?: string }, correlationId: string): Promise<{ userId: string; status: string; created: boolean }> {
    const email = input.email.trim().toLowerCase();
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) {
        if (input.password && (existing.status === 'INVITED' || !existing.passwordHash)) {
          const problem = passwordProblem(input.password);
          if (problem) throw businessRuleError('AUTH_PASSWORD_WEAK', problem, [{ path: 'password', message: problem }]);
          await tx.user.update({ where: { id: existing.id }, data: { passwordHash: await hashPassword(input.password), passwordAlgo: 'argon2id', status: 'ACTIVE', version: { increment: 1 } } });
          return { userId: existing.id, status: 'ACTIVE', created: false };
        }
        return { userId: existing.id, status: existing.status, created: false };
      }
      if (input.password) {
        const problem = passwordProblem(input.password);
        if (problem) throw businessRuleError('AUTH_PASSWORD_WEAK', problem, [{ path: 'password', message: problem }]);
      }
      const user = await tx.user.create({ data: { id: uuidv7(), email, fullName: input.fullName, userType: 'TENANT', status: input.password ? 'ACTIVE' : 'INVITED', passwordHash: input.password ? await hashPassword(input.password) : null } });
      await this.audit(tx, { action: 'USER_CREATED', entityType: 'USER', entityId: user.id, tenantId: null, actor: { type: 'system', id: null }, correlationId });
      return { userId: user.id, status: user.status, created: true };
    });
  }

  async getUsers(ids: string[]): Promise<{ id: string; email: string; fullName: string; status: string; lastLoginAt: Date | null }[]> {
    return this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, fullName: true, status: true, lastLoginAt: true } });
  }

  async findUserByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true, email: true, fullName: true, status: true } });
  }

  /* ---- service tokens ----------------------------------------------------- */

  issueServiceToken(clientId: string, clientSecret: string, audience: string): { accessToken: string; expiresIn: number } {
    const expected = this.config.serviceClients.get(clientId);
    if (!expected || expected !== clientSecret) throw unauthorized('Invalid client credentials', 'AUTH_INVALID_CREDENTIALS');
    return { accessToken: this.tokens.signServiceToken(clientId, audience, 300), expiresIn: 300 };
  }

  /* ---- tenant lifecycle reactions ----------------------------------------- */

  async onTenantStatus(tx: Tx, tenantId: string, status: string, version: number, reason: string | null, correlationId: string): Promise<void> {
    const existing = await tx.tenantStatusReplica.findUnique({ where: { tenantId } });
    if (existing && existing.version > version) return; // out-of-order event
    await tx.tenantStatusReplica.upsert({ where: { tenantId }, update: { status, version, updatedAt: new Date() }, create: { tenantId, status, version } });
    if (status === 'SUSPENDED' || status === 'DEACTIVATED') {
      const revoked = await this.tokens.revokeSessions(tx, { tenantId }, `TENANT_${status}`);
      await this.audit(tx, { action: 'TENANT_SESSIONS_REVOKED', entityType: 'TENANT', entityId: tenantId, tenantId, actor: { type: 'system', id: null }, correlationId, summary: `${revoked} session(s) revoked: tenant ${status.toLowerCase()}${reason ? ` (${reason})` : ''}` });
    }
  }
}
