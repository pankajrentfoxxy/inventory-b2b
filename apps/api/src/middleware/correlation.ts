import type { RequestHandler } from 'express';
import { uuidv7 } from '../lib/ids.js';

export const CORRELATION_HEADER = 'x-correlation-id';

/**
 * Identity is never read from client headers (phase-plan/README.md 5.1 rule 1). The gateway strips
 * these before proxying; the API drops them again as defence in depth. `X-Organization-Id` is
 * deliberately not in this list: it selects a tenant and is verified against the caller's
 * membership in requireOrganization.
 */
export const IDENTITY_HEADERS = ['x-tenant-id', 'x-user-id', 'x-perms', 'x-membership-id', 'x-on-behalf-of-tenant'] as const;

const MAX_CORRELATION_ID_LENGTH = 128;

/** Accepts an inbound correlation id (from the gateway) or mints one, and echoes it on the response. */
export const correlationId: RequestHandler = (req, res, next) => {
  for (const header of IDENTITY_HEADERS) delete req.headers[header];
  const inbound = req.header(CORRELATION_HEADER)?.trim();
  const id = inbound && inbound.length <= MAX_CORRELATION_ID_LENGTH ? inbound : uuidv7();
  req.correlationId = id;
  res.setHeader(CORRELATION_HEADER, id);
  next();
};
