import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { PermissionCode } from '@b2b/shared';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { badRequest, forbidden, unauthorized } from '../lib/errors.js';

export interface AuthPrincipal {
  userId: string;
  email: string;
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
}

export const ORG_HEADER = 'x-organization-id';

export function signToken(principal: AuthPrincipal): string {
  return jwt.sign({ email: principal.email }, env.JWT_SECRET, {
    subject: principal.userId,
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

/** Verifies the bearer token signature. Does not touch the database. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return next(unauthorized());
  try {
    const payload = jwt.verify(header.slice(7), env.JWT_SECRET) as jwt.JwtPayload;
    if (!payload.sub) return next(unauthorized('Invalid token'));
    req.auth = { userId: payload.sub, email: String(payload.email ?? '') };
    next();
  } catch {
    next(unauthorized('Your session has expired. Please sign in again.', 'TOKEN_INVALID'));
  }
};

/**
 * Resolves the tenant from the X-Organization-Id header and verifies the caller is an
 * active member. Loads the member's role permissions so requirePermission is a Set lookup.
 */
export async function requireOrganization(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.auth) return next(unauthorized());
    const organizationId = req.header(ORG_HEADER);
    if (!organizationId) {
      return next(badRequest('X-Organization-Id header is required', 'ORGANIZATION_REQUIRED'));
    }
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(organizationId)) {
      return next(badRequest('X-Organization-Id must be a UUID', 'ORGANIZATION_INVALID'));
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

    req.ctx = {
      userId: membership.user.id,
      userName: membership.user.name,
      email: membership.user.email,
      organizationId: membership.organization.id,
      organizationName: membership.organization.name,
      roleId: membership.role.id,
      roleCode: membership.role.code,
      isOwner: membership.isOwner,
      permissions: new Set(membership.role.permissions.map((rp) => rp.permission.code)),
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
