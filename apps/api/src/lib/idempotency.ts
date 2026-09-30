/**
 * Idempotency-Key handling (phase-plan/README.md 5.6).
 *
 *   same key + same body + COMPLETED   -> replay the stored response (header Idempotent-Replayed)
 *   same key + different body          -> 422 IDEMPOTENCY_KEY_REUSED
 *   same key + IN_PROGRESS             -> 409 IDEMPOTENCY_IN_PROGRESS
 *   missing / malformed key            -> 400
 *
 * The key row is claimed *before* the handler runs (it doubles as a lock), and the response is
 * stored before it is sent. 5xx responses release the key so the client can retry.
 * Mount after requireOrganization and validateBody so the hash covers the normalised payload.
 */
import { createHash } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from './prisma.js';
import { HttpError, badRequest, conflict, unauthorized } from './errors.js';
import { logger } from './logger.js';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const IDEMPOTENCY_REPLAY_HEADER = 'idempotent-replayed';
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const keySchema = z.string().uuid();

/** JSON with object keys sorted recursively, so equal bodies hash equal regardless of key order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function hashRequest(body: unknown): string {
  return createHash('sha256').update(stableStringify(body ?? null)).digest('hex');
}

type Claim = { kind: 'claimed' } | { kind: 'replay'; code: number; body: unknown };

async function claimKey(tenantId: string, scope: string, key: string, requestHash: string): Promise<Claim> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // ON CONFLICT DO NOTHING: a lost race is the normal path here, not an error worth logging.
    const inserted = await prisma.$executeRaw`
      INSERT INTO "idempotency_keys" ("tenant_id", "scope", "key", "request_hash", "status", "expires_at")
      VALUES (${tenantId}::uuid, ${scope}, ${key}::uuid, ${requestHash}, 'IN_PROGRESS', ${new Date(Date.now() + IDEMPOTENCY_TTL_MS)})
      ON CONFLICT DO NOTHING`;
    if (inserted === 1) return { kind: 'claimed' };
    const existing = await prisma.idempotencyKey.findUnique({ where: { tenantId_scope_key: { tenantId, scope, key } } });
    if (!existing) continue; // released between our insert and read; try again
    if (existing.expiresAt.getTime() <= Date.now()) {
      await prisma.idempotencyKey.deleteMany({ where: { tenantId, scope, key, expiresAt: existing.expiresAt } });
      continue;
    }
    if (existing.requestHash !== requestHash) {
      throw new HttpError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request');
    }
    if (existing.status !== 'COMPLETED') {
      throw conflict('A request with this Idempotency-Key is still being processed', 'IDEMPOTENCY_IN_PROGRESS');
    }
    return { kind: 'replay', code: existing.responseCode ?? 200, body: existing.responseBody };
  }
  throw conflict('A request with this Idempotency-Key is still being processed', 'IDEMPOTENCY_IN_PROGRESS');
}

async function completeKey(tenantId: string, scope: string, key: string, code: number, body: unknown) {
  await prisma.idempotencyKey.update({
    where: { tenantId_scope_key: { tenantId, scope, key } },
    data: { status: 'COMPLETED', responseCode: code, responseBody: (body ?? Prisma.JsonNull) as Prisma.InputJsonValue },
  });
}

async function releaseKey(tenantId: string, scope: string, key: string) {
  await prisma.idempotencyKey.deleteMany({ where: { tenantId, scope, key } });
}

/** The validated key for the current request (set by `idempotent`). */
export function getIdempotencyKey(res: Response): string | null {
  return (res.locals.idempotencyKey as string | undefined) ?? null;
}

/**
 * Requires and enforces an Idempotency-Key for the route. `scope` isolates keys per endpoint,
 * e.g. 'POST /purchase-receives'.
 */
export function idempotent(scope: string): RequestHandler {
  async function run(req: Request, res: Response): Promise<boolean> {
    const ctx = req.ctx;
    if (!ctx) throw unauthorized();
    const raw = req.header(IDEMPOTENCY_HEADER);
    if (!raw) throw badRequest('Idempotency-Key header is required for this request', 'IDEMPOTENCY_KEY_REQUIRED');
    const parsed = keySchema.safeParse(raw.trim());
    if (!parsed.success) throw badRequest('Idempotency-Key must be a UUID', 'IDEMPOTENCY_KEY_INVALID');
    const key = parsed.data.toLowerCase();
    const requestHash = hashRequest(req.body);
    const tenantId = ctx.organizationId;

    const claim = await claimKey(tenantId, scope, key, requestHash);
    if (claim.kind === 'replay') {
      res.setHeader(IDEMPOTENCY_REPLAY_HEADER, 'true');
      res.status(claim.code).json(claim.body);
      return false;
    }

    res.locals.idempotencyKey = key;
    const originalJson = res.json.bind(res);
    let stored = false;
    res.json = ((body: unknown) => {
      if (stored) return originalJson(body);
      stored = true;
      const status = res.statusCode;
      const persist = status >= 500 ? releaseKey(tenantId, scope, key) : completeKey(tenantId, scope, key, status, body);
      persist
        .catch((err) => logger.error({ err, scope, key }, 'failed to store idempotent response'))
        .finally(() => originalJson(body));
      return res;
    }) as Response['json'];
    return true;
  }

  return (req, res, next) => {
    run(req, res)
      .then((proceed) => {
        if (proceed) next();
      })
      .catch(next);
  };
}
