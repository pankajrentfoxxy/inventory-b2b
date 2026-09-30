import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler, authenticate, getContext, idempotent, ifMatchVersion, parseQuery, registerConsumer, requirePermission, requireService, requireTenant, requireUuidParams, validateBody, validateQuery, type ConsumerRuntime, type Logger, type SqlClient, type TokenVerifier } from '@b2b/platform-kit';
import { EVENT_TYPES, rk } from '@b2b/contracts';
import type { Tx } from '../db.js';
import { partyFormSchema } from '@b2b/shared';
import { PartyService, actorFrom, type PartyType } from './party.service.js';
import type { PartyFormService } from './party.form.js';
import { addressSchema, bankAccountSchema, contactSchema, listQuery, partyPatchSchema, partySchema, reasonSchema, statusSchema } from './party.schema.js';

export interface PartyRouterDeps {
  service: PartyService;
  /** The vendor-form shaped create / full update / read (optional for the internal router). */
  forms?: PartyFormService;
  verifier: TokenVerifier;
  db: SqlClient;
  logger: Logger;
}

const lookupQuery = z.object({ q: z.string().trim().max(100).optional() });

export function createPartyRouter({ service, forms, verifier, db, logger }: PartyRouterDeps) {
  const router = Router();
  router.use(authenticate({ verifier, types: ['tenant'] }), requireTenant);
  requireUuidParams(router, 'id', 'subId');
  const tenantOf = (req: Request) => getContext(req).tenantId!;
  const actor = (req: Request) => actorFrom(getContext(req));
  const idem = (scope: string) => idempotent(scope, { db, logger, required: false });

  for (const { path, type, view, manage } of [
    { path: 'suppliers', type: 'SUPPLIER' as PartyType, view: requirePermission('supplier.view', 'purchase.view', 'grn.view', 'billing.view'), manage: requirePermission('supplier.manage') },
    { path: 'customers', type: 'CUSTOMER' as PartyType, view: requirePermission('customer.view', 'sales.view', 'dispatch.view', 'billing.view'), manage: requirePermission('customer.manage') },
  ]) {
    if (forms) {
      // Vendor-form endpoints: same fields and save logic as the legacy vendor form.
      router.post(`/${path}/form`, manage, validateBody(partyFormSchema), idem(`POST /party/${path}/form`), asyncHandler(async (req, res) => res.status(201).json({ data: await forms.create(tenantOf(req), actor(req), type, req.body) })));
      router.get(`/${path}/:id/form`, view, asyncHandler(async (req, res) => res.json({ data: await forms.get(tenantOf(req), type, req.params.id) })));
      router.put(`/${path}/:id/form`, manage, validateBody(partyFormSchema), asyncHandler(async (req, res) => res.json({ data: await forms.update(tenantOf(req), actor(req), type, req.params.id, req.body, ifMatchVersion(req)) })));
    }
    router.get(`/${path}`, view, validateQuery(listQuery), asyncHandler(async (req, res) => res.json(await service.list(tenantOf(req), type, parseQuery<typeof listQuery>(res)))));
    router.get(`/lookups/${path}`, view, validateQuery(lookupQuery), asyncHandler(async (req, res) => res.json({ data: await service.lookup(tenantOf(req), type, parseQuery<typeof lookupQuery>(res).q) })));
    router.post(`/${path}`, manage, validateBody(partySchema), idem(`POST /party/${path}`), asyncHandler(async (req, res) => res.status(201).json({ data: await service.create(tenantOf(req), actor(req), type, req.body) })));
    router.get(`/${path}/:id`, view, asyncHandler(async (req, res) => res.json({ data: await service.get(tenantOf(req), type, req.params.id) })));
    router.patch(`/${path}/:id`, manage, validateBody(partyPatchSchema), asyncHandler(async (req, res) => res.json({ data: await service.patch(tenantOf(req), actor(req), type, req.params.id, req.body, ifMatchVersion(req)) })));
    router.post(`/${path}/:id/status`, manage, validateBody(statusSchema), asyncHandler(async (req, res) => res.json({ data: await service.setStatus(tenantOf(req), actor(req), type, req.params.id, req.body.status) })));
    router.post(`/${path}/:id/block`, manage, validateBody(reasonSchema), asyncHandler(async (req, res) => res.json({ data: await service.block(tenantOf(req), actor(req), type, req.params.id, req.body.reason) })));
    router.post(`/${path}/:id/unblock`, manage, validateBody(reasonSchema), asyncHandler(async (req, res) => res.json({ data: await service.unblock(tenantOf(req), actor(req), type, req.params.id, req.body.reason) })));
    router.delete(`/${path}/:id`, manage, asyncHandler(async (req, res) => res.json({ data: await service.delete(tenantOf(req), actor(req), type, req.params.id) })));
    router.post(`/${path}/:id/addresses`, manage, validateBody(addressSchema), asyncHandler(async (req, res) => res.status(201).json({ data: await service.addAddress(tenantOf(req), actor(req), type, req.params.id, req.body) })));
    router.delete(`/${path}/:id/addresses/:subId`, manage, asyncHandler(async (req, res) => res.json({ data: await service.removeAddress(tenantOf(req), actor(req), type, req.params.id, req.params.subId) })));
    router.post(`/${path}/:id/contacts`, manage, validateBody(contactSchema), asyncHandler(async (req, res) => res.status(201).json({ data: await service.addContact(tenantOf(req), actor(req), type, req.params.id, req.body) })));
    router.delete(`/${path}/:id/contacts/:subId`, manage, asyncHandler(async (req, res) => res.json({ data: await service.removeContact(tenantOf(req), actor(req), type, req.params.id, req.params.subId) })));
    router.post(`/${path}/:id/bank-accounts`, manage, validateBody(bankAccountSchema), asyncHandler(async (req, res) => res.status(201).json({ data: await service.addBankAccount(tenantOf(req), actor(req), type, req.params.id, req.body) })));
    router.delete(`/${path}/:id/bank-accounts/:subId`, manage, asyncHandler(async (req, res) => res.json({ data: await service.removeBankAccount(tenantOf(req), actor(req), type, req.params.id, req.params.subId) })));
    router.post(`/${path}/:id/bank-accounts/:subId/reveal`, manage, asyncHandler(async (req, res) => res.json({ data: await service.revealBankAccount(tenantOf(req), actor(req), type, req.params.id, req.params.subId) })));
  }
  return router;
}

export function createInternalPartyRouter({ service, verifier }: PartyRouterDeps) {
  const router = Router();
  router.use(authenticate({ verifier, types: ['service'], serviceName: 'svc-party' }), requireService());
  requireUuidParams(router, 'id');
  const tenantOf = (req: Request) => {
    const t = getContext(req).tenantId;
    if (!t) throw new Error('x-on-behalf-of-tenant required');
    return t;
  };
  router.get('/parties/:id/snapshot', asyncHandler(async (req, res) => {
    const snap = await service.snapshotById(tenantOf(req), req.params.id);
    if (!snap) {
      res.status(404).json({ success: false, message: 'Party not found', error: { code: 'NOT_FOUND', message: 'Party not found', correlationId: req.correlationId } });
      return;
    }
    res.json({ data: snap });
  }));
  router.get('/parties:batch', asyncHandler(async (req, res) => {
    const ids = String(req.query.ids ?? '').split(',').filter(Boolean).slice(0, 200);
    res.json({ data: await service.batch(tenantOf(req), ids) });
  }));
  return router;
}

const refPayload = z.object({ supplierId: z.string().uuid().optional(), customerId: z.string().uuid().optional() });

export async function registerPartyConsumers(runtime: ConsumerRuntime, service: PartyService): Promise<void> {
  await registerConsumer(runtime, {
    name: 'party.references',
    bindings: [rk(EVENT_TYPES.PO_CREATED), 'sales.so.created.v1', rk(EVENT_TYPES.GRN_RECEIVED)],
    handle: async (envelope, tx) => {
      if (!envelope.tenantId) return;
      const p = refPayload.parse(envelope.payload);
      const by = envelope.eventType.startsWith('sales.') ? 'svc-sales' : 'svc-procurement';
      const refs: { entityType: PartyType; entityId: string; referencedBy: string }[] = [];
      if (p.supplierId) refs.push({ entityType: 'SUPPLIER', entityId: p.supplierId, referencedBy: by });
      if (p.customerId) refs.push({ entityType: 'CUSTOMER', entityId: p.customerId, referencedBy: by });
      await service.recordReferences(tx as unknown as Tx, envelope.tenantId, refs);
    },
  });
}
