import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { notFound, validationError, type ErrorDetail } from './errors.js';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/** Wraps an async controller so rejections reach the error middleware. */
export const asyncHandler =
  (fn: AsyncHandler): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/** Flattens zod issues to { path, message }, one entry per path. */
export function formatIssues(error: z.ZodError): ErrorDetail[] {
  const seen = new Set<string>();
  const details: ErrorDetail[] = [];
  for (const issue of error.issues) {
    const path = issue.path.join('.');
    if (seen.has(path)) continue;
    seen.add(path);
    details.push({ path, message: issue.message });
  }
  return details;
}

/** Validates and replaces req.body with the parsed payload. Malformed bodies are 422 VALIDATION_FAILED. */
export function validateBody<T extends ZodTypeAny>(schema: T): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) return next(validationError(formatIssues(result.error)));
    req.body = result.data;
    next();
  };
}

export function validateQuery<T extends ZodTypeAny>(schema: T): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.query ?? {});
    if (!result.success) return next(validationError(formatIssues(result.error), 'Invalid query parameters'));
    res.locals.query = result.data;
    next();
  };
}

export function parseQuery<T extends ZodTypeAny>(res: Response): z.output<T> {
  return res.locals.query as z.output<T>;
}

export function validateParams<T extends ZodTypeAny>(schema: T): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.params ?? {});
    if (!result.success) return next(validationError(formatIssues(result.error), 'Invalid request path'));
    res.locals.params = result.data;
    next();
  };
}

export function parseParams<T extends ZodTypeAny>(res: Response): z.output<T> {
  return res.locals.params as z.output<T>;
}

const uuidSchema = z.string().uuid();

/** Route params named here must be UUIDs; anything else is a 404 (nothing can exist under a malformed id). */
export function requireUuidParams(router: Router, ...names: string[]) {
  for (const name of names) {
    router.param(name, (_req, _res, next, value: string) => {
      next(uuidSchema.safeParse(value).success ? undefined : notFound());
    });
  }
}

export const isUuid = (value: unknown): value is string => uuidSchema.safeParse(value).success;

/** Cursor pagination helpers (README 5.12): opaque base64url cursor over (sortValue, id). */
export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
}

export function encodeCursor(parts: (string | number | null)[]): string {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined | null): (string | number | null)[] | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Reads `If-Match: <version>` (optimistic concurrency). Returns null when absent. */
export function ifMatchVersion(req: Request): number | null {
  const raw = req.header('if-match');
  if (raw === undefined || raw === '') return null;
  const n = Number(raw.replace(/"/g, ''));
  return Number.isInteger(n) && n >= 0 ? n : null;
}
