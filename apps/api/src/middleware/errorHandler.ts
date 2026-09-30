import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import multer from 'multer';
import { MESSAGES, UPLOAD_MAX_MB } from '@b2b/shared';
import { env } from '../config/env.js';
import { HttpError, errorBody, type ErrorMeta } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json(errorBody('ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`, undefined, { correlationId: req.correlationId }));
};

/** Multer raises these before our handlers run; translate them into the standard envelope. */
function fromMulter(err: multer.MulterError): HttpError {
  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
      return new HttpError(413, 'FILE_TOO_LARGE', MESSAGES.fileSize(Math.min(env.MAX_UPLOAD_MB, UPLOAD_MAX_MB)), [
        { path: 'file', message: MESSAGES.fileSize(Math.min(env.MAX_UPLOAD_MB, UPLOAD_MAX_MB)) },
      ]);
    case 'LIMIT_FILE_COUNT':
    case 'LIMIT_UNEXPECTED_FILE':
      return new HttpError(422, 'VALIDATION_ERROR', MESSAGES.fixHighlighted, [{ path: 'file', message: 'Upload exactly one file in the "file" field' }]);
    default:
      return new HttpError(400, 'UPLOAD_ERROR', err.message);
  }
}

/** Prisma errors that have a well-defined HTTP meaning. Anything else is a 500. */
function fromPrisma(err: Prisma.PrismaClientKnownRequestError): HttpError | null {
  switch (err.code) {
    case 'P2002':
      return new HttpError(409, 'DUPLICATE', 'A record with the same unique value already exists');
    case 'P2025':
      return new HttpError(404, 'NOT_FOUND', 'Resource not found');
    case 'P2003':
      return new HttpError(409, 'REFERENCE_CONFLICT', 'This record is referenced by other data');
    case 'P2023':
      // Malformed id (e.g. a non-UUID in a UUID column). Nothing can exist under it: 404, never 500.
      return new HttpError(404, 'NOT_FOUND', 'Resource not found');
    case 'P2034':
      // Serialization failure / deadlock: the same request can be retried safely.
      return new HttpError(409, 'CONCURRENT_MODIFICATION', 'The record was modified by another request. Please retry.', undefined, true);
    default:
      return null;
  }
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const meta: ErrorMeta = { correlationId: req.correlationId };
  if (err instanceof multer.MulterError) err = fromMulter(err);
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = fromPrisma(err);
    if (mapped) err = mapped;
  }

  if (err instanceof HttpError) {
    if (err.retryable) meta.retryable = true;
    res.status(err.status).json(errorBody(err.code, err.message, err.details, meta));
    return;
  }

  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json(errorBody('INVALID_JSON', 'Request body is not valid JSON', undefined, meta));
    return;
  }

  if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.too.large') {
    res.status(413).json(errorBody('PAYLOAD_TOO_LARGE', 'Request body is too large', undefined, meta));
    return;
  }

  logger.error({ err, correlationId: req.correlationId }, 'Unhandled error');
  res.status(500).json(errorBody('INTERNAL_ERROR', 'Something went wrong. Please try again.', undefined, meta));
};
