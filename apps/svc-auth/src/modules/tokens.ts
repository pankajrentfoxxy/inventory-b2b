/**
 * Sessions, access tokens and refresh-token rotation (phase-01 1.5 / 1.6).
 *
 * - Access token: RS256, short-lived, claims per README 5.1.
 * - Refresh token: opaque, sha256-hashed, sliding 14-day expiry, one rotation family per session.
 *   Presenting a token that was already used revokes the whole family and the session
 *   (`AUTH_REFRESH_REUSED`).
 */
import { opaqueToken, sha256, signClaims, unauthorized, uuidv7, type TokenClaims } from '@b2b/platform-kit';
import type { AuthConfig } from '../config.js';
import type { PrismaClient, Tx } from '../db.js';
import type { SigningKeys } from './keys.js';
import type { MembershipInfo } from './directory.js';

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  sessionId: string;
}

export interface Principal {
  id: string;
  email: string;
  fullName: string;
}

export interface SessionMeta {
  ip: string | null;
  userAgent: string | null;
}

export class TokenService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly keys: SigningKeys,
    private readonly config: AuthConfig,
  ) {}

  private signAccess(claims: Omit<TokenClaims, 'iat' | 'exp' | 'iss' | 'aud'>): string {
    const key = this.keys.signing;
    return signClaims(claims, this.config.ACCESS_TOKEN_TTL_SEC, { privateKeyPem: key.privateKeyPem, kid: key.kid, issuer: this.config.AUTH_ISSUER, audience: this.config.AUTH_AUDIENCE });
  }

  /** Short-lived tokens used inside the login flow (MFA step, tenant selection). */
  signFlowToken(typ: 'mfa' | 'select', userId: string, extra: Record<string, unknown> = {}, ttlSec = 300): string {
    const key = this.keys.signing;
    return signClaims({ sub: userId, typ, ...extra } as TokenClaims, ttlSec, { privateKeyPem: key.privateKeyPem, kid: key.kid, issuer: this.config.AUTH_ISSUER, audience: this.config.AUTH_AUDIENCE });
  }

  signServiceToken(serviceName: string, audience: string, ttlSec = 300): string {
    const key = this.keys.signing;
    return signClaims({ sub: serviceName, typ: 'service', svc: serviceName }, ttlSec, { privateKeyPem: key.privateKeyPem, kid: key.kid, issuer: this.config.AUTH_ISSUER, audience });
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  }

  async issueTenantSession(tx: Tx, user: Principal, membership: MembershipInfo, meta: SessionMeta): Promise<IssuedTokens> {
    const sessionId = uuidv7();
    await tx.session.create({ data: { id: sessionId, userId: user.id, tenantId: membership.tenantId, membershipId: membership.membershipId, tokenType: 'tenant', ip: meta.ip, userAgent: meta.userAgent?.slice(0, 400) ?? null, lastSeenAt: new Date() } });
    return this.mint(tx, sessionId, uuidv7(), {
      sub: user.id, typ: 'tenant', tid: membership.tenantId, mid: membership.membershipId, perms: membership.permissions, pv: membership.permissionVersion, wh: membership.allWarehouses === false ? membership.warehouseIds ?? [] : null, sid: sessionId, email: user.email, name: user.fullName,
    });
  }

  async issuePlatformSession(tx: Tx, user: Principal, permissions: string[], meta: SessionMeta): Promise<IssuedTokens> {
    const sessionId = uuidv7();
    await tx.session.create({ data: { id: sessionId, userId: user.id, tokenType: 'platform', ip: meta.ip, userAgent: meta.userAgent?.slice(0, 400) ?? null, lastSeenAt: new Date() } });
    return this.mint(tx, sessionId, uuidv7(), { sub: user.id, typ: 'platform', perms: permissions, sid: sessionId, email: user.email, name: user.fullName });
  }

  private async mint(tx: Tx, sessionId: string, familyId: string, claims: Omit<TokenClaims, 'iat' | 'exp' | 'iss' | 'aud'>): Promise<IssuedTokens> {
    const { token, hash } = opaqueToken();
    const refreshExpiresAt = this.refreshExpiry();
    await tx.refreshToken.create({ data: { id: uuidv7(), sessionId, tokenHash: hash, familyId, expiresAt: refreshExpiresAt } });
    // jti makes every access token unique even when two are minted within the same second.
    return { accessToken: this.signAccess({ ...claims, jti: uuidv7() }), expiresIn: this.config.ACCESS_TOKEN_TTL_SEC, refreshToken: token, refreshExpiresAt, sessionId };
  }

  /**
   * Rotates a refresh token. `resolveClaims` re-derives the access-token claims (tenant status,
   * membership, permissions) so revocations and permission changes take effect on refresh.
   */
  async rotate(rawToken: string, resolveClaims: (session: { id: string; userId: string; tenantId: string | null; membershipId: string | null; tokenType: string }) => Promise<Omit<TokenClaims, 'iat' | 'exp' | 'iss' | 'aud'>>): Promise<IssuedTokens> {
    const hash = sha256(rawToken);
    // Reuse detection must COMMIT its revocation, so it runs in its own statement before we throw.
    const peek = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash }, select: { familyId: true, sessionId: true, usedAt: true, revokedAt: true } });
    if (peek && peek.usedAt && !peek.revokedAt) {
      await this.prisma.$transaction([
        this.prisma.refreshToken.updateMany({ where: { familyId: peek.familyId, revokedAt: null }, data: { revokedAt: new Date() } }),
        this.prisma.session.updateMany({ where: { id: peek.sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'REFRESH_REUSE' } }),
      ]);
      throw unauthorized('Refresh token was reused; the session has been revoked', 'AUTH_REFRESH_REUSED');
    }
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; session_id: string; family_id: string; expires_at: Date; used_at: Date | null; revoked_at: Date | null }[]>`
        SELECT "id", "session_id", "family_id", "expires_at", "used_at", "revoked_at" FROM "refresh_tokens" WHERE "token_hash" = ${hash} FOR UPDATE`;
      const current = rows[0];
      if (!current) throw unauthorized('Refresh token is not valid', 'AUTH_REFRESH_INVALID');
      if (current.revoked_at) throw unauthorized('Refresh token is not valid', 'AUTH_REFRESH_INVALID');
      if (current.used_at) throw unauthorized('Refresh token was reused; the session has been revoked', 'AUTH_REFRESH_REUSED');
      if (new Date(current.expires_at).getTime() <= Date.now()) throw unauthorized('Refresh token has expired', 'AUTH_REFRESH_INVALID');
      const session = await tx.session.findUniqueOrThrow({ where: { id: current.session_id } });
      if (session.revokedAt) throw unauthorized('Session has been revoked', 'AUTH_REFRESH_INVALID');

      const claims = await resolveClaims(session);
      await tx.refreshToken.update({ where: { id: current.id }, data: { usedAt: new Date() } });
      await tx.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
      return this.mint(tx, session.id, current.family_id, claims);
    }, { maxWait: 10_000, timeout: 20_000 });
  }

  async revokeSession(sessionId: string, reason: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason } }),
      this.prisma.refreshToken.updateMany({ where: { sessionId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  }

  /** Revokes every session matching the filter (tenant suspended, membership removed, password reset). */
  async revokeSessions(tx: Tx, where: { tenantId?: string; membershipId?: string; userId?: string }, reason: string): Promise<number> {
    const sessions = await tx.session.findMany({ where: { ...where, revokedAt: null }, select: { id: true } });
    if (!sessions.length) return 0;
    const ids = sessions.map((s) => s.id);
    await tx.session.updateMany({ where: { id: { in: ids } }, data: { revokedAt: new Date(), revokeReason: reason } });
    await tx.refreshToken.updateMany({ where: { sessionId: { in: ids }, revokedAt: null }, data: { revokedAt: new Date() } });
    return ids.length;
  }

  async isSessionRevoked(sessionId: string): Promise<boolean> {
    const s = await this.prisma.session.findUnique({ where: { id: sessionId }, select: { revokedAt: true } });
    return !s || s.revokedAt !== null;
  }
}
