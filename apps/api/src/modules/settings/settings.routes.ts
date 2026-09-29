import { Router } from 'express';
import { z } from 'zod';
import {
  CUSTOM_FIELD_ENTITIES,
  DOCUMENT_TYPES,
  customFieldDefinitionSchema,
  documentSequenceSchema,
  documentTypeParamSchema,
  gstTreatmentSchema,
  locationSchema,
  paymentTermSchema,
  reportingTagSchema,
  taxSchema,
} from '@b2b/shared';
import { asyncHandler, parseParams, parseQuery, validateBody, validateParams, validateQuery } from '../../lib/http.js';
import { getCtx, requireAuth, requireOrganization, requirePermission } from '../../middleware/auth.js';
import * as settings from './settings.service.js';
import * as masters from './purchaseMasters.service.js';
import { getSequence, updateSequence } from '../purchases/documentNumber.service.js';

export const settingsRouter = Router();
settingsRouter.use(requireAuth, requireOrganization);

const canView = requirePermission('vendor.view', 'purchase_order.view', 'item.view', 'settings.view', 'settings.manage');
const canManage = requirePermission('settings.manage');

/** One round-trip bundle of everything the vendor form needs. */
settingsRouter.get('/vendor-form-options', canView, asyncHandler(async (req, res) => {
  res.json({ data: await settings.getVendorFormOptions(getCtx(req).organizationId) });
}));

/** Everything the purchase order form needs (locations, taxes, terms, custom fields, next number). */
settingsRouter.get('/purchase-order-form-options', canView, asyncHandler(async (req, res) => {
  res.json({ data: await masters.getPurchaseOrderFormOptions(getCtx(req).organizationId) });
}));

/* ---- custom fields ---------------------------------------------------------- */

const entityQuery = z.object({ entityType: z.enum(CUSTOM_FIELD_ENTITIES).default('VENDOR') });

settingsRouter.get('/custom-fields', canView, validateQuery(entityQuery), asyncHandler(async (req, res) => {
  res.json({ data: await settings.listCustomFields(getCtx(req).organizationId, parseQuery<typeof entityQuery>(res).entityType) });
}));
settingsRouter.post('/custom-fields', canManage, validateBody(customFieldDefinitionSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await settings.createCustomField(getCtx(req).organizationId, req.body) });
}));
settingsRouter.patch('/custom-fields/:id', canManage, validateBody(customFieldDefinitionSchema.innerType().partial()), asyncHandler(async (req, res) => {
  res.json({ data: await settings.updateCustomField(getCtx(req).organizationId, req.params.id, req.body) });
}));

/* ---- reporting tags --------------------------------------------------------- */

settingsRouter.get('/reporting-tags', canView, asyncHandler(async (req, res) => {
  res.json({ data: await settings.listReportingTags(getCtx(req).organizationId) });
}));
settingsRouter.post('/reporting-tags', canManage, validateBody(reportingTagSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await settings.createReportingTag(getCtx(req).organizationId, req.body) });
}));
settingsRouter.patch('/reporting-tags/:id', canManage, validateBody(reportingTagSchema.partial()), asyncHandler(async (req, res) => {
  res.json({ data: await settings.updateReportingTag(getCtx(req).organizationId, req.params.id, req.body) });
}));

/* ---- GST treatments & payment terms ------------------------------------------ */

settingsRouter.get('/gst-treatments', canView, asyncHandler(async (req, res) => {
  res.json({ data: await settings.listGstTreatments(getCtx(req).organizationId) });
}));
settingsRouter.post('/gst-treatments', canManage, validateBody(gstTreatmentSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await settings.createGstTreatment(getCtx(req).organizationId, req.body) });
}));
settingsRouter.patch('/gst-treatments/:id', canManage, validateBody(gstTreatmentSchema.partial()), asyncHandler(async (req, res) => {
  res.json({ data: await settings.updateGstTreatment(getCtx(req).organizationId, req.params.id, req.body) });
}));

settingsRouter.get('/payment-terms', canView, asyncHandler(async (req, res) => {
  res.json({ data: await settings.listPaymentTerms(getCtx(req).organizationId) });
}));
settingsRouter.post('/payment-terms', canManage, validateBody(paymentTermSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await settings.createPaymentTerm(getCtx(req).organizationId, req.body) });
}));
settingsRouter.patch('/payment-terms/:id', canManage, validateBody(paymentTermSchema.partial()), asyncHandler(async (req, res) => {
  res.json({ data: await settings.updatePaymentTerm(getCtx(req).organizationId, req.params.id, req.body) });
}));

/* ---- locations, taxes, numbering ---------------------------------------------- */

settingsRouter.get('/locations', canView, asyncHandler(async (req, res) => {
  res.json({ data: await masters.listLocations(getCtx(req).organizationId) });
}));
settingsRouter.post('/locations', canManage, validateBody(locationSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await masters.createLocation(getCtx(req).organizationId, req.body) });
}));
settingsRouter.patch('/locations/:id', canManage, validateBody(locationSchema.innerType().partial()), asyncHandler(async (req, res) => {
  res.json({ data: await masters.updateLocation(getCtx(req).organizationId, req.params.id, req.body) });
}));

settingsRouter.get('/taxes', canView, asyncHandler(async (req, res) => {
  res.json({ data: await masters.listTaxes(getCtx(req).organizationId) });
}));
settingsRouter.post('/taxes', canManage, validateBody(taxSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await masters.createTax(getCtx(req).organizationId, req.body) });
}));
settingsRouter.patch('/taxes/:id', canManage, validateBody(taxSchema.partial()), asyncHandler(async (req, res) => {
  res.json({ data: await masters.updateTax(getCtx(req).organizationId, req.params.id, req.body) });
}));

settingsRouter.get('/document-sequences', canView, asyncHandler(async (req, res) => {
  const orgId = getCtx(req).organizationId;
  res.json({ data: await Promise.all(DOCUMENT_TYPES.map((t) => getSequence(orgId, t))) });
}));
settingsRouter.put('/document-sequences/:docType', canManage, validateParams(documentTypeParamSchema), validateBody(documentSequenceSchema), asyncHandler(async (req, res) => {
  const { docType } = parseParams<typeof documentTypeParamSchema>(res);
  res.json({ data: await updateSequence(getCtx(req).organizationId, docType, req.body) });
}));
