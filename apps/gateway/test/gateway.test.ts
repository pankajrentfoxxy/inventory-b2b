/**
 * Gateway (phase-00 step 9 + phase-01/02 identity rules): header stripping, correlation ids, RS256
 * verification with the legacy HS256 adapter, routing table, platform/tenant separation, tenant
 * status enforcement (cache + events + fallback), permission-version and member-status checks,
 * retired self-registration, body cap, rate limiting, upstream failure envelope, health.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { EVENT_TYPES, rk } from '@b2b/contracts';
import { StaticKeyProvider, uuidv7, type EventEnvelope } from '@b2b/platform-kit';
import { InMemoryBroker, platformToken, serviceToken, tenantToken, testKeys } from '@b2b/test-kit';
import { loadConfig } from '../src/config.js';
import { createGateway, type Gateway } from '../src/app.js';
import { MemoryStatusCache, cacheKeys } from '../src/status-cache.js';

const LEGACY_SECRET = 'test-secret-not-for-production-0123456789';

interface Echo {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let upstream: http.Server;
let upstreamUrl: string;
let lastEcho: Echo | null = null;
const tenantStatuses = new Map<string, { status: string; version: number }>();

function startUpstream(): Promise<string> {
  return new Promise((resolve) => {
    upstream = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        lastEcho = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body };
        const statusMatch = /^\/internal\/v1\/tenants\/([^/]+)\/status$/.exec(req.url ?? '');
        if (statusMatch) {
          const s = tenantStatuses.get(statusMatch[1]);
          res.writeHead(s ? 200 : 404, { 'content-type': 'application/json' });
          res.end(JSON.stringify(s ? { data: s } : { error: { code: 'TENANT_NOT_FOUND' } }));
          return;
        }
        if (req.url === '/api/boom') {
          res.writeHead(500, { 'content-type': 'text/html' });
          res.end('<h1>legacy crashed</h1>');
          return;
        }
        if (req.url === '/health/live') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: { echoed: true, url: req.url } }));
      });
    });
    upstream.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(upstream.address() as AddressInfo).port}`));
  });
}

let gw: Gateway;
let broker: InMemoryBroker;
let cache: MemoryStatusCache;

async function boot(overrides: Partial<Record<string, string>> = {}, targets: Partial<Record<string, string>> = {}) {
  const config = loadConfig({ NODE_ENV: 'test', LEGACY_JWT_SECRET: LEGACY_SECRET, LEGACY_API_URL: upstreamUrl, AUTH_URL: upstreamUrl, TENANT_URL: upstreamUrl, AUDIT_URL: upstreamUrl, IAM_URL: upstreamUrl, MASTER_URL: upstreamUrl, PARTY_URL: upstreamUrl, INVENTORY_URL: upstreamUrl, PROCUREMENT_URL: upstreamUrl, QC_URL: upstreamUrl, RATE_LIMIT_PER_IP: '1000', RATE_LIMIT_PER_PRINCIPAL: '1000', SERVICE_CLIENT_SECRET: 'x', ...overrides });
  broker = new InMemoryBroker();
  cache = new MemoryStatusCache();
  gw = createGateway(config, { keys: new StaticKeyProvider(testKeys().publicKeyPem), statusCache: cache, broker, serviceTokens: { tokenFor: async (t) => serviceToken('gateway', t) }, targets: targets as never });
  await gw.start();
  return gw.app;
}

const tamperSignature = (token: string) => {
  const [h, p, sig] = token.split('.');
  const flipped = sig[20] === 'A' ? 'B' : 'A';
  return `${h}.${p}.${sig.slice(0, 20)}${flipped}${sig.slice(21)}`;
};
const legacyToken = (sub = 'user-1', opts: jwt.SignOptions = { expiresIn: '1h' }) => jwt.sign({ email: 'a@b.test' }, LEGACY_SECRET, { subject: sub, ...opts });

function activeTenant(): { tid: string; token: string; mid: string } {
  const tid = randomUUID();
  const mid = randomUUID();
  tenantStatuses.set(tid, { status: 'ACTIVE', version: 2 });
  return { tid, mid, token: tenantToken({ tenantId: tid, membershipId: mid, pv: 3 }) };
}

before(async () => {
  upstreamUrl = await startUpstream();
  await boot();
});
after(async () => {
  await gw.stop();
  upstream.close();
});

describe('correlation id and identity headers', () => {
  it('mints, forwards and echoes the correlation id; reuses an inbound one', async () => {
    const t = activeTenant();
    const res = await request(gw.app).get('/api/v1/purchase-orders').set('Authorization', `Bearer ${t.token}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.match(res.headers['x-correlation-id'], /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}/);
    assert.equal(lastEcho?.headers['x-correlation-id'], res.headers['x-correlation-id']);
    const inbound = await request(gw.app).post('/api/v1/auth/login').set('x-correlation-id', 'client-abc').send({});
    assert.equal(inbound.headers['x-correlation-id'], 'client-abc');
  });

  it('strips identity headers but keeps Authorization and X-Organization-Id', async () => {
    const t = activeTenant();
    const res = await request(gw.app).get('/api/v1/vendors').set('Authorization', `Bearer ${t.token}`).set('X-Organization-Id', 'org-1').set('x-tenant-id', 'evil').set('x-user-id', 'evil').set('x-perms', 'admin').set('x-membership-id', 'evil').set('x-on-behalf-of-tenant', 'evil');
    assert.equal(res.status, 200);
    for (const name of ['x-tenant-id', 'x-user-id', 'x-perms', 'x-membership-id', 'x-on-behalf-of-tenant']) assert.equal(lastEcho!.headers[name], undefined, name);
    assert.equal(lastEcho!.headers['x-organization-id'], 'org-1');
    assert.ok(String(lastEcho!.headers.authorization).startsWith('Bearer '));
  });
});

describe('routing table', () => {
  it('routes auth, public, platform, audit and legacy prefixes to their upstreams with the right rewrites', async () => {
    const t = activeTenant();
    await request(gw.app).post('/api/v1/auth/login').send({ email: 'x' });
    assert.equal(lastEcho?.url, '/api/v1/auth/login');
    await request(gw.app).post('/api/v1/public/vendor-applications').send({});
    assert.equal(lastEcho?.url, '/api/v1/public/vendor-applications');
    await request(gw.app).get('/.well-known/jwks.json');
    assert.equal(lastEcho?.url, '/.well-known/jwks.json');
    const gst = await request(gw.app).get('/api/public/gst/lookup?gstin=06AAHCT0310N1ZG');
    assert.equal(gst.status, 200, 'GSTIN prefill for the application form is public');
    assert.equal(lastEcho?.url, '/api/public/gst/lookup?gstin=06AAHCT0310N1ZG', 'legacy path is passed through unchanged');
    const audit = await request(gw.app).get('/api/v1/audit?action=X').set('Authorization', `Bearer ${t.token}`);
    assert.equal(audit.status, 200);
    assert.equal(lastEcho?.url, '/api/v1/audit?action=X');
    const legacy = await request(gw.app).get('/api/v1/purchase-orders?page=2').set('Authorization', `Bearer ${t.token}`);
    assert.equal(legacy.status, 200);
    assert.equal(lastEcho?.url, '/api/purchase-orders?page=2', '/api/v1 is rewritten for the legacy API');
    const plain = await request(gw.app).post('/api/items').set('Authorization', `Bearer ${t.token}`).send({ name: 'SSD' });
    assert.equal(plain.status, 200);
    assert.deepEqual(JSON.parse(lastEcho!.body), { name: 'SSD' });
  });

  it('retires legacy self-registration with 410 and 404s disabled routes', async () => {
    const gone = await request(gw.app).post('/api/auth/register').send({ email: 'x' });
    assert.equal(gone.status, 410);
    assert.equal(gone.body.error.code, 'ROUTE_RETIRED');
    assert.match(gone.body.error.message, /vendor-applications/);
    const inventory = await request(gw.app).get('/api/v1/inventory/stock').set('Authorization', `Bearer ${activeTenant().token}`);
    assert.equal(inventory.status, 200, 'Phase 4 route enabled');
    const procurement = await request(gw.app).get('/api/v1/procurement/purchase-orders').set('Authorization', `Bearer ${activeTenant().token}`);
    assert.equal(procurement.status, 200, 'Phase 5 route enabled');
    const qc = await request(gw.app).get('/api/v1/qc/lots').set('Authorization', `Bearer ${activeTenant().token}`);
    assert.equal(qc.status, 200, 'Phase 5 route enabled');
    const master = await request(gw.app).get('/api/v1/master/products').set('Authorization', `Bearer ${activeTenant().token}`);
    assert.equal(master.status, 200, 'Phase 3 route enabled');
    const iam = await request(gw.app).get('/api/v1/iam/roles').set('Authorization', `Bearer ${activeTenant().token}`);
    assert.equal(iam.status, 200, 'Phase 2 route enabled');
    assert.equal(lastEcho?.url, '/api/v1/iam/roles');
    const acceptInvite = await request(gw.app).post('/api/v1/iam/invitations/accept').send({ token: 'x' });
    assert.equal(acceptInvite.status, 200, 'invitation acceptance is public');
    assert.equal((await request(gw.app).get('/somewhere')).status, 404);
  });
});

describe('token verification and platform / tenant separation', () => {
  it('accepts RS256 tenant tokens and legacy HS256 tokens; rejects missing, malformed, expired and wrong-key tokens', async () => {
    lastEcho = null;
    assert.equal((await request(gw.app).get('/api/v1/items')).status, 401);
    assert.equal((await request(gw.app).get('/api/v1/items').set('Authorization', 'Bearer not-a-jwt')).status, 401);
    const expired = await request(gw.app).get('/api/v1/items').set('Authorization', `Bearer ${tamperSignature(tenantToken({ tenantId: randomUUID() }))}`);
    assert.equal(expired.status, 401);
    assert.equal(lastEcho, null, 'nothing reached the upstream');
    const legacy = await request(gw.app).get('/api/v1/items').set('Authorization', `Bearer ${legacyToken()}`);
    assert.equal(legacy.status, 200, 'legacy adapter during the overlap window');
    assert.equal((await request(gw.app).get('/api/v1/items').set('Authorization', `Bearer ${legacyToken('u', { expiresIn: -10 })}`)).status, 401);
  });

  it('platform tokens only reach /api/v1/platform; tenant tokens never do', async () => {
    const admin = platformToken();
    const ok = await request(gw.app).get('/api/v1/platform/vendors').set('Authorization', `Bearer ${admin}`);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(lastEcho?.url, '/api/v1/platform/vendors');
    const onTenantRoute = await request(gw.app).get('/api/v1/purchase-orders').set('Authorization', `Bearer ${admin}`);
    assert.equal(onTenantRoute.status, 403);
    assert.equal(onTenantRoute.body.error.code, 'PLATFORM_TOKEN_ON_TENANT_ROUTE');
    const onLegacy = await request(gw.app).get('/api/items').set('Authorization', `Bearer ${admin}`);
    assert.equal(onLegacy.status, 403);
    const tenantOnPlatform = await request(gw.app).get('/api/v1/platform/vendors').set('Authorization', `Bearer ${activeTenant().token}`);
    assert.equal(tenantOnPlatform.status, 403);
    assert.equal(tenantOnPlatform.body.error.code, 'PLATFORM_ONLY');
  });
});

describe('tenant status enforcement', () => {
  it('blocks suspended tenants on every business route within one event, and restores on reactivation', async () => {
    const t = activeTenant();
    assert.equal((await request(gw.app).get('/api/v1/items').set('Authorization', `Bearer ${t.token}`)).status, 200);
    const suspended: EventEnvelope = { eventId: uuidv7(), eventType: EVENT_TYPES.TENANT_SUSPENDED, eventVersion: 1, occurredAt: new Date().toISOString(), tenantId: t.tid, producer: 'svc-tenant', correlationId: 'c', causationId: null, actor: { type: 'user', id: null }, aggregate: { type: 'tenant', id: t.tid, version: 3 }, payload: { tenantId: t.tid, code: 'A', legalName: 'A', displayName: 'A', status: 'SUSPENDED', previousStatus: 'ACTIVE', reason: 'unpaid', ownerName: 'o', ownerEmail: 'o@a.test', actorId: null, occurredAt: new Date().toISOString() } };
    await broker.publish(rk(EVENT_TYPES.TENANT_SUSPENDED), suspended);
    await broker.drain();
    for (const p of ['/api/v1/items', '/api/v1/purchase-orders', '/api/items', '/api/v1/audit']) {
      const res = await request(gw.app).get(p).set('Authorization', `Bearer ${t.token}`);
      assert.equal(res.status, 403, p);
      assert.equal(res.body.error.code, 'TENANT_NOT_ACTIVE');
    }
    // Older event cannot resurrect the tenant.
    await broker.publish(rk(EVENT_TYPES.TENANT_ACTIVATED), { ...suspended, eventId: uuidv7(), eventType: EVENT_TYPES.TENANT_ACTIVATED, aggregate: { type: 'tenant', id: t.tid, version: 2 }, payload: { ...(suspended.payload as object), status: 'ACTIVE' } });
    await broker.drain();
    assert.equal((await request(gw.app).get('/api/v1/items').set('Authorization', `Bearer ${t.token}`)).status, 403);
    await broker.publish(rk(EVENT_TYPES.TENANT_REACTIVATED), { ...suspended, eventId: uuidv7(), eventType: EVENT_TYPES.TENANT_REACTIVATED, aggregate: { type: 'tenant', id: t.tid, version: 4 }, payload: { ...(suspended.payload as object), status: 'ACTIVE' } });
    await broker.drain();
    assert.equal((await request(gw.app).get('/api/v1/items').set('Authorization', `Bearer ${t.token}`)).status, 200);
  });

  it('falls back to svc-tenant on a cache miss and treats unknown tenants as not active', async () => {
    const tid = randomUUID();
    tenantStatuses.set(tid, { status: 'SUSPENDED', version: 1 });
    const res = await request(gw.app).get('/api/v1/items').set('Authorization', `Bearer ${tenantToken({ tenantId: tid })}`);
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'TENANT_NOT_ACTIVE');
    assert.deepEqual(await cache.get(cacheKeys.tenantStatus(tid)), { value: 'SUSPENDED', version: 1 }, 'lookup result is cached');
    const unknown = await request(gw.app).get('/api/v1/items').set('Authorization', `Bearer ${tenantToken({ tenantId: randomUUID() })}`);
    assert.equal(unknown.status, 403);
  });

  it('enforces permission version and member status from iam events (Phase 2 hooks)', async () => {
    const t = activeTenant();
    assert.equal((await request(gw.app).get('/api/v1/items').set('Authorization', `Bearer ${t.token}`)).status, 200);
    const base = { eventId: uuidv7(), eventVersion: 1, occurredAt: new Date().toISOString(), tenantId: t.tid, producer: 'svc-iam', correlationId: 'c', causationId: null, actor: { type: 'user' as const, id: null } };
    await broker.publish(rk(EVENT_TYPES.IAM_PERMISSIONS_CHANGED), { ...base, eventType: EVENT_TYPES.IAM_PERMISSIONS_CHANGED, aggregate: { type: 'role', id: randomUUID(), version: 1 }, payload: { tenantId: t.tid, memberships: [{ membershipId: t.mid, permissionVersion: 4 }], roleId: null, roleKey: null, reason: 'role changed' } });
    await broker.drain();
    const stale = await request(gw.app).get('/api/v1/items').set('Authorization', `Bearer ${t.token}`);
    assert.equal(stale.status, 401);
    assert.equal(stale.body.error.code, 'PERMISSIONS_STALE');
    const refreshed = tenantToken({ tenantId: t.tid, membershipId: t.mid, pv: 4 });
    assert.equal((await request(gw.app).get('/api/v1/items').set('Authorization', `Bearer ${refreshed}`)).status, 200);

    await broker.publish(rk(EVENT_TYPES.IAM_MEMBERSHIP_SUSPENDED), { ...base, eventId: uuidv7(), eventType: EVENT_TYPES.IAM_MEMBERSHIP_SUSPENDED, aggregate: { type: 'membership', id: t.mid, version: 2 }, payload: { membershipId: t.mid, tenantId: t.tid, userId: randomUUID(), status: 'SUSPENDED', roleKeys: [], permissionVersion: 5 } });
    await broker.drain();
    const suspended = await request(gw.app).get('/api/v1/items').set('Authorization', `Bearer ${refreshed}`);
    assert.equal(suspended.status, 403);
    assert.equal(suspended.body.error.code, 'MEMBER_SUSPENDED');
  });
});

describe('limits and failures', () => {
  it('rejects oversized bodies, rate limits per principal, and wraps upstream outages', async () => {
    const t = activeTenant();
    const big = await boot({ BODY_LIMIT_BYTES: '10' });
    assert.equal((await request(big).post('/api/items').set('Authorization', `Bearer ${t.token}`).send({ name: 'this body is longer than ten bytes' })).status, 413);
    await gw.stop();

    const limited = await boot({ RATE_LIMIT_PER_PRINCIPAL: '3' });
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push((await request(limited).get('/api/v1/items').set('Authorization', `Bearer ${t.token}`)).status);
    assert.deepEqual(results, [200, 200, 200, 429]);
    await gw.stop();

    const down = await boot({}, { 'legacy-api': 'http://127.0.0.1:1' });
    const res = await request(down).get('/api/v1/items').set('Authorization', `Bearer ${t.token}`);
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'UPSTREAM_UNAVAILABLE');
    assert.equal(res.body.error.retryable, true);
    await gw.stop();
    await boot();
    const passthrough = await request(gw.app).get('/api/boom').set('Authorization', `Bearer ${t.token}`);
    assert.equal(passthrough.status, 500);
    assert.match(passthrough.text, /legacy crashed/);
  });

  it('reports health of the gateway and its upstreams', async () => {
    assert.equal((await request(gw.app).get('/health/live')).status, 200);
    const ready = await request(gw.app).get('/health/ready');
    assert.equal(ready.status, 200, JSON.stringify(ready.body));
    assert.deepEqual(ready.body.checks, { 'legacy-api': 'ok', 'svc-auth': 'ok', 'svc-tenant': 'ok' });
    const down = await boot({}, { 'svc-tenant': 'http://127.0.0.1:1' });
    const notReady = await request(down).get('/health/ready');
    assert.equal(notReady.status, 503);
    assert.equal(notReady.body.checks['svc-tenant'], 'down');
    await gw.stop();
    await boot();
  });
});
