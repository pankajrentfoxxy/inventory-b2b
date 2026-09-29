import { Router } from 'express';
import {
  paginationQuerySchema,
  vendorAddressSchema,
  vendorBankAccountSchema,
  vendorContactSchema,
  vendorCreateSchema,
  vendorListQuerySchema,
  vendorNoteSchema,
  vendorStatusSchema,
  vendorUpdateSchema,
} from '@b2b/shared';
import { asyncHandler, parseQuery, validateBody, validateQuery } from '../../lib/http.js';
import { getCtx, requireAuth, requireOrganization, requirePermission } from '../../middleware/auth.js';
import { badRequest } from '../../lib/errors.js';
import { documentUpload, requireUploadedFile } from '../../lib/upload.js';
import * as vendors from './vendor.service.js';
import * as children from './vendorChildren.service.js';
import * as documents from './vendorDocuments.service.js';

export const vendorRouter = Router();

// Every vendor route is tenant-scoped: bearer token + X-Organization-Id membership check.
vendorRouter.use(requireAuth, requireOrganization);

const pageQuery = paginationQuerySchema;

/* ---- collection ---------------------------------------------------------- */

vendorRouter.get(
  '/',
  requirePermission('vendor.view'),
  validateQuery(vendorListQuerySchema),
  asyncHandler(async (req, res) => {
    res.json(await vendors.listVendors(getCtx(req).organizationId, parseQuery<typeof vendorListQuerySchema>(res)));
  }),
);

vendorRouter.post(
  '/',
  requirePermission('vendor.create'),
  validateBody(vendorCreateSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ data: await vendors.createVendor(getCtx(req), req.body) });
  }),
);

/* ---- single vendor ------------------------------------------------------- */

vendorRouter.get(
  '/:id',
  requirePermission('vendor.view'),
  asyncHandler(async (req, res) => {
    res.json({ data: await vendors.getVendor(getCtx(req).organizationId, req.params.id) });
  }),
);

vendorRouter.put(
  '/:id',
  requirePermission('vendor.edit'),
  validateBody(vendorUpdateSchema),
  asyncHandler(async (req, res) => {
    res.json({ data: await vendors.updateVendor(getCtx(req), req.params.id, req.body) });
  }),
);

vendorRouter.patch(
  '/:id/status',
  requirePermission('vendor.status_update'),
  validateBody(vendorStatusSchema),
  asyncHandler(async (req, res) => {
    res.json({ data: await vendors.updateVendorStatus(getCtx(req), req.params.id, req.body.status, req.body.reason) });
  }),
);

vendorRouter.delete(
  '/:id',
  requirePermission('vendor.delete'),
  asyncHandler(async (req, res) => {
    res.json({ data: await vendors.deleteVendor(getCtx(req), req.params.id) });
  }),
);

vendorRouter.get(
  '/:id/activity',
  requirePermission('vendor.view'),
  validateQuery(pageQuery),
  asyncHandler(async (req, res) => {
    const q = parseQuery<typeof pageQuery>(res);
    res.json(await vendors.listVendorActivity(getCtx(req).organizationId, req.params.id, q.page, q.limit));
  }),
);

vendorRouter.get(
  '/:id/transactions',
  requirePermission('vendor.view'),
  asyncHandler(async (req, res) => {
    res.json({ data: await vendors.getVendorTransactions(getCtx(req).organizationId, req.params.id) });
  }),
);

/* ---- contacts ------------------------------------------------------------ */

vendorRouter.post(
  '/:id/contacts',
  requirePermission('vendor.edit'),
  validateBody(vendorContactSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ data: await children.addContact(getCtx(req), req.params.id, req.body) });
  }),
);
vendorRouter.put(
  '/:id/contacts/:contactId',
  requirePermission('vendor.edit'),
  validateBody(vendorContactSchema),
  asyncHandler(async (req, res) => {
    res.json({ data: await children.updateContact(getCtx(req), req.params.id, req.params.contactId, req.body) });
  }),
);
vendorRouter.delete(
  '/:id/contacts/:contactId',
  requirePermission('vendor.edit'),
  asyncHandler(async (req, res) => {
    res.json({ data: await children.removeContact(getCtx(req), req.params.id, req.params.contactId) });
  }),
);

/* ---- addresses ----------------------------------------------------------- */

vendorRouter.post(
  '/:id/addresses',
  requirePermission('vendor.edit'),
  validateBody(vendorAddressSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ data: await children.addAddress(getCtx(req), req.params.id, req.body) });
  }),
);
vendorRouter.put(
  '/:id/addresses/:addressId',
  requirePermission('vendor.edit'),
  validateBody(vendorAddressSchema),
  asyncHandler(async (req, res) => {
    res.json({ data: await children.updateAddress(getCtx(req), req.params.id, req.params.addressId, req.body) });
  }),
);
vendorRouter.delete(
  '/:id/addresses/:addressId',
  requirePermission('vendor.edit'),
  asyncHandler(async (req, res) => {
    res.json({ data: await children.removeAddress(getCtx(req), req.params.id, req.params.addressId) });
  }),
);

/* ---- bank accounts ------------------------------------------------------- */

vendorRouter.post(
  '/:id/bank-accounts',
  requirePermission('vendor.edit'),
  validateBody(vendorBankAccountSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ data: await children.addBankAccount(getCtx(req), req.params.id, req.body) });
  }),
);
vendorRouter.put(
  '/:id/bank-accounts/:accountId',
  requirePermission('vendor.edit'),
  validateBody(vendorBankAccountSchema),
  asyncHandler(async (req, res) => {
    res.json({ data: await children.updateBankAccount(getCtx(req), req.params.id, req.params.accountId, req.body) });
  }),
);
vendorRouter.delete(
  '/:id/bank-accounts/:accountId',
  requirePermission('vendor.edit'),
  asyncHandler(async (req, res) => {
    res.json({ data: await children.removeBankAccount(getCtx(req), req.params.id, req.params.accountId) });
  }),
);
vendorRouter.get(
  '/:id/bank-accounts/:accountId/reveal',
  requirePermission('vendor.bank_details_view'),
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ data: await children.revealBankAccount(getCtx(req), req.params.id, req.params.accountId) });
  }),
);

/* ---- notes ---------------------------------------------------------------- */

vendorRouter.get(
  '/:id/notes',
  requirePermission('vendor.view'),
  asyncHandler(async (req, res) => {
    res.json({ data: await children.listNotes(getCtx(req).organizationId, req.params.id) });
  }),
);
vendorRouter.post(
  '/:id/notes',
  requirePermission('vendor.edit'),
  validateBody(vendorNoteSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ data: await children.addNote(getCtx(req), req.params.id, req.body.body) });
  }),
);
vendorRouter.delete(
  '/:id/notes/:noteId',
  requirePermission('vendor.edit'),
  asyncHandler(async (req, res) => {
    res.json({ data: await children.removeNote(getCtx(req), req.params.id, req.params.noteId) });
  }),
);

/* ---- documents ------------------------------------------------------------ */

vendorRouter.get(
  '/:id/documents',
  requirePermission('vendor.view'),
  asyncHandler(async (req, res) => {
    res.json({ data: await documents.listDocuments(getCtx(req).organizationId, req.params.id) });
  }),
);
vendorRouter.post(
  '/:id/documents',
  requirePermission('vendor.edit'),
  documentUpload.single('file'),
  asyncHandler(async (req, res) => {
    res.status(201).json({ data: await documents.uploadDocument(getCtx(req), req.params.id, requireUploadedFile(req)) });
  }),
);
vendorRouter.get(
  '/:id/documents/:documentId/download',
  requirePermission('vendor.view'),
  asyncHandler(async (req, res) => {
    const { doc, absPath } = await documents.getDocumentFile(getCtx(req).organizationId, req.params.id, req.params.documentId);
    res.download(absPath, doc.fileName);
  }),
);
vendorRouter.delete(
  '/:id/documents/:documentId',
  requirePermission('vendor.edit'),
  asyncHandler(async (req, res) => {
    res.json({ data: await documents.removeDocument(getCtx(req), req.params.id, req.params.documentId) });
  }),
);
