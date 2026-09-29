import { Router } from 'express';
import { gstinLookupQuerySchema } from '@b2b/shared';
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
