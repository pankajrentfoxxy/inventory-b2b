import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { gstinLookupQuerySchema } from '@b2b/shared';
import { env } from '../../config/env.js';
import { errorBody } from '../../lib/errors.js';
import { asyncHandler, parseQuery, validateQuery } from '../../lib/http.js';
import { requireAuth, requireOrganization, requirePermission } from '../../middleware/auth.js';
import { getGstProvider } from './gst.service.js';

export const integrationsRouter = Router();
integrationsRouter.use(requireAuth, requireOrganization);

const gstQuery = gstinLookupQuerySchema;

integrationsRouter.get(
  '/gst/lookup',
  requirePermission('vendor.create', 'vendor.edit'),
  validateQuery(gstQuery),
  asyncHandler(async (_req, res) => {
    const { gstin } = parseQuery<typeof gstQuery>(res);
    res.json({ data: await getGstProvider().lookup(gstin) });
  }),
);

/**
 * Public GSTIN prefill for the vendor application form (/apply has no token yet). GST registration
 * data is public information, but the upstream provider is metered, so the route is rate limited per
 * client and accepts only a well-formed GSTIN (checksum included) before calling out.
 */
export const publicIntegrationsRouter = Router();

const publicGstLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 10_000 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: errorBody('RATE_LIMITED', 'Too many GST lookups. Try again in a few minutes.'),
});

publicIntegrationsRouter.get(
  '/gst/lookup',
  publicGstLimiter,
  validateQuery(gstQuery),
  asyncHandler(async (_req, res) => {
    const { gstin } = parseQuery<typeof gstQuery>(res);
    res.json({ data: await getGstProvider().lookup(gstin) });
  }),
);
