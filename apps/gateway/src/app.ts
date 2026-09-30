/**
 * Gateway (Phase 0 chassis + Phase 1/2 identity rules, README 5.1):
 *
 *   correlation id -> strip identity headers -> body cap -> rate limit -> route match ->
 *   verify token (RS256 via JWKS, HS256 legacy adapter) -> access rule (public/tenant/platform) ->
 *   tenant status ACTIVE (cache, fallback svc-tenant) -> permission version / member status ->
 *   proxy with x-correlation-id -> 503 envelope when the upstream is down
 */
import express, { type Request, type RequestHandler, type Response } from 'express';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';
import { createProxyMiddleware, type Options as ProxyOptions } from 'http-proxy-middleware';
import {
  EVENT_TYPES,
  iamMembershipPayload,
  iamPermissionsChangedPayload,
  rk,
  tenantLifecyclePayload,
} from '@b2b/contracts';
import {
  AmqpBroker,
  InMemoryBroker,
  JwksKeyProvider,
  StaticKeyProvider,
  contextFromClaims,
  createLogger,
  createRemoteServiceTokenSource,
  createServiceClient,
  createTokenVerifier,
  errorBody,
  uuidv7,
  type Broker,
  type KeyProvider,
  type Logger,
  type ServiceClient,
  type ServiceTokenSource,
  type TenantContext,
  type TokenVerifier,
} from '@b2b/platform-kit';
import type { GatewayConfig } from './config.js';
import { ROUTES, STRIPPED_HEADERS, matchRoute, type RouteRule, type TargetName } from './routes.js';
import { MemoryStatusCache, RedisStatusCache, cacheKeys, type StatusCache } from './status-cache.js';

export const CORRELATION_HEADER = 'x-correlation-id';
const MAX_CORRELATION_ID_LENGTH = 128;

export interface GatewayOptions {
  targets?: Partial<Record<TargetName, string>>;
  routes?: RouteRule[];
  logger?: Logger;
  keys?: KeyProvider;
  statusCache?: StatusCache;
  serviceTokens?: ServiceTokenSource;
  broker?: Broker;
  probeUpstream?: (url: string) => Promise<boolean>;
}

export interface Gateway {
  app: express.Express;
  statusCache: StatusCache;
  broker: Broker | null;
  /** Subscribes the cache consumers (tenant + iam events). */
  start(): Promise<void>;
  stop(): Promise<void>;
}

async function defaultProbe(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch {
    return false;
  }
}

function sendError(res: Response, status: number, code: string, message: string, retryable = false, details?: { path: string; message: string }[]) {
  if (res.headersSent) return;
  res.status(status).json(errorBody(code, message, details, { correlationId: res.req.correlationId, retryable }));
}

export function createGateway(config: GatewayConfig, options: GatewayOptions = {}): Gateway {
  const isTest = config.NODE_ENV === 'test';
  const logger = options.logger ?? createLogger({ service: 'gateway', level: config.LOG_LEVEL, pretty: config.NODE_ENV !== 'production', silent: isTest });
  const routes = options.routes ?? ROUTES;
  const targets: Record<TargetName, string | undefined> = {
    'legacy-api': config.LEGACY_API_URL,
    'svc-auth': config.AUTH_URL,
    'svc-tenant': config.TENANT_URL,
    'svc-audit': config.AUDIT_URL,
    'svc-iam': config.IAM_URL,
    'svc-master': config.MASTER_URL,
    'svc-party': config.PARTY_URL,
    'svc-inventory': config.INVENTORY_URL,
    'svc-procurement': config.PROCUREMENT_URL,
    'svc-qc': config.QC_URL,
    ...options.targets,
  };
  const keys = options.keys ?? (config.AUTH_JWT_PUBLIC_KEY ? new StaticKeyProvider(config.AUTH_JWT_PUBLIC_KEY) : new JwksKeyProvider(config.AUTH_JWKS_URL ?? `${config.AUTH_URL}/.well-known/jwks.json`));
  const verifier: TokenVerifier = createTokenVerifier({ keys, issuer: config.AUTH_ISSUER, audience: config.AUTH_AUDIENCE, legacySecret: config.LEGACY_JWT_SECRET });
  const statusCache = options.statusCache ?? (config.REDIS_URL ? new RedisStatusCache(config.REDIS_URL) : new MemoryStatusCache());
  const serviceTokens = options.serviceTokens ?? (config.SERVICE_CLIENT_SECRET ? createRemoteServiceTokenSource({ authUrl: config.AUTH_URL, clientId: config.SERVICE_CLIENT_ID, clientSecret: config.SERVICE_CLIENT_SECRET }) : null);
  const tenantClient: ServiceClient | null = serviceTokens && targets['svc-tenant'] ? createServiceClient({ targetService: 'svc-tenant', baseUrl: targets['svc-tenant'], tokens: serviceTokens }) : null;
  const broker: Broker | null = options.broker ?? (config.AMQP_URL ? new AmqpBroker({ url: config.AMQP_URL, exchange: config.AMQP_EXCHANGE, logger }) : null);
  const probe = options.probeUpstream ?? defaultProbe;
  const ttl = config.TENANT_STATUS_TTL_SEC;

  async function tenantStatus(tid: string): Promise<{ value: string; version: number } | null> {
    const cached = await statusCache.get(cacheKeys.tenantStatus(tid));
    if (cached) return cached;
    if (!tenantClient) return null;
    try {
      const res = await tenantClient.call<{ data: { status: string; version: number } }>(`/internal/v1/tenants/${tid}/status`, { correlationId: `gw-${tid}` });
      await statusCache.set(cacheKeys.tenantStatus(tid), res.data.status, res.data.version, ttl);
      return { value: res.data.status, version: res.data.version };
    } catch (err) {
      if ((err as { status?: number }).status === 404) return { value: 'UNKNOWN', version: 0 };
      logger.warn({ err, tid }, 'tenant status lookup failed');
      return null;
    }
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    for (const header of STRIPPED_HEADERS) delete req.headers[header];
    const inbound = req.header(CORRELATION_HEADER)?.trim();
    req.correlationId = inbound && inbound.length <= MAX_CORRELATION_ID_LENGTH ? inbound : uuidv7();
    res.setHeader(CORRELATION_HEADER, req.correlationId);
    next();
  });
  app.use(helmet());
  if (!isTest) {
    app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/health') }, customProps: (req) => ({ correlationId: req.correlationId, userId: req.tenantContext?.userId, tenantId: req.tenantContext?.tenantId }), redact: ['req.headers.authorization', 'req.headers.cookie'] }));
  }

  app.get('/health/live', (_req, res) => res.json({ status: 'ok', service: 'gateway', time: new Date().toISOString() }));
  app.get('/health/ready', async (req, res) => {
    const checks: Record<string, string> = {};
    for (const name of ['legacy-api', 'svc-auth', 'svc-tenant'] as TargetName[]) {
      const url = targets[name];
      checks[name] = url && (await probe(`${url}/health/live`)) ? 'ok' : 'down';
    }
    const ok = Object.values(checks).every((v) => v === 'ok');
    res.status(ok ? 200 : 503).json(ok ? { status: 'ok', service: 'gateway', checks, time: new Date().toISOString() } : { ...errorBody('NOT_READY', 'One or more upstreams are unreachable', undefined, { correlationId: req.correlationId, retryable: true }), status: 'down', service: 'gateway', checks });
  });

  app.use((req, res, next) => {
    const length = Number(req.header('content-length') ?? 0);
    if (length > config.BODY_LIMIT_BYTES) return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    next();
  });

  const principalOf = (req: Request): string | null => {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) return null;
    const decoded = jwt.decode(header.slice(7));
    return decoded && typeof decoded === 'object' && typeof decoded.sub === 'string' ? decoded.sub : null;
  };
  app.use(
    rateLimit({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      limit: (req) => (principalOf(req as Request) ? config.RATE_LIMIT_PER_PRINCIPAL : config.RATE_LIMIT_PER_IP),
      keyGenerator: (req) => principalOf(req as Request) ?? `ip:${req.ip}`,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: (req) => (req.path ?? '').startsWith('/health'),
      handler: (_req, res) => sendError(res, 429, 'RATE_LIMITED', 'Too many requests. Please slow down.', true),
    }),
  );

  // Proxies, one per configured upstream.
  const proxies = new Map<TargetName, RequestHandler>();
  for (const [name, url] of Object.entries(targets) as [TargetName, string | undefined][]) {
    if (!url) continue;
    const proxyOptions: ProxyOptions = {
      target: url,
      changeOrigin: true,
      xfwd: true,
      proxyTimeout: config.PROXY_TIMEOUT_MS,
      timeout: config.PROXY_TIMEOUT_MS,
      logger: isTest ? undefined : logger,
      on: {
        proxyReq: (proxyReq, req) => {
          proxyReq.setHeader(CORRELATION_HEADER, req.correlationId ?? '');
        },
        error: (err, req, res) => {
          logger.warn({ err, target: name, correlationId: req.correlationId }, 'upstream error');
          if ('headersSent' in res && !res.headersSent && 'status' in res) sendError(res as Response, 503, 'UPSTREAM_UNAVAILABLE', `The ${name} service is unavailable. Please retry.`, true);
        },
      },
    };
    proxies.set(name, createProxyMiddleware(proxyOptions));
  }

  /** Verifies the bearer token and enforces the route's access rule plus tenant / membership state. */
  async function authorise(req: Request, rule: RouteRule): Promise<{ status: number; code: string; message: string } | null> {
    if (rule.access === 'public') return null;
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) return { status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required' };
    let ctx: TenantContext;
    try {
      const claims = await verifier.verify(header.slice(7), { types: ['tenant', 'platform'] });
      ctx = contextFromClaims(claims, req.correlationId ?? '');
    } catch (err) {
      const e = err as { code?: string; message?: string };
      return { status: 401, code: e.code ?? 'UNAUTHENTICATED', message: e.message ?? 'Invalid token' };
    }
    req.tenantContext = ctx;
    if (rule.access === 'platform' && ctx.tokenType !== 'platform') return { status: 403, code: 'PLATFORM_ONLY', message: 'This API is for platform administrators' };
    if (rule.access === 'tenant' && ctx.tokenType === 'platform') return { status: 403, code: 'PLATFORM_TOKEN_ON_TENANT_ROUTE', message: 'Platform accounts cannot use tenant APIs' };
    if (ctx.tokenType === 'tenant' && ctx.tenantId) {
      const status = await tenantStatus(ctx.tenantId);
      if (status && status.value !== 'ACTIVE') return { status: 403, code: 'TENANT_NOT_ACTIVE', message: status.value === 'SUSPENDED' ? 'This organisation is suspended. Contact support.' : 'This organisation is not active.' };
      if (ctx.membershipId) {
        const member = await statusCache.get(cacheKeys.memberStatus(ctx.membershipId));
        if (member && member.value !== 'ACTIVE') return { status: 403, code: 'MEMBER_SUSPENDED', message: 'Your membership is not active' };
        const pv = await statusCache.get(cacheKeys.permissionVersion(ctx.membershipId));
        if (pv && ctx.permissionVersion !== null && pv.version > ctx.permissionVersion) return { status: 401, code: 'PERMISSIONS_STALE', message: 'Your permissions changed. Please refresh your session.' };
      }
    }
    return null;
  }

  app.use((req, res, next) => {
    const rule = matchRoute(req.path, routes);
    if (!rule || !rule.enabled) return sendError(res, 404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`);
    if (rule.gone) return sendError(res, 410, 'ROUTE_RETIRED', rule.gone);
    authorise(req, rule)
      .then((denied) => {
        if (denied) return sendError(res, denied.status, denied.code, denied.message, false);
        const proxy = rule.target ? proxies.get(rule.target) : undefined;
        if (!proxy) return sendError(res, 503, 'UPSTREAM_UNAVAILABLE', `The ${rule.target} service is not configured`, true);
        if (rule.rewrite) {
          const url = new URL(req.url, 'http://gateway.local');
          req.url = rule.rewrite(url.pathname) + url.search;
        }
        proxy(req, res, next);
      })
      .catch(next);
  });

  return {
    app,
    statusCache,
    broker,
    async start() {
      if (!broker) return;
      await broker.subscribe({
        queue: 'gateway.tenant-status',
        bindings: [rk(EVENT_TYPES.TENANT_ACTIVATED), rk(EVENT_TYPES.TENANT_SUSPENDED), rk(EVENT_TYPES.TENANT_REACTIVATED), rk(EVENT_TYPES.TENANT_DEACTIVATED)],
        handler: async (envelope) => {
          const p = tenantLifecyclePayload.parse(envelope.payload);
          await statusCache.set(cacheKeys.tenantStatus(p.tenantId), p.status, envelope.aggregate.version ?? 0, ttl);
        },
      });
      await broker.subscribe({
        queue: 'gateway.membership-state',
        bindings: [rk(EVENT_TYPES.IAM_PERMISSIONS_CHANGED), rk(EVENT_TYPES.IAM_MEMBERSHIP_SUSPENDED), rk(EVENT_TYPES.IAM_MEMBERSHIP_REACTIVATED), rk(EVENT_TYPES.IAM_MEMBERSHIP_REMOVED)],
        handler: async (envelope) => {
          if (envelope.eventType === EVENT_TYPES.IAM_PERMISSIONS_CHANGED) {
            const p = iamPermissionsChangedPayload.parse(envelope.payload);
            for (const m of p.memberships) await statusCache.set(cacheKeys.permissionVersion(m.membershipId), String(m.permissionVersion), m.permissionVersion, 24 * 3600);
            return;
          }
          const p = iamMembershipPayload.parse(envelope.payload);
          await statusCache.set(cacheKeys.memberStatus(p.membershipId), p.status, envelope.aggregate.version ?? 0, 24 * 3600);
          await statusCache.set(cacheKeys.permissionVersion(p.membershipId), String(p.permissionVersion), p.permissionVersion, 24 * 3600);
        },
      });
    },
    async stop() {
      await broker?.close();
      if (statusCache instanceof RedisStatusCache) await statusCache.close();
    },
  };
}

export { InMemoryBroker };
