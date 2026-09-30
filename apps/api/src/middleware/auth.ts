import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { PermissionCode } from '@b2b/shared';
import { LEGACY_PERMISSION_MAP } from '@b2b/contracts';
import { JwksKeyProvider, StaticKeyProvider, createTokenVerifier, type KeyProvider, type TokenClaims, type TokenVerifier } from '@b2b/platform-kit';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { badRequest, forbidden, unauthorized } from '../lib/errors.js';
import { uuidv7 } from '../lib/ids.js';

export interface AuthPrincipal {
  userId: string;
  email: string;
  /** Present for platform-issued (RS256) tokens: tenant id, membership id and permissions. */
  tenantId?: string | null;
  membershipId?: string | null;
  tokenPermissions?: string[] | null;
  isPlatformToken?: boolean;
}

export interface RequestContext {
  userId: string;
  userName: string;
  email: string;
  organizationId: string;
  organizationName: string;
  roleId: string;
  roleCode: string;
  isOwner: boolean;
  permissions: Set<string>;
  /** Request correlation id (from the gateway or minted here); stamped on audit events. */
  correlationId: string;
}

export const ORG_HEADER = 'x-organization-id';

export function signToken(principal: AuthPrincipal): string {
  return jwt.sign({ email: principal.email }, env.JWT_SECRET, {
    subject: principal.userId,
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

/* ---- token verification (Phase 1 step 8.4) ---------------------------------- */

let keyProvider: KeyProvider | null = env.AUTH_JWT_PUBLIC_KEY ? new StaticKeyProvider(env.AUTH_JWT_PUBLIC_KEY) : env.AUTH_JWKS_URL ? new JwksKeyProvider(env.AUTH_JWKS_URL) : null;
let verifier: TokenVerifier = buildVerifier();

function buildVerifier(): TokenVerifier {
  return createTokenVerifier({
    keys: keyProvider ?? { getPublicKey: async () => null },
    issuer: env.AUTH_ISSUER,
    audience: env.AUTH_AUDIENCE,
    legacySecret: env.JWT_SECRET,
  });
}

/** Tests swap in their own RS256 key pair. */
export function configureTokenVerifier(keys: KeyProvider | null) {
  keyProvider = keys;
  verifier = buildVerifier();
}

/**
 * Legacy permission codes derived from a platform token's `perms` claim
 * (packages/contracts LEGACY_PERMISSION_MAP). Any mapped new code satisfies the legacy check.
 */
export function legacyPermissionsFromToken(perms: Iterable<string>): Set<string> {
  const held = new Set(perms);
  const out = new Set<string>();
  for (const [legacy, mapped] of Object.entries(LEGACY_PERMISSION_MAP)) {
    if (mapped.some((code) => held.has(code))) out.add(legacy);
  }
  return out;
}

/** Verifies the bearer token (RS256 platform token or legacy HS256). Does not touch the database. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return next(unauthorized());
  verifier
    .verify(header.slice(7), { types: ['tenant', 'platform'] })
    .then((claims: TokenClaims) => {
      if (claims.typ === 'platform') return next(forbidden('Platform accounts cannot use tenant APIs', 'PLATFORM_TOKEN_ON_TENANT_ROUTE'));
      req.auth = {
        userId: claims.sub,
        email: String(claims.email ?? ''),
        tenantId: claims.tid ?? null,
        membershipId: claims.mid ?? null,
        tokenPermissions: claims.perms ?? null,
        isPlatformToken: Boolean(claims.tid),
      };
      next();
    })
    .catch(() => next(unauthorized('Your session has expired. Please sign in again.', 'TOKEN_INVALID')));
};

/**
 * Resolves the tenant: from the token's `tid` (platform tokens) or the X-Organization-Id header
 * (legacy tokens), then verifies the caller is an active member. Permissions come from the token
 * when present (mapped onto legacy codes), otherwise from the member's role.
 */
export async function requireOrganization(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.auth) return next(unauthorized());
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let organizationId = req.auth.tenantId ?? null;
    if (!organizationId) {
      const headerOrg = req.header(ORG_HEADER);
      if (!headerOrg) return next(badRequest('X-Organization-Id header is required', 'ORGANIZATION_REQUIRED'));
      if (!uuidRe.test(headerOrg)) return next(badRequest('X-Organization-Id must be a UUID', 'ORGANIZATION_INVALID'));
      organizationId = headerOrg;
    } else {
      // A header that disagrees with the token is ignored: the token is the truth (README 5.1 rule 1).
      const headerOrg = req.header(ORG_HEADER);
      if (headerOrg && headerOrg.toLowerCase() !== organizationId.toLowerCase()) {
        return next(forbidden('You do not have access to this organization', 'ORGANIZATION_ACCESS_DENIED'));
      }
    }

    const membership = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: req.auth.userId } },
      include: {
        user: { select: { id: true, name: true, email: true, isActive: true } },
        organization: { select: { id: true, name: true } },
        role: { include: { permissions: { include: { permission: { select: { code: true } } } } } },
      },
    });

    if (!membership || membership.status !== 'ACTIVE' || !membership.user.isActive) {
      // Same response whether the org does not exist or the user is simply not a member:
      // never confirm another tenant's existence.
      return next(forbidden('You do not have access to this organization', 'ORGANIZATION_ACCESS_DENIED'));
    }

    const permissions = req.auth.tokenPermissions ? legacyPermissionsFromToken(req.auth.tokenPermissions) : new Set(membership.role.permissions.map((rp) => rp.permission.code));

    req.ctx = {
      userId: membership.user.id,
      userName: membership.user.name,
      email: membership.user.email,
      organizationId: membership.organization.id,
      organizationName: membership.organization.name,
      roleId: membership.role.id,
      roleCode: membership.role.code,
      isOwner: membership.isOwner,
      permissions,
      correlationId: req.correlationId ?? uuidv7(),
    };
    next();
  } catch (err) {
    next(err);
  }
}

/** Backend authorization gate. Always used after requireOrganization. */
export function requirePermission(...codes: PermissionCode[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.ctx) return next(unauthorized());
    const ok = codes.some((code) => req.ctx!.permissions.has(code));
    if (!ok) {
      return next(
        forbidden(`This action requires the "${codes.join('" or "')}" permission`, 'PERMISSION_DENIED'),
      );
    }
    next();
  };
}

export function getCtx(req: Request): RequestContext {
  if (!req.ctx) throw unauthorized();
  return req.ctx;
}
