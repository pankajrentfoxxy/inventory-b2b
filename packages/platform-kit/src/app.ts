/**
 * Express chassis for a service: correlation id, security headers, CORS, JSON body, request logging,
 * health, then the service's routers, then the 404 and error handlers.
 */
import compression from 'compression';
import cors from 'cors';
import express, { type Express, type ErrorRequestHandler, type RequestHandler } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { correlation, type CorrelationOptions } from './correlation.js';
import { HttpError, errorBody, type ErrorMeta } from './errors.js';
import { createHealthRouter, type HealthChecks } from './health.js';
import type { Logger } from './logger.js';

export interface ServiceAppOptions {
  service: string;
  logger: Logger;
  isTest: boolean;
  corsOrigins: string[];
  healthChecks: HealthChecks;
  /** Mounts the service's routers. */
  routes: (app: Express) => void;
  correlation?: CorrelationOptions;
  bodyLimit?: string;
  /** Maps library / database errors to HttpError before the generic handler. */
  mapError?: (err: unknown) => HttpError | null;
}

const PG_CHECK_VIOLATION = '23514';
const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_SERIALIZATION_FAILURE = '40001';
const PG_DEADLOCK = '40P01';

/** Prisma raw-query errors carry the Postgres SQLSTATE in meta.code. */
export function mapPrismaError(err: unknown): HttpError | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { code?: string; meta?: { code?: string }; message?: string };
  // ORM (non-raw) constraint failures surface as unknown request errors carrying the SQLSTATE in the message.
  if (!e.code && typeof e.message === 'string') {
    if (e.message.includes('23514')) return new HttpError(422, 'CONSTRAINT_VIOLATION', 'The change violates a data integrity rule');
    if (e.message.includes('23505')) return new HttpError(409, 'DUPLICATE', 'A record with the same unique value already exists');
    if (e.message.includes('40P01') || e.message.includes('40001')) return new HttpError(409, 'CONCURRENT_MODIFICATION', 'The record was modified by another request. Please retry.', undefined, true);
  }
  const sqlState = e.meta?.code;
  switch (e.code) {
    case 'P2002':
      return new HttpError(409, 'DUPLICATE', 'A record with the same unique value already exists');
    case 'P2025':
      return new HttpError(404, 'NOT_FOUND', 'Resource not found');
    case 'P2003':
      return new HttpError(409, 'REFERENCE_CONFLICT', 'This record is referenced by other data');
    case 'P2023':
      return new HttpError(404, 'NOT_FOUND', 'Resource not found');
    case 'P2034':
      return new HttpError(409, 'CONCURRENT_MODIFICATION', 'The record was modified by another request. Please retry.', undefined, true);
    case 'P2010':
      if (sqlState === PG_UNIQUE_VIOLATION) return new HttpError(409, 'DUPLICATE', 'A record with the same unique value already exists');
      if (sqlState === PG_CHECK_VIOLATION) return new HttpError(422, 'CONSTRAINT_VIOLATION', 'The change violates a data integrity rule');
      if (sqlState === PG_FOREIGN_KEY_VIOLATION) return new HttpError(409, 'REFERENCE_CONFLICT', 'This record is referenced by other data');
      if (sqlState === PG_SERIALIZATION_FAILURE || sqlState === PG_DEADLOCK) {
        return new HttpError(409, 'CONCURRENT_MODIFICATION', 'The record was modified by another request. Please retry.', undefined, true);
      }
      return null;
    default:
      return null;
  }
}

export function createServiceApp(options: ServiceAppOptions): Express {
  const { logger } = options;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(correlation(options.correlation));
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || options.corsOrigins.includes(origin)) return cb(null, true);
        cb(new Error(`Origin ${origin} is not allowed`));
      },
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'If-Match', 'X-Correlation-Id'],
      exposedHeaders: ['X-Correlation-Id', 'Idempotent-Replayed', 'ETag'],
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: options.bodyLimit ?? '1mb' }));
  if (!options.isTest) {
    app.use(
      pinoHttp({
        logger,
        autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/health') },
        customProps: (req) => ({ correlationId: req.correlationId, tenantId: req.tenantContext?.tenantId, userId: req.tenantContext?.userId }),
      }),
    );
  }
  app.use('/health', createHealthRouter(options.service, options.healthChecks));

  options.routes(app);

  const notFoundHandler: RequestHandler = (req, res) => {
    res.status(404).json(errorBody('ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`, undefined, { correlationId: req.correlationId }));
  };
  app.use(notFoundHandler);

  const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    const meta: ErrorMeta = { correlationId: req.correlationId };
    let error: unknown = err;
    if (!(error instanceof HttpError)) error = options.mapError?.(error) ?? mapPrismaError(error) ?? error;
    if (error instanceof HttpError) {
      if (error.retryable) meta.retryable = true;
      res.status(error.status).json(errorBody(error.code, error.message, error.details, meta));
      return;
    }
    if (error instanceof SyntaxError && 'body' in (error as object)) {
      res.status(400).json(errorBody('INVALID_JSON', 'Request body is not valid JSON', undefined, meta));
      return;
    }
    if (error && typeof error === 'object' && (error as { type?: string }).type === 'entity.too.large') {
      res.status(413).json(errorBody('PAYLOAD_TOO_LARGE', 'Request body is too large', undefined, meta));
      return;
    }
    logger.error({ err: error, correlationId: req.correlationId }, 'Unhandled error');
    res.status(500).json(errorBody('INTERNAL_ERROR', 'Something went wrong. Please try again.', undefined, meta));
  };
  app.use(errorHandler);
  return app;
}
