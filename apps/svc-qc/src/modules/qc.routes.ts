import { Router, type Request } from 'express';
import { asyncHandler, authenticate, getContext, idempotent, parseQuery, requirePermission, requireTenant, requireUuidParams, validateBody, validateQuery, type Logger, type SqlClient, type TokenVerifier } from '@b2b/platform-kit';
import { QcService, actorFrom } from './qc.service.js';
import { checklistSchema, decideSchema, defectCodeSchema, lotListQuery, reasonSchema, resultsSchema, statusSchema } from './qc.schema.js';

export interface QcRouterDeps {
  service: QcService;
  verifier: TokenVerifier;
  db: SqlClient;
  logger: Logger;
}

export function createQcRouter({ service, verifier, db, logger }: QcRouterDeps) {
  const router = Router();
  router.use(authenticate({ verifier, types: ['tenant'] }), requireTenant);
  requireUuidParams(router, 'id');
  const ctx = (req: Request) => getContext(req);
  const actor = (req: Request) => actorFrom(getContext(req));
  const tenantOf = (req: Request) => getContext(req).tenantId!;
  const idem = (scope: string) => idempotent(scope, { db, logger, required: false });
  const view = requirePermission('qc.view', 'grn.view');
  const inspect = requirePermission('qc.inspect');
  const approve = requirePermission('qc.approve');
  const manage = requirePermission('qc.manage');

  router.get('/lots', view, validateQuery(lotListQuery), asyncHandler(async (req, res) => res.json({ data: await service.list(ctx(req), parseQuery<typeof lotListQuery>(res)) })));
  router.get('/lots/:id', view, asyncHandler(async (req, res) => res.json({ data: await service.get(ctx(req), req.params.id) })));
  router.post('/lots/:id/start', inspect, asyncHandler(async (req, res) => res.json({ data: await service.start(ctx(req), actor(req), req.params.id) })));
  router.put('/lots/:id/results', inspect, validateBody(resultsSchema), asyncHandler(async (req, res) => res.json({ data: await service.recordResults(ctx(req), actor(req), req.params.id, req.body) })));
  router.post('/lots/:id/decide', approve, validateBody(decideSchema), idem('POST /qc/lots/decide'), asyncHandler(async (req, res) => res.json({ data: await service.decide(ctx(req), actor(req), req.params.id, req.body) })));
  router.post('/lots/:id/reopen', approve, validateBody(reasonSchema), asyncHandler(async (req, res) => res.json({ data: await service.reopen(ctx(req), actor(req), req.params.id, req.body.reason ?? null) })));

  router.get('/checklists', view, asyncHandler(async (req, res) => res.json({ data: await service.listChecklists(tenantOf(req)) })));
  router.post('/checklists', manage, validateBody(checklistSchema), asyncHandler(async (req, res) => res.status(201).json({ data: await service.createChecklist(tenantOf(req), actor(req), req.body) })));
  router.post('/checklists/:id/status', manage, validateBody(statusSchema), asyncHandler(async (req, res) => res.json({ data: await service.setChecklistStatus(tenantOf(req), actor(req), req.params.id, req.body.status) })));
  router.get('/defect-codes', view, asyncHandler(async (req, res) => res.json({ data: await service.listDefectCodes(tenantOf(req)) })));
  router.post('/defect-codes', manage, validateBody(defectCodeSchema), asyncHandler(async (req, res) => res.status(201).json({ data: await service.upsertDefectCode(tenantOf(req), actor(req), req.body) })));
  router.post('/defect-codes/:code/status', manage, validateBody(statusSchema), asyncHandler(async (req, res) => res.json({ data: await service.setDefectCodeStatus(tenantOf(req), actor(req), String(req.params.code).toUpperCase(), req.body.status) })));
  return router;
}
