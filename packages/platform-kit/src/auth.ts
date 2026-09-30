/**
 * Identity and tenant context (README 5.1, ADR-0003, ADR-0004).
 *
 * Tokens are RS256 JWTs issued by svc-auth. Every service verifies the signature itself with the
 * issuer's public key (PEM in config, or fetched from the JWKS URL and cached) and builds a
 * request-scoped `TenantContext` from the claims. Nothing identity-related is read from headers.
 *
 * Token types (`typ`): `tenant` (tid, mid, perms, pv), `platform` (perms), `service` (aud = target
 * service; may carry `x-on-behalf-of-tenant`). Special short-lived tokens used inside the login
 * flow (`mfa`, `select`) are verified only by svc-auth.
 */
import { createPublicKey, type KeyObject } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { forbidden, unauthorized } from './errors.js';

export type TokenType = 'tenant' | 'platform' | 'service' | 'mfa' | 'select';

export interface TokenClaims extends JwtPayload {
  sub: string;
  typ: TokenType;
  tid?: string;
  mid?: string;
  perms?: string[];
  pv?: number;
  /** Warehouse scope: null/absent = all warehouses (phase-02 data scope). */
  wh?: string[] | null;
  sid?: string;
  email?: string;
  name?: string;
  /** Service tokens: the calling service's name is `sub`; `aud` is the target service. */
  svc?: string;
}

export interface TenantContext {
  tokenType: TokenType;
  userId: string;
  userName: string | null;
  email: string | null;
  /** null for platform tokens and for service tokens without on-behalf-of. */
  tenantId: string | null;
  membershipId: string | null;
  permissions: Set<string>;
  permissionVersion: number | null;
  /** null = all warehouses. */
  warehouseIds: string[] | null;
  sessionId: string | null;
  correlationId: string;
  /** Service tokens only. */
  serviceName: string | null;
}

declare module 'http' {
  interface IncomingMessage {
    tenantContext?: TenantContext;
  }
}

/* ---- key material ------------------------------------------------------ */

export interface KeyProvider {
  /** Returns the public key for `kid` (or the current key when kid is absent). */
  getPublicKey(kid: string | undefined): Promise<KeyObject | null>;
}

export class StaticKeyProvider implements KeyProvider {
  private readonly key: KeyObject;
  constructor(publicKeyPem: string) {
    this.key = createPublicKey(publicKeyPem);
  }
  async getPublicKey(): Promise<KeyObject> {
    return this.key;
  }
}

export interface Jwk {
  kid: string;
  kty: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
}

/** Fetches `/.well-known/jwks.json`, caches keys for `ttlMs` and refetches on an unknown kid. */
export class JwksKeyProvider implements KeyProvider {
  private keys = new Map<string, KeyObject>();
  private fetchedAt = 0;
  constructor(
    private readonly url: string,
    private readonly ttlMs = 10 * 60 * 1000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async refresh(): Promise<void> {
    const res = await this.fetchImpl(this.url, { signal: AbortSignal.timeout(3_000) });
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    const body = (await res.json()) as { keys: Jwk[] };
    const next = new Map<string, KeyObject>();
    for (const jwk of body.keys) next.set(jwk.kid, createPublicKey({ key: jwk as unknown as import('node:crypto').JsonWebKey, format: 'jwk' }));
    this.keys = next;
    this.fetchedAt = Date.now();
  }

  async getPublicKey(kid: string | undefined): Promise<KeyObject | null> {
    const stale = Date.now() - this.fetchedAt > this.ttlMs;
    if (stale || (kid && !this.keys.has(kid))) await this.refresh();
    if (kid) return this.keys.get(kid) ?? null;
    return this.keys.values().next().value ?? null;
  }
}

export function publicKeyToJwk(publicKey: KeyObject, kid: string): Jwk {
  const jwk = publicKey.export({ format: 'jwk' }) as { kty: string; n: string; e: string };
  return { kid, kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', use: 'sig' };
}

/* ---- verification ------------------------------------------------------ */

export interface VerifierOptions {
  keys: KeyProvider;
  issuer: string;
  audience: string;
  /** Legacy HS256 adapter (Phase 1 overlap window only). */
  legacySecret?: string;
  clockToleranceSec?: number;
}

export interface TokenVerifier {
  verify(token: string, opts?: { audience?: string; types?: TokenType[] }): Promise<TokenClaims>;
}

export function createTokenVerifier(options: VerifierOptions): TokenVerifier {
  return {
    async verify(token, opts = {}) {
      const decoded = jwt.decode(token, { complete: true });
      if (!decoded || typeof decoded === 'string') throw unauthorized('Invalid token');
      const header = decoded.header;
      if (header.alg === 'HS256') {
        if (!options.legacySecret) throw unauthorized('Invalid token');
        const payload = jwt.verify(token, options.legacySecret, { algorithms: ['HS256'], clockTolerance: options.clockToleranceSec ?? 5 }) as JwtPayload;
        if (!payload.sub) throw unauthorized('Invalid token');
        // Legacy tokens carry no tenant: the caller (legacy API) resolves it from the membership header.
        return { ...payload, sub: payload.sub, typ: 'tenant' } as TokenClaims;
      }
      const key = await options.keys.getPublicKey(header.kid);
      if (!key) throw unauthorized('Unknown signing key');
      let payload: TokenClaims;
      try {
        payload = jwt.verify(token, key, {
          algorithms: ['RS256'],
          issuer: options.issuer,
          audience: opts.audience ?? options.audience,
          clockTolerance: options.clockToleranceSec ?? 5,
        }) as TokenClaims;
      } catch (err) {
        if (err instanceof jwt.TokenExpiredError) throw unauthorized('Your session has expired. Please sign in again.', 'TOKEN_EXPIRED');
        throw unauthorized('Invalid token');
      }
      if (!payload.sub || !payload.typ) throw unauthorized('Invalid token');
      if (opts.types && !opts.types.includes(payload.typ)) throw unauthorized('This token cannot be used here', 'TOKEN_TYPE_INVALID');
      return payload;
    },
  };
}

/* ---- signing (svc-auth and the test kit) ------------------------------- */

export interface SignerOptions {
  privateKeyPem: string;
  kid: string;
  issuer: string;
  audience: string;
}

export function signClaims(claims: Omit<TokenClaims, 'iat' | 'exp' | 'iss' | 'aud'>, expiresInSec: number, options: SignerOptions & { audience?: string }): string {
  const signOptions: SignOptions = {
    algorithm: 'RS256',
    keyid: options.kid,
    issuer: options.issuer,
    audience: options.audience,
    expiresIn: expiresInSec,
  };
  return jwt.sign(claims, options.privateKeyPem, signOptions);
}

/* ---- middleware -------------------------------------------------------- */

export function contextFromClaims(claims: TokenClaims, correlationId: string, onBehalfOfTenant: string | null = null): TenantContext {
  return {
    tokenType: claims.typ,
    userId: claims.sub,
    userName: claims.name ?? null,
    email: claims.email ?? null,
    tenantId: claims.typ === 'service' ? onBehalfOfTenant : claims.tid ?? null,
    membershipId: claims.mid ?? null,
    permissions: new Set(claims.perms ?? []),
    permissionVersion: claims.pv ?? null,
    warehouseIds: claims.wh ?? null,
    sessionId: claims.sid ?? null,
    correlationId,
    serviceName: claims.typ === 'service' ? claims.sub : null,
  };
}

export interface AuthenticateOptions {
  verifier: TokenVerifier;
  /** Accepted token types on this route group. Default: tenant + platform. */
  types?: TokenType[];
  /** This service's name; required to accept service tokens (aud = serviceName). */
  serviceName?: string;
}

/** Verifies the bearer token and builds `req.tenantContext`. */
export function authenticate(options: AuthenticateOptions): RequestHandler {
  const types = options.types ?? ['tenant', 'platform'];
  return (req, _res, next) => {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) return next(unauthorized());
    const token = header.slice(7);
    const decoded = jwt.decode(token) as TokenClaims | null;
    const isService = decoded?.typ === 'service';
    options.verifier
      .verify(token, { types, audience: isService ? options.serviceName : undefined })
      .then((claims) => {
        const onBehalf = isService ? req.header('x-on-behalf-of-tenant') ?? null : null;
        req.tenantContext = contextFromClaims(claims, req.correlationId ?? '', onBehalf);
        next();
      })
      .catch(next);
  };
}

export function getContext(req: Request): TenantContext {
  if (!req.tenantContext) throw unauthorized();
  return req.tenantContext;
}

/** Tenant routes: the token must be a tenant token (or a service token acting on behalf of a tenant). */
export const requireTenant: RequestHandler = (req, _res, next) => {
  const ctx = req.tenantContext;
  if (!ctx) return next(unauthorized());
  if (ctx.tokenType === 'platform') return next(forbidden('Platform accounts cannot use tenant APIs', 'PLATFORM_TOKEN_ON_TENANT_ROUTE'));
  if (!ctx.tenantId) return next(forbidden('A tenant context is required', 'TENANT_REQUIRED'));
  next();
};

/** Platform routes (`/api/v1/platform/*`): platform tokens only (README 5.1 rule 4). */
export const requirePlatform: RequestHandler = (req, _res, next) => {
  const ctx = req.tenantContext;
  if (!ctx) return next(unauthorized());
  if (ctx.tokenType !== 'platform') return next(forbidden('This API is for platform administrators', 'PLATFORM_ONLY'));
  next();
};

/** Internal routes: service tokens only. */
export function requireService(...allowedCallers: string[]): RequestHandler {
  return (req, _res, next) => {
    const ctx = req.tenantContext;
    if (!ctx) return next(unauthorized());
    if (ctx.tokenType !== 'service') return next(forbidden('Internal API', 'SERVICE_ONLY'));
    if (allowedCallers.length && !allowedCallers.includes(ctx.serviceName ?? '')) {
      return next(forbidden(`Service ${ctx.serviceName} may not call this endpoint`, 'SERVICE_NOT_ALLOWED'));
    }
    next();
  };
}

/** Backend authorization gate (README 5.1). Includes the missing code in `details` for the UI. */
export function requirePermission(...codes: string[]): RequestHandler {
  return (req, _res, next) => {
    const ctx = req.tenantContext;
    if (!ctx) return next(unauthorized());
    if (ctx.tokenType === 'service') return next(); // service tokens are authorised by requireService allow-lists
    if (codes.some((c) => ctx.permissions.has(c))) return next();
    next(forbidden(`This action requires the "${codes.join('" or "')}" permission`, 'FORBIDDEN', codes.map((c) => ({ path: 'permission', message: c }))));
  };
}

/** Warehouse data scope (phase-02 2.6 WarehouseScoped): true when the caller may act on this warehouse. */
export function inWarehouseScope(ctx: TenantContext, warehouseId: string | null | undefined): boolean {
  if (!ctx.warehouseIds) return true;
  return warehouseId ? ctx.warehouseIds.includes(warehouseId) : false;
}
