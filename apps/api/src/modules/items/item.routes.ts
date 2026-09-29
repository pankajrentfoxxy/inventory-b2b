import { Router } from 'express';
import { itemListQuerySchema, itemSchema, itemStatusSchema } from '@b2b/shared';
import { asyncHandler, parseQuery, validateBody, validateQuery } from '../../lib/http.js';
import { getCtx, requireAuth, requireOrganization, requirePermission } from '../../middleware/auth.js';
import * as items from './item.service.js';

export const itemRouter = Router();
itemRouter.use(requireAuth, requireOrganization);

// Purchase-order users need to search items even without the item module permission.
const canView = requirePermission('item.view', 'purchase_order.view', 'purchase_order.create', 'purchase_order.edit');

itemRouter.get('/', canView, validateQuery(itemListQuerySchema), asyncHandler(async (req, res) => {
  res.json(await items.listItems(getCtx(req).organizationId, parseQuery<typeof itemListQuerySchema>(res)));
}));

itemRouter.post('/', requirePermission('item.create'), validateBody(itemSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await items.createItem(getCtx(req), req.body) });
}));

itemRouter.get('/:id', canView, asyncHandler(async (req, res) => {
  res.json({ data: await items.getItem(getCtx(req).organizationId, req.params.id) });
}));

itemRouter.put('/:id', requirePermission('item.edit'), validateBody(itemSchema), asyncHandler(async (req, res) => {
  res.json({ data: await items.updateItem(getCtx(req), req.params.id, req.body) });
}));

itemRouter.patch('/:id/status', requirePermission('item.edit'), validateBody(itemStatusSchema), asyncHandler(async (req, res) => {
  res.json({ data: await items.setItemActive(getCtx(req), req.params.id, req.body.isActive) });
}));

itemRouter.delete('/:id', requirePermission('item.delete'), asyncHandler(async (req, res) => {
  res.json({ data: await items.deleteItem(getCtx(req), req.params.id) });
}));
