import type { Request, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { errorBody } from './errors.js';

export interface RateLimitOptions {
  windowMs: number;
  limit: number;
  /** Key builder; default per IP. */
  keyOf?: (req: Request) => string;
  code?: string;
  message?: string;
}

/** Fixed-window limiter answering the standard envelope with `retryable: true`. In-memory store. */
export function createRateLimiter(options: RateLimitOptions): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => (options.keyOf ? options.keyOf(req as Request) : `ip:${req.ip}`),
    handler: (req, res) => {
      res.status(429).json(errorBody(options.code ?? 'RATE_LIMITED', options.message ?? 'Too many requests. Please slow down.', undefined, { correlationId: req.correlationId, retryable: true }));
    },
  });
}
