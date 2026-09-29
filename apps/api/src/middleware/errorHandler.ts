import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import multer from 'multer';
import { MESSAGES, UPLOAD_MAX_MB } from '@b2b/shared';
import { env } from '../config/env.js';
import { HttpError, errorBody } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json(errorBody('ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`));
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

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof multer.MulterError) err = fromMulter(err);

  if (err instanceof HttpError) {
    res.status(err.status).json(errorBody(err.code, err.message, err.details));
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json(errorBody('DUPLICATE', 'A record with the same unique value already exists'));
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json(errorBody('NOT_FOUND', 'Resource not found'));
      return;
    }
    if (err.code === 'P2003') {
      res.status(409).json(errorBody('REFERENCE_CONFLICT', 'This record is referenced by other data'));
      return;
    }
  }

  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json(errorBody('INVALID_JSON', 'Request body is not valid JSON'));
    return;
  }

  if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.too.large') {
    res.status(413).json(errorBody('PAYLOAD_TOO_LARGE', 'Request body is too large'));
    return;
  }

  logger.error({ err }, 'Unhandled error');
  res.status(500).json(errorBody('INTERNAL_ERROR', 'Something went wrong. Please try again.'));
};
