/**
 * svc-audit: exactly-once recording (inbox + unique event id), tenant-scoped queries under RLS
 * with the NOBYPASSRLS runtime role, platform-wide queries for services and platform admins.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { EVENT_TYPES, rk } from '@b2b/contracts';
import { StaticKeyProvider, loadEnv, uuidv7, type EventEnvelope } from '@b2b/platform-kit';
import { InMemoryBroker, platformToken, serviceToken, tenantToken, testKeys, truncateAll } from '@b2b/test-kit';
import { auditEnvSchema } from '../src/config.js';
import { countVisibleAs } from '../src/modules/audit.js';
import { createAuditRuntime, type AuditRuntime } from '../src/service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let rt: AuditRuntime;
let broker: InMemoryBroker;
const tenantA = randomUUID();
const tenantB = randomUUID();

function auditEvent(tenantId: string | null, action: string, extra: Record<string, unknown> = {}): EventEnvelope {
  return {
    eventId: uuidv7(), eventType: EVENT_TYPES.AUDIT_RECORDED, eventVersion: 1, occurredAt: new Date().toISOString(), tenantId, producer: 'svc-test', correlationId: `corr-${action}`, causationId: null,
    actor: { type: 'user', id: randomUUID(), name: 'Tester' }, aggregate: { type: 'purchase_order', id: randomUUID(), version: 1 },
    payload: { action, entityType: 'PURCHASE_ORDER', entityId: randomUUID(), summary: `${action} happened`, oldValue: { status: 'A' }, newValue: { status: 'B' }, ...extra },
  };
}

before(async () => {
  const env = loadEnv(auditEnvSchema, { dir: path.resolve(here, '..') });
  await truncateAll(env.MIGRATE_DATABASE_URL!);
  broker = new InMemoryBroker();
  rt = await createAuditRuntime(env, { broker, keys: new StaticKeyProvider(testKeys().publicKeyPem) });
  await rt.start();
});
after(async () => {
  await rt.stop();
});

describe('recording', () => {
  it('stores each audit event once even when delivered three times', async () => {
    const e = auditEvent(tenantA, 'PO_CREATED');
    for (let i = 0; i < 3; i += 1) await broker.publish(rk(EVENT_TYPES.AUDIT_RECORDED), e);
    await broker.drain();
    assert.equal(await countVisibleAs(rt.prisma, null), 1);
    await broker.publish(rk(EVENT_TYPES.AUDIT_RECORDED), auditEvent(tenantA, 'PO_ISSUED'));
    await broker.publish(rk(EVENT_TYPES.AUDIT_RECORDED), auditEvent(tenantB, 'GRN_CREATED'));
    await broker.publish(rk(EVENT_TYPES.AUDIT_RECORDED), auditEvent(null, 'TENANT_SUSPENDED', { reason: 'unpaid' }));
    await broker.drain();
    assert.equal(await countVisibleAs(rt.prisma, null), 4);
    assert.equal(broker.deadLetters.length, 0);
  });
});

describe('tenant isolation (RLS with the runtime role)', () => {
  it('a tenant sees only its own rows, by API and by raw SQL under its context', async () => {
    assert.equal(await countVisibleAs(rt.prisma, tenantA), 2);
    assert.equal(await countVisibleAs(rt.prisma, tenantB), 1);
    assert.equal(await countVisibleAs(rt.prisma, randomUUID()), 0);

    const a = await request(rt.app).get('/api/v1/audit').set('Authorization', `Bearer ${tenantToken({ tenantId: tenantA })}`);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.deepEqual(a.body.data.map((r: { action: string }) => r.action).sort(), ['PO_CREATED', 'PO_ISSUED']);
    assert.ok(a.body.data.every((r: { tenantId: string }) => r.tenantId === tenantA));
    const b = await request(rt.app).get('/api/v1/audit').set('Authorization', `Bearer ${tenantToken({ tenantId: tenantB })}`);
    assert.deepEqual(b.body.data.map((r: { action: string }) => r.action), ['GRN_CREATED']);

    const noPerm = await request(rt.app).get('/api/v1/audit').set('Authorization', `Bearer ${tenantToken({ tenantId: tenantA, perms: ['purchase.view'] })}`);
    assert.equal(noPerm.status, 403);
    const platformOnTenantRoute = await request(rt.app).get('/api/v1/audit').set('Authorization', `Bearer ${platformToken()}`);
    assert.equal(platformOnTenantRoute.status, 401, 'platform tokens are not accepted on the tenant route');
  });

  it('platform admins and services query across tenants with filters and paging', async () => {
    const all = await request(rt.app).get('/internal/v1/audit-events?limit=2').set('Authorization', `Bearer ${platformToken()}`);
    assert.equal(all.status, 200, JSON.stringify(all.body));
    assert.equal(all.body.data.length, 2);
    assert.ok(all.body.nextCursor);
    const next = await request(rt.app).get(`/internal/v1/audit-events?limit=2&cursor=${encodeURIComponent(all.body.nextCursor)}`).set('Authorization', `Bearer ${platformToken()}`);
    assert.equal(next.body.data.length, 2);
    assert.equal(next.body.nextCursor, null);
    const filtered = await request(rt.app).get(`/internal/v1/audit-events?tenantId=${tenantB}`).set('Authorization', `Bearer ${serviceToken('svc-tenant', 'svc-audit')}`);
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.data.length, 1);
    const byAction = await request(rt.app).get('/internal/v1/audit-events?action=TENANT_SUSPENDED').set('Authorization', `Bearer ${platformToken()}`);
    assert.equal(byAction.body.data.length, 1);
    assert.equal(byAction.body.data[0].reason, 'unpaid');
    assert.equal(byAction.body.data[0].tenantId, null);
    const support = await request(rt.app).get('/internal/v1/audit-events').set('Authorization', `Bearer ${platformToken({ perms: ['platform.tenant.view'] })}`);
    assert.equal(support.status, 403);
    const tenantOnInternal = await request(rt.app).get('/internal/v1/audit-events').set('Authorization', `Bearer ${tenantToken({ tenantId: tenantA })}`);
    assert.equal(tenantOnInternal.status, 401);
  });

  it('the runtime role cannot update or delete audit rows (append-only)', async () => {
    await assert.rejects(rt.prisma.$executeRaw`UPDATE "audit_events" SET "summary" = 'tampered'`, /permission denied/);
    await assert.rejects(rt.prisma.$executeRaw`DELETE FROM "audit_events"`, /permission denied/);
  });
});
