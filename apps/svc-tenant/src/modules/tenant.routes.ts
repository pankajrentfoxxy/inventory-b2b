import { Router, type Request } from 'express';
import {
  asyncHandler,
  authenticate,
  createRateLimiter,
  createServiceClient,
  getContext,
  idempotent,
  ifMatchVersion,
  parseQuery,
  requirePermission,
  requirePlatform,
  requireService,
  requireUuidParams,
  validateBody,
  validateQuery,
  type ServiceTokenSource,
  type SqlClient,
  type TokenVerifier,
  type Logger,
} from '@b2b/platform-kit';
import type { TenantEnv } from '../config.js';
import { actorFrom, assertKnownTransition, TenantService } from './tenant.service.js';
import { applicationSchema, createTenantSchema, deactivateSchema, listQuerySchema, noteSchema, reasonSchema, settingsSchema, updateTenantSchema } from './tenant.schema.js';
import type { CaptchaVerifier } from './captcha.js';

export interface TenantRouterDeps {
  service: TenantService;
  verifier: TokenVerifier;
  db: SqlClient;
  logger: Logger;
  config: TenantEnv;
  serviceTokens: ServiceTokenSource | null;
  captcha: CaptchaVerifier;
}

const meta = (req: Request) => ({ ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null });

export function createPlatformRouter(deps: TenantRouterDeps) {
  const { service, verifier, db, logger, config } = deps;
  const router = Router();
  router.use(authenticate({ verifier, types: ['platform', 'tenant'] }), requirePlatform);
  requireUuidParams(router, 'id');
  const idem = (scope: string) => idempotent(scope, { db, logger });
  const actor = (req: Request) => actorFrom(getContext(req), meta(req).ip, meta(req).userAgent);

  router.get('/dashboard', requirePermission('platform.dashboard.view'), asyncHandler(async (_req, res) => res.json({ data: await service.dashboard() })));

  router.get('/vendors', requirePermission('platform.tenant.view'), validateQuery(listQuerySchema), asyncHandler(async (_req, res) => res.json(await service.list(parseQuery<typeof listQuerySchema>(res)))));

  router.post('/vendors', requirePermission('platform.tenant.create'), validateBody(createTenantSchema), idem('POST /platform/vendors'), asyncHandler(async (req, res) => {
    res.status(201).json({ data: await service.create(req.body, 'ADMIN_CREATED', actor(req)) });
  }));

  router.get('/vendors/:id', requirePermission('platform.tenant.view'), asyncHandler(async (req, res) => res.json({ data: await service.get(req.params.id) })));

  router.patch('/vendors/:id', requirePermission('platform.tenant.edit'), validateBody(updateTenantSchema), asyncHandler(async (req, res) => {
    res.json({ data: await service.update(req.params.id, req.body, ifMatchVersion(req), actor(req)) });
  }));

  router.put('/vendors/:id/settings', requirePermission('platform.tenant.edit'), validateBody(settingsSchema), asyncHandler(async (req, res) => {
    res.json({ data: await service.updateSettings(req.params.id, req.body, actor(req)) });
  }));

  const commands: { command: string; permission: string; schema: typeof reasonSchema | typeof noteSchema | typeof deactivateSchema }[] = [
    { command: 'approve', permission: 'platform.tenant.approve', schema: noteSchema },
    { command: 'reject', permission: 'platform.tenant.approve', schema: reasonSchema },
    { command: 'activate', permission: 'platform.tenant.activate', schema: noteSchema },
    { command: 'suspend', permission: 'platform.tenant.suspend', schema: reasonSchema },
    { command: 'reactivate', permission: 'platform.tenant.suspend', schema: reasonSchema },
    { command: 'deactivate', permission: 'platform.tenant.deactivate', schema: deactivateSchema },
  ];
  for (const c of commands) {
    router.post(`/vendors/:id/${c.command}`, requirePermission(c.permission), validateBody(c.schema), idem(`POST /platform/vendors/${c.command}`), asyncHandler(async (req, res) => {
      assertKnownTransition(c.command);
      const body = req.body as { reason?: string; note?: string; confirmCode?: string };
      res.json({ data: await service.transition(req.params.id, c.command, actor(req), { reason: body.reason ?? body.note ?? null, confirmCode: body.confirmCode }) });
    }));
  }

  router.post('/vendors/:id/resend-owner-invite', requirePermission('platform.tenant.activate'), asyncHandler(async (req, res) => {
    res.json({ data: await service.resendOwnerInvite(req.params.id, actor(req)) });
  }));

  // Platform audit view: proxied to svc-audit (README 5.10) with a service token.
  router.get('/audit', requirePermission('platform.audit.view'), asyncHandler(async (req, res) => {
    if (!config.AUDIT_URL || !deps.serviceTokens) {
      res.status(503).json({ success: false, message: 'Audit service is not configured', error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Audit service is not configured', correlationId: req.correlationId, retryable: true } });
      return;
    }
    const client = createServiceClient({ targetService: 'svc-audit', baseUrl: config.AUDIT_URL, tokens: deps.serviceTokens });
    const qs = new URLSearchParams(req.query as Record<string, string>).toString();
    res.json(await client.call(`/internal/v1/audit-events${qs ? `?${qs}` : ''}`, { correlationId: req.correlationId ?? '' }));
  }));

  return router;
}

export function createPublicRouter(deps: TenantRouterDeps) {
  const router = Router();
  const limiter = createRateLimiter({ windowMs: 60 * 60_000, limit: deps.config.APPLICATION_RATE_LIMIT_PER_HOUR, keyOf: (req) => `apply:${req.ip}`, message: 'Too many applications from this address. Please try again later.' });
  router.post('/vendor-applications', limiter, validateBody(applicationSchema), asyncHandler(async (req, res) => {
    const { captchaToken, ...input } = req.body as typeof req.body & { captchaToken?: string };
    const captcha = await deps.captcha.verify(captchaToken, req.ip ?? null);
    if (!captcha.ok) {
      res.status(400).json({ success: false, message: 'Captcha verification failed', error: { code: 'CAPTCHA_FAILED', message: 'Captcha verification failed', correlationId: req.correlationId } });
      return;
    }
    const tenant = await deps.service.create(input, 'APPLICATION', { id: null, name: input.ownerName, correlationId: req.correlationId ?? '', ...meta(req) }, { application: { ip: req.ip ?? null, captchaScore: captcha.score } });
    // Applicants learn only that the application is under review (no ids that could be probed).
    res.status(202).json({ data: { status: tenant.status, code: tenant.code, message: 'Your application is under review. We will email you once it is approved.' } });
  }));
  return router;
}

export function createInternalRouter(deps: TenantRouterDeps) {
  const router = Router();
  router.use(authenticate({ verifier: deps.verifier, types: ['service'], serviceName: 'svc-tenant' }), requireService());
  requireUuidParams(router, 'id');
  router.get('/tenants/:id/status', asyncHandler(async (req, res) => res.json({ data: await deps.service.status(req.params.id) })));
  router.get('/tenants/:id', asyncHandler(async (req, res) => res.json({ data: await deps.service.get(req.params.id) })));
  return router;
}
