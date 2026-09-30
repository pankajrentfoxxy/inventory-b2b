import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler, authenticate, getContext, getIdempotencyKey, idempotent, ifMatchVersion, parseQuery, requirePermission, requireTenant, requireUuidParams, validateBody, validateQuery, type Logger, type SqlClient, type TokenVerifier } from '@b2b/platform-kit';
import { ProcurementService, actorFrom } from './procurement.service.js';
import { commentSchema, grnListQuery, grnSchema, poListQuery, poPatchSchema, poSchema, presignSchema, reasonSchema, receiveQuery, requiredReasonSchema, reviseSchema, settingsSchema } from './procurement.schema.js';

export interface ProcurementRouterDeps {
  service: ProcurementService;
  verifier: TokenVerifier;
  db: SqlClient;
  logger: Logger;
}

const retrySchema = z.object({ serials: z.record(z.string().uuid(), z.array(z.object({ serialNo: z.string().trim().min(1).max(80), imei: z.string().trim().max(20).nullish().transform((v) => v || null) }))).optional() });
const attachmentsQuery = z.object({ entityType: z.enum(['PO', 'GRN']), entityId: z.string().uuid() });

export function createProcurementRouter({ service, verifier, db, logger }: ProcurementRouterDeps) {
  const router = Router();
  router.use(authenticate({ verifier, types: ['tenant'] }), requireTenant);
  requireUuidParams(router, 'id');
  const ctx = (req: Request) => getContext(req);
  const actor = (req: Request) => actorFrom(getContext(req));
  const idem = (scope: string, required = false) => idempotent(scope, { db, logger, required });
  const poView = requirePermission('purchase.view');

  router.get('/purchase-orders', poView, validateQuery(poListQuery), asyncHandler(async (req, res) => res.json({ data: await service.list(ctx(req), parseQuery<typeof poListQuery>(res)) })));
  router.post('/purchase-orders', requirePermission('purchase.create'), validateBody(poSchema), idem('POST /procurement/purchase-orders'), asyncHandler(async (req, res) => res.status(201).json({ data: await service.create(ctx(req), actor(req), req.body) })));
  router.get('/purchase-orders/:id', poView, asyncHandler(async (req, res) => res.json({ data: await service.get(ctx(req), req.params.id) })));
  router.get('/purchase-orders/:id/revisions/:revision', poView, asyncHandler(async (req, res) => res.json({ data: await service.revisionSnapshot(ctx(req), req.params.id, Number(req.params.revision)) })));
  router.patch('/purchase-orders/:id', requirePermission('purchase.edit'), validateBody(poPatchSchema), asyncHandler(async (req, res) => res.json({ data: await service.patch(ctx(req), actor(req), req.params.id, req.body, ifMatchVersion(req)) })));
  const commands: { path: string; command: 'submit' | 'approve' | 'reject' | 'issue' | 'cancel' | 'short-close' | 'close'; perm: string; body: z.ZodTypeAny }[] = [
    { path: 'submit', command: 'submit', perm: 'purchase.create', body: commentSchema },
    { path: 'approve', command: 'approve', perm: 'purchase.approve', body: commentSchema },
    { path: 'reject', command: 'reject', perm: 'purchase.approve', body: requiredReasonSchema },
    { path: 'issue', command: 'issue', perm: 'purchase.issue', body: commentSchema },
    { path: 'cancel', command: 'cancel', perm: 'purchase.cancel', body: reasonSchema },
    { path: 'short-close', command: 'short-close', perm: 'purchase.approve', body: requiredReasonSchema },
    { path: 'close', command: 'close', perm: 'purchase.edit', body: reasonSchema },
  ];
  for (const c of commands) {
    router.post(`/purchase-orders/:id/${c.path}`, requirePermission(c.perm), validateBody(c.body), idem(`POST /procurement/purchase-orders/${c.path}`), asyncHandler(async (req, res) => res.json({ data: await service.command(ctx(req), actor(req), req.params.id, c.command, req.body) })));
  }
  router.post('/purchase-orders/:id/revise', requirePermission('purchase.edit'), validateBody(reviseSchema), idem('POST /procurement/purchase-orders/revise'), asyncHandler(async (req, res) => res.json({ data: await service.revise(ctx(req), actor(req), req.params.id, req.body) })));
  router.get('/purchase-orders/:id/receivable-lines', requirePermission('grn.create', 'grn.view'), asyncHandler(async (req, res) => res.json({ data: await service.receivableLines(ctx(req), req.params.id) })));

  router.get('/grns', requirePermission('grn.view'), validateQuery(grnListQuery), asyncHandler(async (req, res) => res.json({ data: await service.listGrns(ctx(req), parseQuery<typeof grnListQuery>(res)) })));
  router.post('/grns', requirePermission('grn.create'), validateQuery(receiveQuery), validateBody(grnSchema), idem('POST /procurement/grns', true), asyncHandler(async (req, res) => {
    const receive = parseQuery<typeof receiveQuery>(res).receive === 'true';
    res.status(201).json({ data: await service.createGrn(ctx(req), actor(req), req.body, getIdempotencyKey(res), receive) });
  }));
  router.get('/grns/:id', requirePermission('grn.view'), asyncHandler(async (req, res) => res.json({ data: await service.getGrn(ctx(req), req.params.id) })));
  router.post('/grns/:id/receive', requirePermission('grn.create'), idem('POST /procurement/grns/receive'), asyncHandler(async (req, res) => res.json({ data: await service.receiveGrn(ctx(req), actor(req), req.params.id) })));
  router.post('/grns/:id/cancel', requirePermission('grn.cancel'), validateBody(requiredReasonSchema), idem('POST /procurement/grns/cancel'), asyncHandler(async (req, res) => res.json({ data: await service.cancelGrn(ctx(req), actor(req), req.params.id, req.body.reason) })));
  router.post('/grns/:id/retry-posting', requirePermission('grn.create'), validateBody(retrySchema), idem('POST /procurement/grns/retry'), asyncHandler(async (req, res) => res.json({ data: await service.retryPosting(ctx(req), actor(req), req.params.id, req.body.serials ?? null) })));

  router.get('/settings', requirePermission('purchase.view'), asyncHandler(async (req, res) => res.json({ data: await service.getSettings(ctx(req).tenantId!) })));
  router.put('/settings', requirePermission('settings.manage'), validateBody(settingsSchema), asyncHandler(async (req, res) => res.json({ data: await service.updateSettings(ctx(req).tenantId!, actor(req), req.body) })));

  router.post(['/attachments:presign', '/attachments/presign'], requirePermission('purchase.edit', 'grn.create'), validateBody(presignSchema), asyncHandler(async (req, res) => res.status(201).json({ data: await service.presign(ctx(req), actor(req), req.body) })));
  router.get('/attachments', requirePermission('purchase.view', 'grn.view'), validateQuery(attachmentsQuery), asyncHandler(async (req, res) => {
    const q = parseQuery<typeof attachmentsQuery>(res);
    res.json({ data: await service.attachments(ctx(req), q.entityType, q.entityId) });
  }));
  return router;
}
