import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { EVENT_TYPES, rk } from '@b2b/contracts';
import { StaticKeyProvider, loadEnv, uuidv7, type EventEnvelope } from '@b2b/platform-kit';
import { InMemoryBroker, platformToken, serviceToken, tenantToken, testKeys, truncateAll } from '@b2b/test-kit';
import { notificationEnvSchema } from '../src/config.js';
import { LogTransport } from '../src/modules/transport.js';
import { createNotificationRuntime, type NotificationRuntime } from '../src/service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let rt: NotificationRuntime;
let broker: InMemoryBroker;
let transport: LogTransport;

function envelope(type: string, tenantId: string | null, payload: Record<string, unknown>): EventEnvelope {
  return { eventId: uuidv7(), eventType: type, eventVersion: 1, occurredAt: new Date().toISOString(), tenantId, producer: 'svc-test', correlationId: 'corr-1', causationId: null, actor: { type: 'system', id: null }, aggregate: { type: 'tenant', id: tenantId ?? randomUUID(), version: 1 }, payload };
}
const tenantPayload = (extra: Record<string, unknown> = {}) => ({ tenantId: randomUUID(), code: 'ACME', legalName: 'Acme Pvt Ltd', displayName: 'Acme', status: 'PENDING', previousStatus: null, reason: null, ownerName: 'Ravi', ownerEmail: 'ravi@acme.test', actorId: null, occurredAt: new Date().toISOString(), ...extra });

before(async () => {
  const env = loadEnv(notificationEnvSchema, { dir: path.resolve(here, '..') });
  await truncateAll(env.MIGRATE_DATABASE_URL!);
  broker = new InMemoryBroker();
  transport = new LogTransport();
  rt = await createNotificationRuntime(env, { broker, keys: new StaticKeyProvider(testKeys().publicKeyPem), transport });
  await rt.start();
});
after(async () => {
  await rt.stop();
});

describe('dispatch', () => {
  it('sends the owner invite with the accept link and logs one delivery per event', async () => {
    const e = envelope(EVENT_TYPES.AUTH_OWNER_INVITED, randomUUID(), { userId: randomUUID(), tenantId: randomUUID(), email: 'owner@acme.test', fullName: 'Owner', inviteToken: 'tok_abc', expiresAt: new Date().toISOString(), alreadyActive: false });
    await broker.publish(rk(EVENT_TYPES.AUTH_OWNER_INVITED), e);
    await broker.publish(rk(EVENT_TYPES.AUTH_OWNER_INVITED), e);
    await broker.drain();
    assert.equal(transport.sent.length, 1);
    assert.equal(transport.sent[0].to, 'owner@acme.test');
    assert.match(transport.sent[0].text, /http:\/\/app\.test\/accept-invite\?token=tok_abc/);
    const rows = await rt.prisma.delivery.findMany();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'SENT');
    assert.equal(rows[0].template, 'auth.owner_invite');
  });

  it('acknowledges public applications but not admin-created tenants; suspension mails carry the reason', async () => {
    await broker.publish(rk(EVENT_TYPES.TENANT_CREATED), envelope(EVENT_TYPES.TENANT_CREATED, null, tenantPayload({ source: 'APPLICATION', ownerEmail: 'applicant@acme.test' })));
    await broker.publish(rk(EVENT_TYPES.TENANT_CREATED), envelope(EVENT_TYPES.TENANT_CREATED, null, tenantPayload({ source: 'ADMIN_CREATED', ownerEmail: 'admincreated@acme.test' })));
    await broker.publish(rk(EVENT_TYPES.TENANT_SUSPENDED), envelope(EVENT_TYPES.TENANT_SUSPENDED, null, tenantPayload({ status: 'SUSPENDED', reason: 'unpaid invoices', ownerEmail: 'susp@acme.test' })));
    await broker.drain();
    const templates = transport.sent.map((m) => `${m.template}:${m.to}`);
    assert.ok(templates.includes('tenant.application_received:applicant@acme.test'));
    assert.ok(!templates.some((t) => t.endsWith('admincreated@acme.test')));
    const susp = transport.sent.find((m) => m.to === 'susp@acme.test');
    assert.match(susp!.text, /unpaid invoices/);
  });

  it('records FAILED when the transport is down and does not dead-letter', async () => {
    transport.failing = true;
    await broker.publish(rk(EVENT_TYPES.AUTH_PASSWORD_RESET_REQUESTED), envelope(EVENT_TYPES.AUTH_PASSWORD_RESET_REQUESTED, null, { userId: randomUUID(), email: 'reset@acme.test', fullName: 'R', resetToken: 'rt_1', expiresAt: new Date().toISOString() }));
    await broker.drain();
    transport.failing = false;
    const row = await rt.prisma.delivery.findFirstOrThrow({ where: { recipient: 'reset@acme.test' } });
    assert.equal(row.status, 'FAILED');
    assert.match(row.error ?? '', /smtp unavailable/);
    assert.equal(broker.deadLetters.length, 0);
  });

  it('exposes the delivery log to services and platform admins only', async () => {
    const svc = await request(rt.app).get('/internal/v1/deliveries?recipient=owner@acme.test').set('Authorization', `Bearer ${serviceToken('svc-tenant', 'svc-notification')}`);
    assert.equal(svc.status, 200, JSON.stringify(svc.body));
    assert.equal(svc.body.data.length, 1);
    assert.equal((await request(rt.app).get('/internal/v1/deliveries').set('Authorization', `Bearer ${platformToken()}`)).status, 200);
    assert.equal((await request(rt.app).get('/internal/v1/deliveries').set('Authorization', `Bearer ${tenantToken({ tenantId: randomUUID() })}`)).status, 401);
  });
});
