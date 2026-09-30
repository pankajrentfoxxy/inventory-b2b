import { Router, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { z } from 'zod';
import { requiredEmail, requiredPersonName } from '@b2b/shared';
import { asyncHandler, authenticate, badRequest, createRateLimiter, getContext, unauthorized, validateBody } from '@b2b/platform-kit';
import type { AuthConfig } from '../config.js';
import type { AuthService, LoginResult } from './auth.service.js';

const password = z.string().min(1, 'Password is required').max(128);
const loginSchema = z.object({ email: requiredEmail({ lowercase: true }), password, portal: z.enum(['app', 'admin']).default('app') });
const mfaSchema = z.object({ mfaToken: z.string().min(10), code: z.string().min(6).max(8) });
const selectSchema = z.object({ selectionToken: z.string().min(10), tenantId: z.string().uuid() });
const refreshSchema = z.object({ refreshToken: z.string().min(10).optional() });
const forgotSchema = z.object({ email: requiredEmail({ lowercase: true }) });
const resetSchema = z.object({ token: z.string().min(10), password });
const acceptInviteSchema = z.object({ token: z.string().min(10), password, fullName: requiredPersonName('Your name', { min: 2 }).optional() });
const serviceTokenSchema = z.object({ clientId: z.string().min(1), clientSecret: z.string().min(1), audience: z.string().min(1) });
const ensureUserSchema = z.object({ email: requiredEmail({ lowercase: true }), fullName: requiredPersonName('Name', { min: 2 }), password: password.optional() });
const usersBatchSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) });

export const REFRESH_COOKIE = { app: 'b2b_app_refresh', admin: 'b2b_admin_refresh' } as const;
const REFRESH_COOKIE_PATH = '/api/v1/auth';

function meta(req: Request) {
  return { ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
}

export function createAuthRouter(service: AuthService, config: AuthConfig) {
  const router = Router();
  router.use(cookieParser());

  const deliverInBody = (req: Request) => req.header('x-refresh-delivery') === 'body';

  function respondTokens(req: Request, res: Response, result: LoginResult, status = 200) {
    if (result.kind !== 'tokens') {
      res.status(status).json({ data: result });
      return;
    }
    const cookieName = result.tokenType === 'platform' ? REFRESH_COOKIE.admin : REFRESH_COOKIE.app;
    res.cookie(cookieName, result.tokens.refreshToken, { httpOnly: true, secure: config.COOKIE_SECURE === 'on', sameSite: 'strict', path: REFRESH_COOKIE_PATH, expires: result.tokens.refreshExpiresAt });
    res.status(status).json({
      data: {
        kind: 'tokens',
        tokenType: result.tokenType,
        accessToken: result.tokens.accessToken,
        expiresIn: result.tokens.expiresIn,
        tenant: result.tenant ?? null,
        ...(deliverInBody(req) ? { refreshToken: result.tokens.refreshToken } : {}),
      },
    });
  }

  const loginLimiter = createRateLimiter({
    windowMs: 60_000,
    limit: config.LOGIN_RATE_LIMIT_PER_MIN,
    keyOf: (req) => `${req.ip}:${String((req.body as { email?: string })?.email ?? '').toLowerCase()}`,
    message: 'Too many sign-in attempts. Please wait a minute.',
  });

  router.post('/login', validateBody(loginSchema), loginLimiter, asyncHandler(async (req, res) => {
    const result = await service.login(req.body, meta(req), req.correlationId ?? '');
    respondTokens(req, res, result);
  }));

  router.post('/mfa/verify', validateBody(mfaSchema), asyncHandler(async (req, res) => {
    respondTokens(req, res, await service.verifyMfa(req.body.mfaToken, req.body.code, meta(req), req.correlationId ?? ''));
  }));

  router.post('/select-tenant', validateBody(selectSchema), asyncHandler(async (req, res) => {
    respondTokens(req, res, await service.selectTenant(req.body.selectionToken, req.body.tenantId, meta(req), req.correlationId ?? ''));
  }));

  router.post('/refresh', validateBody(refreshSchema), asyncHandler(async (req, res) => {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
    const raw = req.body.refreshToken ?? cookies[REFRESH_COOKIE.app] ?? cookies[REFRESH_COOKIE.admin];
    if (!raw) throw unauthorized('Refresh token is missing', 'AUTH_REFRESH_INVALID');
    const { tokens, tokenType } = await service.refresh(raw);
    respondTokens(req, res, { kind: 'tokens', tokens, tokenType });
  }));

  router.post('/logout', authenticate({ verifier: service.verifier, types: ['tenant', 'platform'] }), asyncHandler(async (req, res) => {
    const ctx = getContext(req);
    if (ctx.sessionId) await service.logout(ctx.sessionId);
    res.clearCookie(REFRESH_COOKIE.app, { path: REFRESH_COOKIE_PATH });
    res.clearCookie(REFRESH_COOKIE.admin, { path: REFRESH_COOKIE_PATH });
    res.status(204).end();
  }));

  router.get('/me', authenticate({ verifier: service.verifier, types: ['tenant', 'platform'] }), asyncHandler(async (req, res) => {
    const ctx = getContext(req);
    res.json({ data: { userId: ctx.userId, email: ctx.email, name: ctx.userName, tokenType: ctx.tokenType, tenantId: ctx.tenantId, membershipId: ctx.membershipId, permissions: [...ctx.permissions], permissionVersion: ctx.permissionVersion } });
  }));

  router.get('/me/tenants', authenticate({ verifier: service.verifier, types: ['tenant', 'platform'] }), asyncHandler(async (req, res) => {
    res.json({ data: await service.tenantsFor(getContext(req).userId) });
  }));

  const forgotLimiter = createRateLimiter({ windowMs: 60 * 60_000, limit: config.isTest ? 10_000 : 5, keyOf: (req) => `forgot:${req.ip}` });
  router.post('/password/forgot', validateBody(forgotSchema), forgotLimiter, asyncHandler(async (req, res) => {
    await service.forgotPassword(req.body.email, req.correlationId ?? '');
    res.status(202).json({ data: { accepted: true } });
  }));

  router.post('/password/reset', validateBody(resetSchema), asyncHandler(async (req, res) => {
    await service.resetPassword(req.body.token, req.body.password, req.correlationId ?? '');
    res.json({ data: { reset: true } });
  }));

  router.post('/invitations/accept', validateBody(acceptInviteSchema), asyncHandler(async (req, res) => {
    res.json({ data: await service.acceptInvite(req.body.token, { password: req.body.password, fullName: req.body.fullName }, req.correlationId ?? '') });
  }));

  return router;
}

export function createInternalRouter(service: AuthService) {
  const router = Router();

  router.post('/service-tokens', validateBody(serviceTokenSchema), asyncHandler(async (req, res) => {
    res.json(service.issueServiceToken(req.body.clientId, req.body.clientSecret, req.body.audience));
  }));

  const serviceOnly = authenticate({ verifier: service.verifier, types: ['service'], serviceName: 'svc-auth' });

  router.post('/users:ensure', serviceOnly, validateBody(ensureUserSchema), asyncHandler(async (req, res) => {
    res.json({ data: await service.ensureUser(req.body, req.correlationId ?? '') });
  }));

  router.post('/users:batch', serviceOnly, validateBody(usersBatchSchema), asyncHandler(async (req, res) => {
    res.json({ data: await service.getUsers(req.body.ids) });
  }));

  router.get('/users/by-email', serviceOnly, asyncHandler(async (req, res) => {
    const email = String(req.query.email ?? '');
    if (!email) throw badRequest('email is required');
    const user = await service.findUserByEmail(email);
    res.json({ data: user });
  }));

  return router;
}
