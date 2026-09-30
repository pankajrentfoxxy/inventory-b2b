import { Router } from 'express';
import { purchaseReceiveCancelSchema, purchaseReceiveListQuerySchema, purchaseReceiveSchema } from '@b2b/shared';
import { asyncHandler, parseQuery, requireUuidParams, validateBody, validateQuery } from '../../lib/http.js';
import { getIdempotencyKey, idempotent } from '../../lib/idempotency.js';
import { getCtx, requireAuth, requireOrganization, requirePermission } from '../../middleware/auth.js';
import * as receives from './purchaseReceive.service.js';

export const purchaseReceiveRouter = Router();
purchaseReceiveRouter.use(requireAuth, requireOrganization);
requireUuidParams(purchaseReceiveRouter, 'id');

purchaseReceiveRouter.get('/', requirePermission('purchase_receive.view'), validateQuery(purchaseReceiveListQuerySchema), asyncHandler(async (req, res) => {
  res.json(await receives.listReceives(getCtx(req).organizationId, parseQuery<typeof purchaseReceiveListQuerySchema>(res)));
}));

purchaseReceiveRouter.get('/next-number', requirePermission('purchase_receive.create'), asyncHandler(async (req, res) => {
  res.json({ data: await receives.previewNextNumber(getCtx(req).organizationId) });
}));

// Idempotency-Key is mandatory here (phase-plan/README.md 5.6): a double-click or a retried
// request must never record the goods twice. The middleware runs after validation so the stored
// request hash covers the normalised body.
purchaseReceiveRouter.post('/', requirePermission('purchase_receive.create'), validateBody(purchaseReceiveSchema), idempotent('POST /purchase-receives'), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await receives.createReceive(getCtx(req), req.body, getIdempotencyKey(res)) });
}));

purchaseReceiveRouter.get('/:id', requirePermission('purchase_receive.view'), asyncHandler(async (req, res) => {
  res.json({ data: await receives.getReceive(getCtx(req).organizationId, req.params.id) });
}));

purchaseReceiveRouter.post('/:id/cancel', requirePermission('purchase_receive.cancel'), validateBody(purchaseReceiveCancelSchema), asyncHandler(async (req, res) => {
  res.json({ data: await receives.cancelReceive(getCtx(req), req.params.id, req.body.reason) });
}));
