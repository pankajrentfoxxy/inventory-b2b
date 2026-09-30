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

/**
 * Flattens zod issues to { path, message }. One entry per path: when a field fails several rules
 * only the first message is shown, which is what the form displays anyway.
 */
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

/** Validates and replaces req.body with the parsed (trimmed / normalised) payload. */
export function validateBody<T extends ZodTypeAny>(schema: T): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) return next(validationError(formatIssues(result.error)));
    req.body = result.data;
    next();
  };
}

/** Validates req.query and stores the typed result on res.locals.query. */
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

/** Validates route params (ids, enum segments) and stores the typed result on res.locals.params. */
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

/**
 * Route params named here must be UUIDs. Anything else answers 404: nothing can exist under a
 * malformed id, and a 404 reveals nothing (phase-plan/README.md 5.2 / 5.12).
 */
export function requireUuidParams(router: Router, ...names: string[]) {
  for (const name of names) {
    router.param(name, (_req, _res, next, value: string) => {
      next(uuidSchema.safeParse(value).success ? undefined : notFound());
    });
  }
}
