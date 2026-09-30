/**
 * svc-tenant (phase-01 step 9): state machine matrix, 4-eyes approval, duplicate GSTIN,
 * idempotent create, concurrent approvals, If-Match versioning, platform-only access, public
 * application flow, internal status endpoint, events and history.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { EVENT_TYPES } from '@b2b/contracts';
import { StaticKeyProvider, loadEnv, type EventEnvelope } from '@b2b/platform-kit';
import { InMemoryBroker, platformToken, serviceToken, tenantToken, testKeys, truncateAll } from '@b2b/test-kit';
import { tenantEnvSchema } from '../src/config.js';
import { createTenantRuntime, type TenantRuntime } from '../src/service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let rt: TenantRuntime;
let broker: InMemoryBroker;

const ADMIN_A = randomUUID();
const ADMIN_B = randomUUID();
const tokenA = platformToken({ userId: ADMIN_A, name: 'Admin A' });
const tokenB = platformToken({ userId: ADMIN_B, name: 'Admin B' });
const reviewer = platformToken({ userId: randomUUID(), perms: ['platform.tenant.view', 'platform.tenant.approve', 'platform.dashboard.view'] });

async function boot(overrides: Record<string, unknown> = {}) {
  const env = { ...loadEnv(tenantEnvSchema, { dir: path.resolve(here, '..') }), ...overrides };
  await truncateAll(env.MIGRATE_DATABASE_URL!);
  broker = new InMemoryBroker();
  rt = await createTenantRuntime(env, { broker, keys: new StaticKeyProvider(testKeys().publicKeyPem) });
  await rt.start();
}

let seq = 0;
function tenantPayload(overrides: Record<string, unknown> = {}) {
  seq += 1;
  return {
    legalName: `Acme Traders ${seq} Pvt Ltd`,
    displayName: `Acme ${seq}`,
    pan: 'AAPFU0939F',
    gstin: null,
    registeredAddress: { line1: '12 MIDC Road', city: 'Pune', state: 'Maharashtra', stateCode: '27', pincode: '411001', country: 'IN' },
    ownerName: 'Ravi Kumar',
    ownerEmail: `owner${seq}@acme.test`,
    ownerPhone: '9876543210',
    ...overrides,
  };
}

const api = (token: string) => ({
  post: (p: string, body: unknown = {}) => request(rt.app).post(p).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', randomUUID()).send(body as object),
  get: (p: string) => request(rt.app).get(p).set('Authorization', `Bearer ${token}`),
  patch: (p: string, body: unknown, version?: number) => {
    const r = request(rt.app).patch(p).set('Authorization', `Bearer ${token}`);
    return (version !== undefined ? r.set('If-Match', String(version)) : r).send(body as object);
  },
});

async function createPending(token = tokenA, overrides = {}) {
  const res = await api(token).post('/api/v1/platform/vendors', tenantPayload(overrides));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data as { id: string; code: string; status: string; version: number };
}

async function activeTenant() {
  const t = await createPending(tokenA);
  assert.equal((await api(tokenB).post(`/api/v1/platform/vendors/${t.id}/approve`)).status, 200);
  const act = await api(tokenB).post(`/api/v1/platform/vendors/${t.id}/activate`);
  assert.equal(act.status, 200, JSON.stringify(act.body));
  return act.body.data as { id: string; code: string; status: string; version: number };
}

async function events(type: string, tenantId?: string): Promise<EventEnvelope[]> {
  const rows = await rt.prisma.outboxEvent.findMany({ where: { eventType: type, ...(tenantId ? { tenantId } : {}) }, orderBy: { createdAt: 'asc' } });
  return rows.map((r) => r.envelope as unknown as EventEnvelope);
}

before(async () => {
  await boot();
});
after(async () => {
  await rt.stop();
});

describe('create', () => {
  it('creates a PENDING tenant with a generated code, history row and events', async () => {
    const t = await createPending(tokenA, { displayName: 'Bright Star Traders' });
    assert.equal(t.status, 'PENDING');
    assert.equal(t.version, 0);
    assert.match(t.code, /^BRIGSTARTRAD/);
    const detail = await api(tokenA).get(`/api/v1/platform/vendors/${t.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.history.length, 1);
    assert.equal(detail.body.data.history[0].toStatus, 'PENDING');
    assert.equal(detail.body.data.settings.baseCurrency, 'INR');
    assert.equal(detail.body.data.stateCode, '27', 'state code from the address when no GSTIN');
    const created = await events(EVENT_TYPES.TENANT_CREATED, t.id);
    assert.equal(created.length, 1);
    assert.equal(created[0].aggregate.version, 0);
    assert.equal((created[0].payload as { status: string }).status, 'PENDING');
  });

  it('validates input and rejects duplicate GSTINs', async () => {
    const bad = await api(tokenA).post('/api/v1/platform/vendors', tenantPayload({ gstin: 'INVALID', ownerEmail: 'not-an-email' }));
    assert.equal(bad.status, 422);
    assert.equal(bad.body.error.code, 'VALIDATION_FAILED');
    assert.ok(bad.body.error.details.some((d: { path: string }) => d.path === 'gstin'));
    assert.ok(bad.body.error.details.some((d: { path: string }) => d.path === 'ownerEmail'));

    const gstin = '27AAPFU0939F1ZV';
    const first = await api(tokenA).post('/api/v1/platform/vendors', tenantPayload({ gstin }));
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.data.stateCode, '27');
    const dup = await api(tokenA).post('/api/v1/platform/vendors', tenantPayload({ gstin }));
    assert.equal(dup.status, 422);
    assert.equal(dup.body.error.code, 'TENANT_DUPLICATE_GSTIN');
    // A rejected tenant frees its GSTIN.
    await api(tokenB).post(`/api/v1/platform/vendors/${first.body.data.id}/reject`, { reason: 'duplicate application' });
    const again = await api(tokenA).post('/api/v1/platform/vendors', tenantPayload({ gstin }));
    assert.equal(again.status, 201, JSON.stringify(again.body));
  });

  it('replays the same Idempotency-Key and creates exactly one tenant', async () => {
    const key = randomUUID();
    const body = tenantPayload({ displayName: 'Idem Traders' });
    const send = () => request(rt.app).post('/api/v1/platform/vendors').set('Authorization', `Bearer ${tokenA}`).set('Idempotency-Key', key).send(body);
    const first = await send();
    const second = await send();
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(second.headers['idempotent-replayed'], 'true');
    assert.deepEqual(second.body, first.body);
    assert.equal(await rt.prisma.tenant.count({ where: { displayName: 'Idem Traders' } }), 1);
    const missing = await request(rt.app).post('/api/v1/platform/vendors').set('Authorization', `Bearer ${tokenA}`).send(body);
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  });
});

describe('state machine', () => {
  it('walks every allowed transition and refuses a forbidden one from each state', async () => {
    const t = await createPending(tokenA);
    const id = t.id;
    const cmd = (command: string, token = tokenB, body: Record<string, unknown> = {}) => api(token).post(`/api/v1/platform/vendors/${id}/${command}`, body);

    // PENDING: activate / suspend / reactivate / deactivate forbidden
    for (const c of ['activate', 'suspend', 'reactivate']) {
      const r = await cmd(c, tokenB, { reason: 'not allowed here' });
      assert.equal(r.status, 409, `${c} from PENDING: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.error.code, 'TENANT_INVALID_TRANSITION');
    }
    // 4-eyes: creator cannot approve
    const self = await cmd('approve', tokenA);
    assert.equal(self.status, 422);
    assert.equal(self.body.error.code, 'TENANT_FOUR_EYES');
    const approved = await cmd('approve', tokenB, { note: 'KYC ok' });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.data.status, 'APPROVED');
    assert.equal(approved.body.data.version, 1);
    assert.equal(approved.body.data.approvedBy, ADMIN_B);

    // APPROVED: approve again / reject / suspend forbidden
    for (const c of ['approve', 'reject', 'suspend']) assert.equal((await cmd(c, tokenB, { reason: 'not allowed here' })).status, 409, c);
    const active = await cmd('activate');
    assert.equal(active.status, 200);
    assert.equal(active.body.data.status, 'ACTIVE');
    assert.ok(active.body.data.activatedAt);

    // ACTIVE: activate / approve / reactivate forbidden; suspend needs a reason
    for (const c of ['activate', 'approve', 'reactivate']) assert.equal((await cmd(c, tokenB, { reason: 'not allowed here' })).status, 409, c);
    const noReason = await cmd('suspend', tokenB, {});
    assert.equal(noReason.status, 422);
    const suspended = await cmd('suspend', tokenB, { reason: 'unpaid invoices' });
    assert.equal(suspended.status, 200);
    assert.equal(suspended.body.data.status, 'SUSPENDED');
    assert.equal(suspended.body.data.statusReason, 'unpaid invoices');

    // SUSPENDED: suspend again forbidden; reactivate restores
    assert.equal((await cmd('suspend', tokenB, { reason: 'still suspended' })).status, 409);
    const reactivated = await cmd('reactivate', tokenB, { reason: 'paid' });
    assert.equal(reactivated.status, 200);
    assert.equal(reactivated.body.data.status, 'ACTIVE');

    // deactivate needs the typed code
    const wrongCode = await cmd('deactivate', tokenB, { reason: 'closing', confirmCode: 'NOPE' });
    assert.equal(wrongCode.status, 422);
    assert.equal(wrongCode.body.error.code, 'TENANT_CONFIRM_CODE_MISMATCH');
    const deactivated = await cmd('deactivate', tokenB, { reason: 'closing', confirmCode: t.code });
    assert.equal(deactivated.status, 200);
    assert.equal(deactivated.body.data.status, 'DEACTIVATED');
    // terminal
    for (const c of ['approve', 'activate', 'suspend', 'reactivate', 'deactivate']) assert.equal((await cmd(c, tokenB, { reason: 'terminal state', confirmCode: t.code })).status, 409, c);
    const edit = await api(tokenB).patch(`/api/v1/platform/vendors/${id}`, { displayName: 'Nope' });
    assert.equal(edit.status, 409, 'deactivated tenants are frozen');

    const detail = await api(tokenA).get(`/api/v1/platform/vendors/${id}`);
    assert.deepEqual(detail.body.data.history.map((h: { toStatus: string }) => h.toStatus), ['PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'ACTIVE', 'DEACTIVATED']);
    assert.equal(detail.body.data.version, 5);
    // Data is retained.
    assert.equal(detail.body.data.legalName.length > 0, true);

    const lifecycle = await rt.prisma.outboxEvent.findMany({ where: { tenantId: id, eventType: { startsWith: 'tenant.tenant.' } }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(lifecycle.map((e) => e.eventType), [EVENT_TYPES.TENANT_CREATED, EVENT_TYPES.TENANT_APPROVED, EVENT_TYPES.TENANT_ACTIVATED, EVENT_TYPES.TENANT_SUSPENDED, EVENT_TYPES.TENANT_REACTIVATED, EVENT_TYPES.TENANT_DEACTIVATED]);
    assert.deepEqual(lifecycle.map((e) => (e.envelope as unknown as EventEnvelope).aggregate.version), [0, 1, 2, 3, 4, 5], 'versions let consumers drop stale events');
    const audits = await events(EVENT_TYPES.AUDIT_RECORDED, id);
    assert.ok(audits.some((a) => (a.payload as { action: string }).action === 'TENANT_SUSPENDED' && (a.payload as { reason: string }).reason === 'unpaid invoices'));
  });

  it('rejects a pending tenant (terminal) and requires a reason', async () => {
    const t = await createPending(tokenA);
    assert.equal((await api(tokenB).post(`/api/v1/platform/vendors/${t.id}/reject`, {})).status, 422);
    const rejected = await api(tokenB).post(`/api/v1/platform/vendors/${t.id}/reject`, { reason: 'incomplete documents' });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.data.status, 'REJECTED');
    assert.equal((await api(tokenB).post(`/api/v1/platform/vendors/${t.id}/approve`)).status, 409);
  });

  it('two admins approving simultaneously: one wins, the other gets 409', async () => {
    const t = await createPending(tokenA);
    const other = platformToken({ userId: randomUUID(), name: 'Admin C' });
    const [a, b] = await Promise.all([api(tokenB).post(`/api/v1/platform/vendors/${t.id}/approve`), api(other).post(`/api/v1/platform/vendors/${t.id}/approve`)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], JSON.stringify([a.body, b.body]));
    assert.equal((await rt.prisma.tenant.findUniqueOrThrow({ where: { id: t.id } })).version, 1);
    assert.equal(await rt.prisma.tenantStatusHistory.count({ where: { tenantId: t.id, toStatus: 'APPROVED' } }), 1);
  });

  it('lets the creator approve when four-eyes is switched off', async () => {
    await rt.stop();
    await boot({ TENANT_FOUR_EYES: 'off' });
    try {
      const t = await createPending(tokenA);
      assert.equal((await api(tokenA).post(`/api/v1/platform/vendors/${t.id}/approve`)).status, 200);
    } finally {
      await rt.stop();
      await boot();
    }
  });
});

describe('profile edits', () => {
  it('uses If-Match for optimistic concurrency and never changes status through PATCH', async () => {
    const t = await createPending(tokenA);
    const stale = await api(tokenA).patch(`/api/v1/platform/vendors/${t.id}`, { displayName: 'Renamed' }, 7);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'VERSION_CONFLICT');
    const ok = await api(tokenA).patch(`/api/v1/platform/vendors/${t.id}`, { displayName: 'Renamed', status: 'ACTIVE' }, 0);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.data.displayName, 'Renamed');
    assert.equal(ok.body.data.status, 'PENDING', 'status is not editable');
    assert.equal(ok.body.data.version, 1);
    const noop = await api(tokenA).patch(`/api/v1/platform/vendors/${t.id}`, { displayName: 'Renamed' }, 1);
    assert.equal(noop.body.data.version, 1, 'no-op edits do not bump the version');
    const audits = await events(EVENT_TYPES.AUDIT_RECORDED, t.id);
    const upd = audits.find((a) => (a.payload as { action: string }).action === 'TENANT_UPDATED');
    assert.ok(upd);
    assert.deepEqual((upd!.payload as { newValue: unknown }).newValue, { displayName: 'Renamed' });
  });
});

describe('authorization', () => {
  it('requires a platform token with the right permission; tenant tokens are refused', async () => {
    const t = await createPending(tokenA);
    const anon = await request(rt.app).get('/api/v1/platform/vendors');
    assert.equal(anon.status, 401);
    const tenant = await request(rt.app).get('/api/v1/platform/vendors').set('Authorization', `Bearer ${tenantToken({ tenantId: randomUUID() })}`);
    assert.equal(tenant.status, 403);
    assert.equal(tenant.body.error.code, 'PLATFORM_ONLY');
    const denied = await api(reviewer).post(`/api/v1/platform/vendors/${t.id}/activate`);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error.code, 'FORBIDDEN');
    assert.equal(denied.body.error.details[0].message, 'platform.tenant.activate');
    assert.equal((await api(reviewer).get('/api/v1/platform/vendors')).status, 200);
    assert.equal((await api(reviewer).post(`/api/v1/platform/vendors/${t.id}/approve`)).status, 200);
    const unknown = await api(tokenA).get(`/api/v1/platform/vendors/${randomUUID()}`);
    assert.equal(unknown.status, 404);
    const malformed = await api(tokenA).get('/api/v1/platform/vendors/not-a-uuid');
    assert.equal(malformed.status, 404);
  });
});

describe('public application', () => {
  it('creates a PENDING tenant that cannot become ACTIVE without admin actions', async () => {
    const body = tenantPayload({ displayName: 'Applicant Co' });
    const res = await request(rt.app).post('/api/v1/public/vendor-applications').send(body);
    assert.equal(res.status, 202, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'PENDING');
    assert.equal(res.body.data.id, undefined, 'no tenant id leaks to applicants');
    const row = await rt.prisma.tenant.findFirstOrThrow({ where: { displayName: 'Applicant Co' } });
    assert.equal(row.source, 'APPLICATION');
    assert.equal(await rt.prisma.vendorApplication.count({ where: { tenantId: row.id } }), 1);
    // Nothing public can move it; only the platform transitions can.
    for (const c of ['approve', 'activate']) {
      const r = await request(rt.app).post(`/api/v1/platform/vendors/${row.id}/${c}`).send({});
      assert.equal(r.status, 401, c);
    }
    assert.equal((await rt.prisma.tenant.findUniqueOrThrow({ where: { id: row.id } })).status, 'PENDING');
  });
});

describe('internal, list and dashboard', () => {
  it('exposes tenant status to services only', async () => {
    const t = await activeTenant();
    const svc = await request(rt.app).get(`/internal/v1/tenants/${t.id}/status`).set('Authorization', `Bearer ${serviceToken('gateway', 'svc-tenant')}`);
    assert.equal(svc.status, 200, JSON.stringify(svc.body));
    assert.deepEqual(svc.body.data, { status: 'ACTIVE', version: 2 });
    const wrongAud = await request(rt.app).get(`/internal/v1/tenants/${t.id}/status`).set('Authorization', `Bearer ${serviceToken('gateway', 'svc-iam')}`);
    assert.equal(wrongAud.status, 401);
    const platform = await request(rt.app).get(`/internal/v1/tenants/${t.id}/status`).set('Authorization', `Bearer ${tokenA}`);
    assert.equal(platform.status, 401, 'only service tokens on internal routes');
    const missing = await request(rt.app).get(`/internal/v1/tenants/${randomUUID()}/status`).set('Authorization', `Bearer ${serviceToken('gateway', 'svc-tenant')}`);
    assert.equal(missing.status, 404);
  });

  it('lists with filters and cursor pagination; dashboard counts by status', async () => {
    const page1 = await api(tokenA).get('/api/v1/platform/vendors?limit=3');
    assert.equal(page1.status, 200);
    assert.equal(page1.body.data.length, 3);
    assert.ok(page1.body.nextCursor);
    const page2 = await api(tokenA).get(`/api/v1/platform/vendors?limit=3&cursor=${encodeURIComponent(page1.body.nextCursor)}`);
    assert.equal(page2.status, 200);
    const ids1 = page1.body.data.map((t: { id: string }) => t.id);
    assert.ok(page2.body.data.every((t: { id: string }) => !ids1.includes(t.id)), 'pages do not overlap');
    const pending = await api(tokenA).get('/api/v1/platform/vendors?status=PENDING');
    assert.ok(pending.body.data.every((t: { status: string }) => t.status === 'PENDING'));
    const search = await api(tokenA).get('/api/v1/platform/vendors?q=applicant');
    assert.equal(search.body.data.length, 1);
    const dash = await api(tokenA).get('/api/v1/platform/dashboard');
    assert.equal(dash.status, 200);
    assert.equal(dash.body.data.counts.PENDING, pending.body.data.length);
    assert.ok(dash.body.data.recentActions.length > 0);
  });

  it('resends the owner invite for active tenants only', async () => {
    const t = await activeTenant();
    const ok = await api(tokenB).post(`/api/v1/platform/vendors/${t.id}/resend-owner-invite`);
    assert.equal(ok.status, 200);
    assert.equal((await events(EVENT_TYPES.TENANT_OWNER_INVITE_REQUESTED, t.id)).length, 1);
    const pending = await createPending(tokenA);
    assert.equal((await api(tokenB).post(`/api/v1/platform/vendors/${pending.id}/resend-owner-invite`)).status, 409);
  });
});
