import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler, authenticate, getContext, idempotent, ifMatchVersion, parseQuery, requirePermission, requireService, requireTenant, requireUuidParams, validateBody, validateQuery, type Logger, type SqlClient, type TokenVerifier } from '@b2b/platform-kit';
import { MasterService, actorFrom, type SimpleModel } from './master.service.js';
import { laptopPatchSchema, laptopSchema, laptopSpecIdsSchema, specOptionListQuery, specOptionSchema, specOptionStatusSchema, binSchema, brandSchema, categorySchema, customFieldSchema, docTypeParam, gradeSchema, hsnSchema, importSchema, locationSchema, numberingSchema, paymentTermSchema, productListQuery, productPatchSchema, productSchema, statusChangeSchema, taxRateSchema, unitSchema, warehousePatchSchema, warehouseSchema, warrantySchema } from './master.schema.js';

export interface MasterRouterDeps {
  service: MasterService;
  verifier: TokenVerifier;
  db: SqlClient;
  logger: Logger;
}

const lookupQuery = z.object({ q: z.string().trim().max(100).optional(), status: z.enum(['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(), trackInventory: z.enum(['true', 'false']).optional(), laptop: z.enum(['true', 'false']).optional() });
const statusBody = z.object({ status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']) });
const whStatusBody = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) });
const includeInactive = z.object({ includeInactive: z.enum(['true', 'false']).optional() });

export function createMasterRouter({ service, verifier, db, logger }: MasterRouterDeps) {
  const router = Router();
  router.use(authenticate({ verifier, types: ['tenant'] }), requireTenant);
  requireUuidParams(router, 'id', 'warehouseId', 'locationId');
  const tenantOf = (req: Request) => getContext(req).tenantId!;
  const actor = (req: Request) => actorFrom(getContext(req));
  const idem = (scope: string) => idempotent(scope, { db, logger, required: false });
  const view = requirePermission('master.view', 'purchase.view', 'sales.view', 'inventory.view');
  const manage = requirePermission('master.manage');
  // Simple masters (payment terms, custom fields, units, tax...) also feed the vendor / customer form.
  const simpleView = requirePermission('master.view', 'purchase.view', 'sales.view', 'inventory.view', 'supplier.view', 'customer.view');

  // products
  router.get('/products', view, validateQuery(productListQuery), asyncHandler(async (req, res) => res.json(await service.listProducts(tenantOf(req), parseQuery<typeof productListQuery>(res)))));
  router.get('/lookups/products', view, validateQuery(lookupQuery), asyncHandler(async (req, res) => res.json({ data: await service.lookupProducts(tenantOf(req), parseQuery<typeof lookupQuery>(res)) })));
  router.post('/products', manage, validateBody(productSchema), idem('POST /master/products'), asyncHandler(async (req, res) => res.status(201).json({ data: await service.createProduct(tenantOf(req), actor(req), req.body) })));
  router.post('/products/import', manage, validateBody(importSchema), asyncHandler(async (req, res) => res.json({ data: await service.importProducts(tenantOf(req), actor(req), req.body.rows, req.body.activate) })));
  router.get('/products/:id', view, asyncHandler(async (req, res) => res.json({ data: await service.getProduct(tenantOf(req), req.params.id) })));
  router.patch('/products/:id', manage, validateBody(productPatchSchema), asyncHandler(async (req, res) => res.json({ data: await service.patchProduct(tenantOf(req), actor(req), req.params.id, req.body, ifMatchVersion(req)) })));
  for (const command of ['activate', 'deactivate', 'archive'] as const) {
    router.post(`/products/:id/${command}`, manage, validateBody(statusChangeSchema), asyncHandler(async (req, res) => res.json({ data: await service.transitionProduct(tenantOf(req), actor(req), req.params.id, command, req.body.reason ?? null) })));
  }
  router.delete('/products/:id', manage, asyncHandler(async (req, res) => res.json({ data: await service.deleteProduct(tenantOf(req), actor(req), req.params.id) })));

  // laptop specification masters and laptop configurations
  router.get('/laptop-specs', view, validateQuery(specOptionListQuery), asyncHandler(async (req, res) => res.json({ data: await service.listSpecOptions(tenantOf(req), parseQuery<typeof specOptionListQuery>(res)) })));
  router.post('/laptop-specs', manage, validateBody(specOptionSchema), asyncHandler(async (req, res) => res.status(201).json({ data: await service.createSpecOption(tenantOf(req), actor(req), req.body) })));
  router.post('/laptop-specs/:id/status', manage, validateBody(specOptionStatusSchema), asyncHandler(async (req, res) => res.json({ data: await service.setSpecOptionStatus(tenantOf(req), actor(req), req.params.id, req.body.status) })));
  router.post('/laptops/preview', view, validateBody(laptopSpecIdsSchema), asyncHandler(async (req, res) => res.json({ data: await service.previewLaptop(tenantOf(req), req.body) })));
  router.post('/laptops', manage, validateBody(laptopSchema), idem('POST /master/laptops'), asyncHandler(async (req, res) => res.status(201).json({ data: await service.createLaptop(tenantOf(req), actor(req), req.body) })));
  router.patch('/laptops/:id', manage, validateBody(laptopPatchSchema), asyncHandler(async (req, res) => res.json({ data: await service.patchLaptop(tenantOf(req), actor(req), req.params.id, req.body, ifMatchVersion(req)) })));

  // warehouses -> locations -> bins
  const whView = requirePermission('warehouse.view', 'master.view', 'inventory.view', 'grn.view');
  const whManage = requirePermission('warehouse.manage');
  router.get('/warehouses', whView, asyncHandler(async (req, res) => res.json({ data: await service.listWarehouses(getContext(req)) })));
  router.post('/warehouses', whManage, validateBody(warehouseSchema), asyncHandler(async (req, res) => res.status(201).json({ data: await service.createWarehouse(tenantOf(req), actor(req), req.body) })));
  router.get('/warehouses/:id', whView, asyncHandler(async (req, res) => res.json({ data: await service.getWarehouse(getContext(req), req.params.id) })));
  router.patch('/warehouses/:id', whManage, validateBody(warehousePatchSchema), asyncHandler(async (req, res) => res.json({ data: await service.patchWarehouse(tenantOf(req), actor(req), req.params.id, req.body, ifMatchVersion(req)) })));
  router.post('/warehouses/:id/status', whManage, validateBody(whStatusBody), asyncHandler(async (req, res) => res.json({ data: await service.setWarehouseStatus(tenantOf(req), actor(req), req.params.id, req.body.status) })));
  router.post('/warehouses/:warehouseId/locations', whManage, validateBody(locationSchema), asyncHandler(async (req, res) => res.status(201).json({ data: await service.createLocation(tenantOf(req), actor(req), req.params.warehouseId, req.body) })));
  router.post('/locations/:locationId/bins', whManage, validateBody(binSchema), asyncHandler(async (req, res) => res.status(201).json({ data: await service.createBin(tenantOf(req), actor(req), req.params.locationId, req.body) })));
  router.post('/bins/:id/status', whManage, validateBody(whStatusBody), asyncHandler(async (req, res) => res.json({ data: await service.setBinStatus(tenantOf(req), actor(req), req.params.id, req.body.status) })));

  // simple masters
  const simple: { path: string; model: SimpleModel; schema: z.ZodTypeAny }[] = [
    { path: 'units', model: 'unit', schema: unitSchema },
    { path: 'tax-rates', model: 'taxRate', schema: taxRateSchema },
    { path: 'hsn-codes', model: 'hsnCode', schema: hsnSchema },
    { path: 'categories', model: 'category', schema: categorySchema },
    { path: 'brands', model: 'brand', schema: brandSchema },
    { path: 'condition-grades', model: 'conditionGrade', schema: gradeSchema },
    { path: 'warranty-policies', model: 'warrantyPolicy', schema: warrantySchema },
    { path: 'payment-terms', model: 'paymentTerm', schema: paymentTermSchema },
    { path: 'custom-fields', model: 'customFieldDef', schema: customFieldSchema },
  ];
  for (const s of simple) {
    router.get(`/${s.path}`, simpleView, validateQuery(includeInactive), asyncHandler(async (req, res) => res.json({ data: await service.simpleList(tenantOf(req), s.model, parseQuery<typeof includeInactive>(res).includeInactive === 'true') })));
    router.post(`/${s.path}`, manage, validateBody(s.schema), asyncHandler(async (req, res) => res.status(201).json({ data: await service.simpleCreate(tenantOf(req), actor(req), s.model, req.body) })));
    router.post(`/${s.path}/:id/status`, manage, validateBody(statusBody), asyncHandler(async (req, res) => res.json({ data: await service.simpleSetStatus(tenantOf(req), actor(req), s.model, req.params.id, req.body.status) })));
  }

  // numbering
  router.get('/settings/numbering', requirePermission('settings.manage', 'master.view'), asyncHandler(async (req, res) => res.json({ data: await service.listNumbering(tenantOf(req)) })));
  router.put('/settings/numbering/:docType', requirePermission('settings.manage'), validateBody(numberingSchema), asyncHandler(async (req, res) => {
    const docType = docTypeParam.safeParse(req.params.docType);
    if (!docType.success) {
      res.status(404).json({ success: false, message: 'Unknown document type', error: { code: 'NOT_FOUND', message: 'Unknown document type', correlationId: req.correlationId } });
      return;
    }
    res.json({ data: await service.setNumbering(tenantOf(req), actor(req), docType.data, req.body) });
  }));
  return router;
}

export function createInternalMasterRouter({ service, verifier }: MasterRouterDeps) {
  const router = Router();
  router.use(authenticate({ verifier, types: ['service'], serviceName: 'svc-master' }), requireService());
  requireUuidParams(router, 'id');
  const tenantOf = (req: Request) => {
    const t = getContext(req).tenantId;
    if (!t) throw new Error('x-on-behalf-of-tenant required');
    return t;
  };
  router.get('/products:batch', asyncHandler(async (req, res) => {
    const ids = String(req.query.ids ?? '').split(',').filter(Boolean);
    res.json({ data: await service.productsBatch(tenantOf(req), ids.slice(0, 200)) });
  }));
  router.get('/warehouses:batch', asyncHandler(async (req, res) => {
    const ids = String(req.query.ids ?? '').split(',').filter(Boolean);
    res.json({ data: await service.warehousesBatch(tenantOf(req), ids.slice(0, 200)) });
  }));
  router.get('/numbering/:docType', asyncHandler(async (req, res) => {
    const rows = await service.listNumbering(tenantOf(req));
    const row = rows.find((r) => r.docType === req.params.docType);
    if (!row) {
      res.status(404).json({ success: false, message: 'Not found', error: { code: 'NOT_FOUND', message: 'Not found', correlationId: req.correlationId } });
      return;
    }
    res.json({ data: row });
  }));
  return router;
}
