import { Router, type Request } from 'express';
import { asyncHandler, authenticate, getContext, idempotent, parseQuery, requirePermission, requireService, requireTenant, requireUuidParams, validateBody, validateQuery, type Logger, type SqlClient, type TokenVerifier } from '@b2b/platform-kit';
import { InventoryService, actorFrom } from './inventory.service.js';
import { adjustmentListQuery, adjustmentSchema, availabilityQuery, binMoveSchema, internalPostingSchema, ledgerQuery, openingImportSchema, openingStockSchema, reasonSchema, serialsCheckSchema, serialsQuery, settingsSchema, stockQuery } from './inventory.schema.js';

export interface InventoryRouterDeps {
  service: InventoryService;
  verifier: TokenVerifier;
  db: SqlClient;
  logger: Logger;
}

export function createInventoryRouter({ service, verifier, db, logger }: InventoryRouterDeps) {
  const router = Router();
  router.use(authenticate({ verifier, types: ['tenant'] }), requireTenant);
  requireUuidParams(router, 'id', 'itemId');
  const ctx = (req: Request) => getContext(req);
  const actor = (req: Request) => actorFrom(getContext(req));
  const idem = (scope: string, required = true) => idempotent(scope, { db, logger, required });
  const view = requirePermission('inventory.view');
  const adjust = requirePermission('inventory.adjust');
  const approve = requirePermission('inventory.adjust.approve');

  router.get('/stock', view, validateQuery(stockQuery), asyncHandler(async (req, res) => res.json({ data: await service.stock(ctx(req), parseQuery<typeof stockQuery>(res)) })));
  router.get('/stock/:itemId', view, asyncHandler(async (req, res) => res.json({ data: await service.stockByItem(ctx(req), req.params.itemId) })));
  router.get('/ledger', view, validateQuery(ledgerQuery), asyncHandler(async (req, res) => res.json({ data: await service.ledger(ctx(req), parseQuery<typeof ledgerQuery>(res)) })));
  router.get('/serials', view, validateQuery(serialsQuery), asyncHandler(async (req, res) => res.json({ data: await service.serials(ctx(req), parseQuery<typeof serialsQuery>(res)) })));
  router.get('/serials/:id', view, asyncHandler(async (req, res) => res.json({ data: await service.serial(ctx(req), req.params.id) })));
  router.get('/serials/:id/history', view, asyncHandler(async (req, res) => res.json({ data: await service.serialHistory(ctx(req), req.params.id) })));

  router.post('/opening-stock', adjust, validateBody(openingStockSchema), idem('POST /inventory/opening-stock'), asyncHandler(async (req, res) => res.status(201).json({ data: await service.openingStock(ctx(req), actor(req), req.body) })));
  router.post('/opening-stock/import', adjust, validateBody(openingImportSchema), idem('POST /inventory/opening-stock/import', false), asyncHandler(async (req, res) => res.json({ data: await service.importOpeningStock(ctx(req), actor(req), req.body.rows) })));

  router.get('/adjustments', view, validateQuery(adjustmentListQuery), asyncHandler(async (req, res) => res.json({ data: await service.listAdjustments(ctx(req), parseQuery<typeof adjustmentListQuery>(res)) })));
  router.post('/adjustments', adjust, validateBody(adjustmentSchema), idem('POST /inventory/adjustments', false), asyncHandler(async (req, res) => res.status(201).json({ data: await service.createAdjustment(ctx(req), actor(req), req.body) })));
  router.get('/adjustments/:id', view, asyncHandler(async (req, res) => res.json({ data: await service.getAdjustment(ctx(req), req.params.id) })));
  router.post('/adjustments/:id/submit', adjust, idem('POST /inventory/adjustments/submit', false), asyncHandler(async (req, res) => res.json({ data: await service.submitAdjustment(ctx(req), actor(req), req.params.id) })));
  router.post('/adjustments/:id/approve', approve, idem('POST /inventory/adjustments/approve', false), asyncHandler(async (req, res) => res.json({ data: await service.approveAdjustment(ctx(req), actor(req), req.params.id) })));
  router.post('/adjustments/:id/cancel', adjust, validateBody(reasonSchema), asyncHandler(async (req, res) => res.json({ data: await service.cancelAdjustment(ctx(req), actor(req), req.params.id, req.body.reason ?? null) })));

  router.post('/bin-moves', requirePermission('inventory.transfer'), validateBody(binMoveSchema), idem('POST /inventory/bin-moves'), asyncHandler(async (req, res) => res.status(201).json({ data: await service.binMove(ctx(req), actor(req), req.body) })));

  router.get('/reconciliation', approve, asyncHandler(async (req, res) => res.json({ data: await service.reconciliation(ctx(req).tenantId!) })));
  router.get('/settings', view, asyncHandler(async (req, res) => res.json({ data: await service.getSettings(ctx(req).tenantId!) })));
  router.put('/settings', approve, validateBody(settingsSchema), asyncHandler(async (req, res) => res.json({ data: await service.updateSettings(ctx(req).tenantId!, actor(req), req.body) })));
  return router;
}

export function createInternalInventoryRouter({ service, verifier }: InventoryRouterDeps) {
  const router = Router();
  router.use(authenticate({ verifier, types: ['service'], serviceName: 'svc-inventory' }), requireService());
  requireUuidParams(router, 'id');
  const tenantOf = (req: Request) => {
    const t = getContext(req).tenantId;
    if (!t) throw new Error('x-on-behalf-of-tenant required');
    return t;
  };
  const caller = (req: Request) => getContext(req).serviceName ?? 'unknown';

  router.post('/postings', validateBody(internalPostingSchema), asyncHandler(async (req, res) => {
    const c = getContext(req);
    const body = req.body as typeof internalPostingSchema._output;
    const result = await service.postFromService(tenantOf(req), caller(req), { ...body, actorId: body.actorId, correlationId: c.correlationId, lines: body.lines, serials: body.serials });
    res.status(result.replayed ? 200 : 201).json({ data: result });
  }));
  router.get('/items/:id/has-movements', asyncHandler(async (req, res) => res.json({ data: { itemId: req.params.id, hasMovements: await service.hasMovements(tenantOf(req), req.params.id) } })));
  router.post(['/serials:check', '/serials/check'], validateBody(serialsCheckSchema), asyncHandler(async (req, res) => res.json({ data: await service.serialsCheck(tenantOf(req), req.body.itemId, req.body.serials) })));
  router.get('/availability', validateQuery(availabilityQuery), asyncHandler(async (req, res) => {
    const q = parseQuery<typeof availabilityQuery>(res);
    const ids = q.itemIds.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200);
    res.json({ data: await service.availability(tenantOf(req), ids, q.warehouseId ?? null) });
  }));
  router.get('/reconciliation/report', asyncHandler(async (req, res) => res.json({ data: await service.reconciliation(tenantOf(req)) })));
  return router;
}
