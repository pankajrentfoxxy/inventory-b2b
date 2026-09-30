/**
 * Idempotency-Key handling (README 5.6), database-agnostic (raw SQL on `idempotency_keys`).
 *   same key + same body + COMPLETED   -> replay stored response (header Idempotent-Replayed)
 *   same key + different body          -> 422 IDEMPOTENCY_KEY_REUSED
 *   same key + IN_PROGRESS             -> 409 IDEMPOTENCY_IN_PROGRESS
 *   missing / malformed key            -> 400
 * Mount after authentication and validateBody. The tenant id comes from the request context; for
 * platform routes the scope owner is the platform sentinel tenant.
 */
import type { Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import type { SqlClient } from './db.js';
import { HttpError, badRequest, conflict, unauthorized } from './errors.js';
import { hashPayload } from './ids.js';
import type { Logger } from './logger.js';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const IDEMPOTENCY_REPLAY_HEADER = 'idempotent-replayed';
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** Tenant id used for platform-scoped idempotency rows. */
export const PLATFORM_TENANT_SENTINEL = '00000000-0000-0000-0000-000000000000';

const keySchema = z.string().uuid();

type Claim = { kind: 'claimed' } | { kind: 'replay'; code: number; body: unknown };

interface KeyRow {
  request_hash: string;
  status: string;
  response_code: number | null;
  response_body: unknown;
  expires_at: Date;
}

async function claimKey(db: SqlClient, tenantId: string, scope: string, key: string, requestHash: string): Promise<Claim> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const inserted = await db.$executeRaw`
      INSERT INTO "idempotency_keys" ("tenant_id", "scope", "key", "request_hash", "status", "expires_at")
      VALUES (${tenantId}::uuid, ${scope}, ${key}::uuid, ${requestHash}, 'IN_PROGRESS', ${new Date(Date.now() + IDEMPOTENCY_TTL_MS)})
      ON CONFLICT DO NOTHING`;
    if (inserted === 1) return { kind: 'claimed' };
    const rows = await db.$queryRaw<KeyRow[]>`
      SELECT "request_hash", "status", "response_code", "response_body", "expires_at" FROM "idempotency_keys"
      WHERE "tenant_id" = ${tenantId}::uuid AND "scope" = ${scope} AND "key" = ${key}::uuid`;
    const existing = rows[0];
    if (!existing) continue;
    if (new Date(existing.expires_at).getTime() <= Date.now()) {
      await db.$executeRaw`DELETE FROM "idempotency_keys" WHERE "tenant_id" = ${tenantId}::uuid AND "scope" = ${scope} AND "key" = ${key}::uuid AND "expires_at" = ${existing.expires_at}`;
      continue;
    }
    if (existing.request_hash !== requestHash) throw new HttpError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request');
    if (existing.status !== 'COMPLETED') throw conflict('A request with this Idempotency-Key is still being processed', 'IDEMPOTENCY_IN_PROGRESS');
    return { kind: 'replay', code: existing.response_code ?? 200, body: existing.response_body };
  }
  throw conflict('A request with this Idempotency-Key is still being processed', 'IDEMPOTENCY_IN_PROGRESS');
}

export function getIdempotencyKey(res: Response): string | null {
  return (res.locals.idempotencyKey as string | undefined) ?? null;
}

export interface IdempotencyOptions {
  db: SqlClient;
  logger: Logger;
  /** Resolves the tenant that owns the key; defaults to the request's tenant context or the platform sentinel. */
  tenantOf?: (req: Request) => string | null;
  /** When false (default true) a missing header is allowed and the request runs without idempotency. */
  required?: boolean;
}

export function idempotent(scope: string, options: IdempotencyOptions): RequestHandler {
  const { db, logger } = options;
  const required = options.required ?? true;

  async function run(req: Request, res: Response): Promise<boolean> {
    const raw = req.header(IDEMPOTENCY_HEADER);
    if (!raw) {
      if (!required) return true;
      throw badRequest('Idempotency-Key header is required for this request', 'IDEMPOTENCY_KEY_REQUIRED');
    }
    const parsed = keySchema.safeParse(raw.trim());
    if (!parsed.success) throw badRequest('Idempotency-Key must be a UUID', 'IDEMPOTENCY_KEY_INVALID');
    const key = parsed.data.toLowerCase();
    const tenantId = options.tenantOf ? options.tenantOf(req) : (req.tenantContext?.tenantId ?? PLATFORM_TENANT_SENTINEL);
    if (!tenantId) throw unauthorized();
    const requestHash = hashPayload({ body: req.body, params: req.params, path: req.baseUrl + req.path });

    const claim = await claimKey(db, tenantId, scope, key, requestHash);
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
      const persist =
        status >= 500
          ? db.$executeRaw`DELETE FROM "idempotency_keys" WHERE "tenant_id" = ${tenantId}::uuid AND "scope" = ${scope} AND "key" = ${key}::uuid`
          : db.$executeRaw`UPDATE "idempotency_keys" SET "status" = 'COMPLETED', "response_code" = ${status}, "response_body" = ${JSON.stringify(body ?? null)}::jsonb
                           WHERE "tenant_id" = ${tenantId}::uuid AND "scope" = ${scope} AND "key" = ${key}::uuid`;
      persist.catch((err) => logger.error({ err, scope, key }, 'failed to store idempotent response')).finally(() => originalJson(body));
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
