import type { RequestHandler } from 'express';
import { uuidv7 } from './ids.js';

export const CORRELATION_HEADER = 'x-correlation-id';

/** Identity is never read from client headers (README 5.1). Stripped at the gateway and again in every service. */
export const IDENTITY_HEADERS = ['x-tenant-id', 'x-user-id', 'x-perms', 'x-membership-id'] as const;

const MAX_CORRELATION_ID_LENGTH = 128;

declare module 'http' {
  interface IncomingMessage {
    correlationId?: string;
  }
}

export interface CorrelationOptions {
  /** Keep `x-on-behalf-of-tenant`: only services that accept service tokens set this to true. */
  allowOnBehalfOfTenant?: boolean;
}

export function correlation(options: CorrelationOptions = {}): RequestHandler {
  return (req, res, next) => {
    for (const header of IDENTITY_HEADERS) delete req.headers[header];
    if (!options.allowOnBehalfOfTenant) delete req.headers['x-on-behalf-of-tenant'];
    const inbound = req.header(CORRELATION_HEADER)?.trim();
    req.correlationId = inbound && inbound.length <= MAX_CORRELATION_ID_LENGTH ? inbound : uuidv7();
    res.setHeader(CORRELATION_HEADER, req.correlationId);
    next();
  };
}
