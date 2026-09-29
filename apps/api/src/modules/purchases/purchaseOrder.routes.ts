import { Router } from 'express';
import { paginationQuerySchema, purchaseOrderCancelSchema, purchaseOrderCreateQuerySchema, purchaseOrderListQuerySchema, purchaseOrderSchema } from '@b2b/shared';
import { asyncHandler, parseQuery, validateBody, validateQuery } from '../../lib/http.js';
import { badRequest } from '../../lib/errors.js';
import { documentUpload, requireUploadedFile } from '../../lib/upload.js';
import { getCtx, requireAuth, requireOrganization, requirePermission } from '../../middleware/auth.js';
import * as po from './purchaseOrder.service.js';
import * as docs from './purchaseOrderDocuments.service.js';

export const purchaseOrderRouter = Router();
purchaseOrderRouter.use(requireAuth, requireOrganization);

const pageQuery = paginationQuerySchema;
const createQuery = purchaseOrderCreateQuerySchema;

purchaseOrderRouter.get('/', requirePermission('purchase_order.view'), validateQuery(purchaseOrderListQuerySchema), asyncHandler(async (req, res) => {
  res.json(await po.listPurchaseOrders(getCtx(req).organizationId, parseQuery<typeof purchaseOrderListQuerySchema>(res)));
}));

purchaseOrderRouter.get('/next-number', requirePermission('purchase_order.create', 'purchase_order.edit'), asyncHandler(async (req, res) => {
  res.json({ data: await po.previewNextNumber(getCtx(req).organizationId) });
}));

purchaseOrderRouter.post('/', requirePermission('purchase_order.create'), validateQuery(createQuery), validateBody(purchaseOrderSchema), asyncHandler(async (req, res) => {
  const issue = parseQuery<typeof createQuery>(res).issue === 'true';
  // Issuing on create needs the issue permission too; otherwise the order is saved as a draft.
  if (issue && !getCtx(req).permissions.has('purchase_order.issue')) {
    throw badRequest('You can save this order as a draft, but issuing requires the "purchase_order.issue" permission', 'PERMISSION_DENIED');
  }
  res.status(201).json({ data: await po.createPurchaseOrder(getCtx(req), req.body, issue) });
}));

purchaseOrderRouter.get('/:id', requirePermission('purchase_order.view'), asyncHandler(async (req, res) => {
  res.json({ data: await po.getPurchaseOrder(getCtx(req).organizationId, req.params.id) });
}));

purchaseOrderRouter.put('/:id', requirePermission('purchase_order.edit'), validateBody(purchaseOrderSchema), asyncHandler(async (req, res) => {
  res.json({ data: await po.updatePurchaseOrder(getCtx(req), req.params.id, req.body) });
}));

purchaseOrderRouter.delete('/:id', requirePermission('purchase_order.delete'), asyncHandler(async (req, res) => {
  res.json({ data: await po.deletePurchaseOrder(getCtx(req), req.params.id) });
}));

purchaseOrderRouter.post('/:id/issue', requirePermission('purchase_order.issue'), asyncHandler(async (req, res) => {
  res.json({ data: await po.issuePurchaseOrder(getCtx(req), req.params.id) });
}));
purchaseOrderRouter.post('/:id/cancel', requirePermission('purchase_order.cancel'), validateBody(purchaseOrderCancelSchema), asyncHandler(async (req, res) => {
  res.json({ data: await po.cancelPurchaseOrder(getCtx(req), req.params.id, req.body.reason) });
}));
purchaseOrderRouter.post('/:id/close', requirePermission('purchase_order.issue'), asyncHandler(async (req, res) => {
  res.json({ data: await po.closePurchaseOrder(getCtx(req), req.params.id) });
}));
purchaseOrderRouter.post('/:id/reopen', requirePermission('purchase_order.issue'), asyncHandler(async (req, res) => {
  res.json({ data: await po.reopenPurchaseOrder(getCtx(req), req.params.id) });
}));

purchaseOrderRouter.get('/:id/activity', requirePermission('purchase_order.view'), validateQuery(pageQuery), asyncHandler(async (req, res) => {
  const q = parseQuery<typeof pageQuery>(res);
  res.json(await po.listPurchaseOrderActivity(getCtx(req).organizationId, req.params.id, q.page, q.limit));
}));

/* ---- attachments ------------------------------------------------------------ */

purchaseOrderRouter.get('/:id/documents', requirePermission('purchase_order.view'), asyncHandler(async (req, res) => {
  res.json({ data: await docs.listDocuments(getCtx(req).organizationId, req.params.id) });
}));
purchaseOrderRouter.post('/:id/documents', requirePermission('purchase_order.edit', 'purchase_order.create'), documentUpload.single('file'), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await docs.uploadDocument(getCtx(req), req.params.id, requireUploadedFile(req)) });
}));
purchaseOrderRouter.get('/:id/documents/:documentId/download', requirePermission('purchase_order.view'), asyncHandler(async (req, res) => {
  const { doc, absPath } = await docs.getDocumentFile(getCtx(req).organizationId, req.params.id, req.params.documentId);
  res.download(absPath, doc.fileName);
}));
purchaseOrderRouter.delete('/:id/documents/:documentId', requirePermission('purchase_order.edit'), asyncHandler(async (req, res) => {
  res.json({ data: await docs.removeDocument(getCtx(req), req.params.id, req.params.documentId) });
}));
