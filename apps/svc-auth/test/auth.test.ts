/**
 * svc-auth (phase-01 step 9): login, lockout, MFA, tenant selection, refresh rotation + reuse
 * detection, tenant suspension effects, password reset, owner invites from tenant events,
 * service tokens, rate limiting, legacy bcrypt rehash.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import request from 'supertest';
import { EVENT_TYPES, TENANT_PERMISSION_CODES, rk } from '@b2b/contracts';
import { StaticKeyProvider, createTokenVerifier, uuidv7, type EventEnvelope } from '@b2b/platform-kit';
import { settleEvents } from '@b2b/test-kit';
import { hashPassword } from '../src/modules/passwords.js';
import { bootAuth, type FakeTenantStatus } from './setup.js';
import type { AuthRuntime } from '../src/service.js';
import type { InMemoryBroker } from '@b2b/test-kit';

let rt: AuthRuntime;
let broker: InMemoryBroker;
let tenantStatus: FakeTenantStatus;
const PASSWORD = 'Str0ngPassword1';

async function seedTenantUser(email: string, tenantIds: string[], opts: { algo?: 'argon2id' | 'bcrypt'; password?: string } = {}) {
  const pw = opts.password ?? PASSWORD;
  const id = uuidv7();
  await rt.prisma.user.create({
    data: { id, email, fullName: `User ${email}`, userType: 'TENANT', status: 'ACTIVE', passwordAlgo: opts.algo ?? 'argon2id', passwordHash: opts.algo === 'bcrypt' ? await bcrypt.hash(pw, 10) : await hashPassword(pw) },
  });
  for (const tenantId of tenantIds) {
    await rt.prisma.tenantMembershipBootstrap.create({ data: { id: uuidv7(), tenantId, userId: id, role: 'OWNER', status: 'ACTIVE' } });
    if (!tenantStatus.statuses.has(tenantId)) tenantStatus.set(tenantId, 'ACTIVE');
  }
  return id;
}

async function seedPlatformAdmin(email: string) {
  const id = uuidv7();
  await rt.prisma.user.create({ data: { id, email, fullName: 'Admin', userType: 'PLATFORM', status: 'ACTIVE', passwordHash: await hashPassword(PASSWORD) } });
  await rt.prisma.platformRoleAssignment.create({ data: { userId: id, role: 'PLATFORM_SUPER_ADMIN' } });
  return id;
}

const login = (email: string, password = PASSWORD, portal: 'app' | 'admin' = 'app') =>
  request(rt.app).post('/api/v1/auth/login').set('x-refresh-delivery', 'body').send({ email, password, portal });

async function outboxEvents(type: string): Promise<EventEnvelope[]> {
  const rows = await rt.prisma.outboxEvent.findMany({ where: { eventType: type }, orderBy: { createdAt: 'asc' } });
  return rows.map((r) => r.envelope as unknown as EventEnvelope);
}

function tenantEvent(type: string, tenantId: string, status: string, version: number, extra: Record<string, unknown> = {}): EventEnvelope {
  return {
    eventId: uuidv7(), eventType: type, eventVersion: 1, occurredAt: new Date().toISOString(), tenantId, producer: 'svc-tenant', correlationId: `test-${type}`, causationId: null,
    actor: { type: 'user', id: randomUUID() }, aggregate: { type: 'tenant', id: tenantId, version },
    payload: { tenantId, code: 'ACME', legalName: 'Acme Pvt Ltd', displayName: 'Acme', status, previousStatus: null, reason: null, ownerName: 'Owner One', ownerEmail: 'owner@acme.test', actorId: null, occurredAt: new Date().toISOString(), ...extra },
  };
}

before(async () => {
  ({ runtime: rt, broker, tenantStatus } = await bootAuth());
});
after(async () => {
  await rt.stop();
});

describe('login for tenant users', () => {
  it('issues RS256 tenant tokens with the README claims, a refresh cookie and (on request) a body refresh token', async () => {
    const tenantId = randomUUID();
    const userId = await seedTenantUser('one@acme.test', [tenantId]);
    const res = await login('one@acme.test');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const data = res.body.data;
    assert.equal(data.kind, 'tokens');
    assert.equal(data.tokenType, 'tenant');
    assert.equal(data.tenant.id, tenantId);
    assert.ok(data.refreshToken, 'body delivery requested');
    assert.ok(String(res.headers['set-cookie']).includes('b2b_app_refresh='), 'HttpOnly cookie set');
    assert.ok(String(res.headers['set-cookie']).includes('HttpOnly'));

    const verifier = createTokenVerifier({ keys: new StaticKeyProvider(rt.keys.signing.publicKeyPem), issuer: 'svc-auth', audience: 'b2b-inventory' });
    const claims = await verifier.verify(data.accessToken);
    assert.equal(claims.sub, userId);
    assert.equal(claims.typ, 'tenant');
    assert.equal(claims.tid, tenantId);
    assert.ok(claims.mid);
    assert.equal(claims.pv, 1);
    assert.deepEqual([...(claims.perms ?? [])].sort(), [...TENANT_PERMISSION_CODES].sort(), 'bootstrap owner holds every tenant permission');
    assert.ok(claims.sid);
    assert.ok((claims.exp ?? 0) - (claims.iat ?? 0) === 600, '10 minute access token');

    const jwks = await request(rt.app).get('/.well-known/jwks.json');
    assert.equal(jwks.status, 200);
    assert.equal(jwks.body.keys[0].kid, rt.keys.signing.kid);
    assert.equal(jwks.body.keys[0].alg, 'RS256');

    const me = await request(rt.app).get('/api/v1/auth/me').set('Authorization', `Bearer ${data.accessToken}`);
    assert.equal(me.status, 200);
    assert.equal(me.body.data.tenantId, tenantId);
    assert.ok((await outboxEvents(EVENT_TYPES.AUTH_LOGGED_IN)).length >= 1);
  });

  it('rejects wrong passwords and unknown emails with the same 401 and records login_failed', async () => {
    await seedTenantUser('two@acme.test', [randomUUID()]);
    const wrong = await login('two@acme.test', 'nope-nope-1');
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error.code, 'AUTH_INVALID_CREDENTIALS');
    const unknown = await login('nobody@acme.test');
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error.code, 'AUTH_INVALID_CREDENTIALS');
    const failed = await outboxEvents(EVENT_TYPES.AUTH_LOGIN_FAILED);
    assert.ok(failed.some((e) => (e.payload as { email: string }).email === 'two@acme.test'));
    assert.ok(failed.some((e) => (e.payload as { email: string }).email === 'nobody@acme.test'));
  });

  it('locks the account after the configured number of failures, even for the right password', async () => {
    await seedTenantUser('locky@acme.test', [randomUUID()]);
    for (let i = 0; i < 10; i += 1) assert.equal((await login('locky@acme.test', 'wrong-password-1')).status, 401);
    const locked = await login('locky@acme.test');
    assert.equal(locked.status, 403, JSON.stringify(locked.body));
    assert.equal(locked.body.error.code, 'AUTH_ACCOUNT_LOCKED');
    const user = await rt.prisma.user.findUniqueOrThrow({ where: { email: 'locky@acme.test' } });
    assert.equal(user.status, 'LOCKED');
    assert.ok(user.lockedUntil && user.lockedUntil.getTime() > Date.now());
    const audits = await outboxEvents(EVENT_TYPES.AUDIT_RECORDED);
    assert.ok(audits.some((e) => (e.payload as { action: string }).action === 'USER_LOCKED'));
    // Lock expires -> login works again.
    await rt.prisma.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    assert.equal((await login('locky@acme.test')).status, 200);
  });

  it('refuses login for a suspended tenant with a clear message', async () => {
    const tenantId = randomUUID();
    await seedTenantUser('susp@acme.test', [tenantId]);
    tenantStatus.set(tenantId, 'SUSPENDED');
    const res = await login('susp@acme.test');
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'TENANT_NOT_ACTIVE');
  });

  it('asks for tenant selection when the user belongs to several active tenants', async () => {
    const a = randomUUID();
    const b = randomUUID();
    const c = randomUUID();
    await seedTenantUser('multi@acme.test', [a, b, c]);
    tenantStatus.set(c, 'SUSPENDED');
    const res = await login('multi@acme.test');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.kind, 'select');
    assert.deepEqual(res.body.data.tenants.map((t: { id: string }) => t.id).sort(), [a, b].sort(), 'suspended tenant is not offered');
    const chosen = await request(rt.app).post('/api/v1/auth/select-tenant').set('x-refresh-delivery', 'body').send({ selectionToken: res.body.data.selectionToken, tenantId: b });
    assert.equal(chosen.status, 200, JSON.stringify(chosen.body));
    assert.equal(chosen.body.data.tenant.id, b);
    const notMine = await request(rt.app).post('/api/v1/auth/select-tenant').send({ selectionToken: res.body.data.selectionToken, tenantId: randomUUID() });
    assert.equal(notMine.status, 404);
    const suspended = await request(rt.app).post('/api/v1/auth/select-tenant').send({ selectionToken: res.body.data.selectionToken, tenantId: c });
    assert.equal(suspended.status, 403);
    assert.equal(suspended.body.error.code, 'TENANT_NOT_ACTIVE');
  });

  it('verifies legacy bcrypt hashes and rehashes them to argon2id on login', async () => {
    await seedTenantUser('legacy@acme.test', [randomUUID()], { algo: 'bcrypt' });
    const res = await login('legacy@acme.test');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const user = await rt.prisma.user.findUniqueOrThrow({ where: { email: 'legacy@acme.test' } });
    assert.equal(user.passwordAlgo, 'argon2id');
    assert.ok(user.passwordHash?.startsWith('$argon2id$'));
    assert.equal((await login('legacy@acme.test')).status, 200, 'still works after rehash');
  });
});

describe('refresh tokens', () => {
  it('rotates on refresh, detects reuse and revokes the whole family', async () => {
    await seedTenantUser('rot@acme.test', [randomUUID()]);
    const first = await login('rot@acme.test');
    const refresh1 = first.body.data.refreshToken as string;

    const second = await request(rt.app).post('/api/v1/auth/refresh').set('x-refresh-delivery', 'body').send({ refreshToken: refresh1 });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    const refresh2 = second.body.data.refreshToken as string;
    assert.notEqual(refresh2, refresh1);
    assert.notEqual(second.body.data.accessToken, first.body.data.accessToken);

    const reused = await request(rt.app).post('/api/v1/auth/refresh').send({ refreshToken: refresh1 });
    assert.equal(reused.status, 401);
    assert.equal(reused.body.error.code, 'AUTH_REFRESH_REUSED');

    const afterReuse = await request(rt.app).post('/api/v1/auth/refresh').send({ refreshToken: refresh2 });
    assert.equal(afterReuse.status, 401, 'the newest token of the family is revoked too');
    const session = await rt.prisma.session.findFirst({ where: { revokeReason: 'REFRESH_REUSE' } });
    assert.ok(session);
  });

  it('accepts the refresh cookie, and logout revokes the session', async () => {
    await seedTenantUser('cookie@acme.test', [randomUUID()]);
    const res = await request(rt.app).post('/api/v1/auth/login').send({ email: 'cookie@acme.test', password: PASSWORD });
    assert.equal(res.body.data.refreshToken, undefined, 'no body token without the header');
    const cookie = String(res.headers['set-cookie']).split(';')[0];
    const refreshed = await request(rt.app).post('/api/v1/auth/refresh').set('Cookie', cookie).send({});
    assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body));
    const out = await request(rt.app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${refreshed.body.data.accessToken}`);
    assert.equal(out.status, 204);
    const again = await request(rt.app).post('/api/v1/auth/refresh').set('Cookie', String(refreshed.headers['set-cookie']).split(';')[0]).send({});
    assert.equal(again.status, 401);
    const missing = await request(rt.app).post('/api/v1/auth/refresh').send({});
    assert.equal(missing.status, 401);
    assert.equal(missing.body.error.code, 'AUTH_REFRESH_INVALID');
  });

  it('denies refresh once the tenant is suspended (status check, not token claims)', async () => {
    const tenantId = randomUUID();
    await seedTenantUser('later@acme.test', [tenantId]);
    const res = await login('later@acme.test');
    tenantStatus.set(tenantId, 'SUSPENDED');
    const refreshed = await request(rt.app).post('/api/v1/auth/refresh').send({ refreshToken: res.body.data.refreshToken });
    assert.equal(refreshed.status, 403);
    assert.equal(refreshed.body.error.code, 'TENANT_NOT_ACTIVE');
    tenantStatus.set(tenantId, 'ACTIVE');
    const restored = await request(rt.app).post('/api/v1/auth/refresh').send({ refreshToken: res.body.data.refreshToken });
    assert.equal(restored.status, 200, 'reactivation restores access without a new invite');
  });
});

describe('platform administrators and MFA', () => {
  it('forces TOTP enrolment on first login, then requires the code on every login', async () => {
    await seedPlatformAdmin('admin@platform.test');
    const first = await login('admin@platform.test', PASSWORD, 'admin');
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.data.kind, 'mfa');
    assert.equal(first.body.data.enrolmentRequired, true);
    const url = new URL(first.body.data.otpauthUrl);
    const secret = url.searchParams.get('secret')!;

    const bad = await request(rt.app).post('/api/v1/auth/mfa/verify').send({ mfaToken: first.body.data.mfaToken, code: '000000' });
    assert.equal(bad.status, 401);
    assert.equal(bad.body.error.code, 'AUTH_MFA_INVALID');

    const ok = await request(rt.app).post('/api/v1/auth/mfa/verify').set('x-refresh-delivery', 'body').send({ mfaToken: first.body.data.mfaToken, code: authenticator.generate(secret) });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.data.tokenType, 'platform');
    assert.ok(String(ok.headers['set-cookie']).includes('b2b_admin_refresh='));
    const verifier = createTokenVerifier({ keys: new StaticKeyProvider(rt.keys.signing.publicKeyPem), issuer: 'svc-auth', audience: 'b2b-inventory' });
    const claims = await verifier.verify(ok.body.data.accessToken);
    assert.equal(claims.typ, 'platform');
    assert.equal(claims.tid, undefined);
    assert.ok(claims.perms?.includes('platform.tenant.approve'));

    const second = await login('admin@platform.test', PASSWORD, 'admin');
    assert.equal(second.body.data.kind, 'mfa');
    assert.equal(second.body.data.enrolmentRequired, false);
    assert.equal(second.body.data.otpauthUrl, undefined, 'secret never re-exposed');
    const verified = await request(rt.app).post('/api/v1/auth/mfa/verify').send({ mfaToken: second.body.data.mfaToken, code: authenticator.generate(secret) });
    assert.equal(verified.status, 200);

    const wrongPortal = await login('admin@platform.test', PASSWORD, 'app');
    assert.equal(wrongPortal.status, 403);
    assert.equal(wrongPortal.body.error.code, 'PLATFORM_ONLY');

    const noBypass = await login('admin@platform.test', PASSWORD, 'admin');
    const refused = await request(rt.app).post('/api/v1/auth/mfa/verify').send({ mfaToken: noBypass.body.data.mfaToken, code: '123456' });
    assert.equal(refused.status, 401, 'no bypass unless MFA_DEV_BYPASS_CODE is configured');
  });

  it('accepts the development bypass code only when configured and never in production', async () => {
    assert.throws(() => testConfig({ NODE_ENV: 'production', MFA_DEV_BYPASS_CODE: '123456' }), /must not be set/);
    const dev = await bootAuth({ MFA_DEV_BYPASS_CODE: '123456' });
    try {
      await seedPlatformAdmin('bypass@platform.test');
      const first = await request(dev.runtime.app).post('/api/v1/auth/login').send({ email: 'bypass@platform.test', password: PASSWORD, portal: 'admin' });
      assert.equal(first.body.data.kind, 'mfa');
      const wrong = await request(dev.runtime.app).post('/api/v1/auth/mfa/verify').send({ mfaToken: first.body.data.mfaToken, code: '654321' });
      assert.equal(wrong.status, 401, 'other codes are still checked');
      const ok = await request(dev.runtime.app).post('/api/v1/auth/mfa/verify').send({ mfaToken: first.body.data.mfaToken, code: '123456' });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      assert.equal(ok.body.data.tokenType, 'platform');
      const again = await request(dev.runtime.app).post('/api/v1/auth/login').send({ email: 'bypass@platform.test', password: PASSWORD, portal: 'admin' });
      assert.equal(again.body.data.enrolmentRequired, true, 'the bypass does not count as an enrolment');
    } finally {
      await dev.runtime.close?.();
    }
  });

  it('does not let a tenant user sign in on the admin portal', async () => {
    await seedTenantUser('tenantonly@acme.test', [randomUUID()]);
    const res = await login('tenantonly@acme.test', PASSWORD, 'admin');
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'TENANT_ONLY');
  });
});

describe('password reset', () => {
  it('always answers 202, delivers a single-use token via event, enforces the policy and revokes sessions', async () => {
    await seedTenantUser('reset@acme.test', [randomUUID()]);
    const session = await login('reset@acme.test');
    const unknown = await request(rt.app).post('/api/v1/auth/password/forgot').send({ email: 'ghost@acme.test' });
    assert.equal(unknown.status, 202);
    const known = await request(rt.app).post('/api/v1/auth/password/forgot').send({ email: 'reset@acme.test' });
    assert.equal(known.status, 202);
    const events = await outboxEvents(EVENT_TYPES.AUTH_PASSWORD_RESET_REQUESTED);
    const token = (events.at(-1)!.payload as { resetToken: string }).resetToken;
    assert.ok(token);

    const weak = await request(rt.app).post('/api/v1/auth/password/reset').send({ token, password: 'short1' });
    assert.equal(weak.status, 422);
    assert.equal(weak.body.error.code, 'AUTH_PASSWORD_WEAK');
    const ok = await request(rt.app).post('/api/v1/auth/password/reset').send({ token, password: 'NewStr0ngPassword' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const twice = await request(rt.app).post('/api/v1/auth/password/reset').send({ token, password: 'NewStr0ngPassword2' });
    assert.equal(twice.status, 401, 'single use');
    assert.equal((await login('reset@acme.test', PASSWORD)).status, 401);
    assert.equal((await login('reset@acme.test', 'NewStr0ngPassword')).status, 200);
    const old = await request(rt.app).post('/api/v1/auth/refresh').send({ refreshToken: session.body.data.refreshToken });
    assert.equal(old.status, 401, 'sessions from before the reset are revoked');
  });
});

describe('tenant lifecycle events', () => {
  it('creates the owner identity and invite on activation, ignores duplicate deliveries, accepts the invite', async () => {
    const tenantId = randomUUID();
    const activated = tenantEvent(EVENT_TYPES.TENANT_ACTIVATED, tenantId, 'ACTIVE', 3);
    await broker.publish(rk(EVENT_TYPES.TENANT_ACTIVATED), activated);
    await broker.publish(rk(EVENT_TYPES.TENANT_ACTIVATED), activated); // redelivery
    await broker.drain();

    const owner = await rt.prisma.user.findUniqueOrThrow({ where: { email: 'owner@acme.test' } });
    assert.equal(owner.status, 'INVITED');
    assert.equal(owner.passwordHash, null);
    assert.equal(await rt.prisma.tenantMembershipBootstrap.count({ where: { tenantId } }), 1);
    const invites = await outboxEvents(EVENT_TYPES.AUTH_OWNER_INVITED);
    assert.equal(invites.filter((e) => e.tenantId === tenantId).length, 1, 'one invite despite two deliveries');
    const replica = await rt.prisma.tenantStatusReplica.findUniqueOrThrow({ where: { tenantId } });
    assert.equal(replica.status, 'ACTIVE');

    // Cannot log in before accepting.
    tenantStatus.set(tenantId, 'ACTIVE');
    assert.equal((await login('owner@acme.test')).status, 401);

    const token = (invites.at(-1)!.payload as { inviteToken: string }).inviteToken;
    const accepted = await request(rt.app).post('/api/v1/auth/invitations/accept').send({ token, password: 'OwnerPassw0rd1' });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.data.tenantId, tenantId);
    const again = await request(rt.app).post('/api/v1/auth/invitations/accept').send({ token, password: 'OwnerPassw0rd1' });
    assert.equal(again.status, 401, 'single use');
    const loggedIn = await login('owner@acme.test', 'OwnerPassw0rd1');
    assert.equal(loggedIn.status, 200, JSON.stringify(loggedIn.body));
    assert.equal(loggedIn.body.data.tenant.id, tenantId);
  });

  it('rejects expired invites with 410', async () => {
    const user = await rt.prisma.user.create({ data: { id: uuidv7(), email: 'expired@acme.test', fullName: 'Late', userType: 'TENANT', status: 'INVITED' } });
    const { opaqueToken } = await import('@b2b/platform-kit');
    const { token, hash } = opaqueToken();
    await rt.prisma.inviteToken.create({ data: { id: uuidv7(), userId: user.id, tenantId: randomUUID(), kind: 'OWNER', tokenHash: hash, expiresAt: new Date(Date.now() - 1000) } });
    const res = await request(rt.app).post('/api/v1/auth/invitations/accept').send({ token, password: 'OwnerPassw0rd1' });
    assert.equal(res.status, 410);
  });

  it('suspension revokes every session of the tenant and updates the replica; reactivation restores logins', async () => {
    const tenantId = randomUUID();
    await seedTenantUser('victim@acme.test', [tenantId]);
    const session = await login('victim@acme.test');
    assert.equal(session.status, 200);

    await broker.publish(rk(EVENT_TYPES.TENANT_SUSPENDED), tenantEvent(EVENT_TYPES.TENANT_SUSPENDED, tenantId, 'SUSPENDED', 4, { reason: 'unpaid' }));
    await broker.drain();
    const revoked = await rt.prisma.session.findMany({ where: { tenantId } });
    assert.ok(revoked.length >= 1 && revoked.every((s) => s.revokedAt !== null));
    const refresh = await request(rt.app).post('/api/v1/auth/refresh').send({ refreshToken: session.body.data.refreshToken });
    assert.equal(refresh.status, 401);

    // Out-of-order older event must not flip the replica back.
    await broker.publish(rk(EVENT_TYPES.TENANT_ACTIVATED), tenantEvent(EVENT_TYPES.TENANT_ACTIVATED, tenantId, 'ACTIVE', 2));
    await broker.drain();
    assert.equal((await rt.prisma.tenantStatusReplica.findUniqueOrThrow({ where: { tenantId } })).status, 'SUSPENDED');

    await broker.publish(rk(EVENT_TYPES.TENANT_REACTIVATED), tenantEvent(EVENT_TYPES.TENANT_REACTIVATED, tenantId, 'ACTIVE', 5));
    await broker.drain();
    assert.equal((await rt.prisma.tenantStatusReplica.findUniqueOrThrow({ where: { tenantId } })).status, 'ACTIVE');
    tenantStatus.set(tenantId, 'ACTIVE');
    assert.equal((await login('victim@acme.test')).status, 200);
  });
});

describe('service tokens and internal APIs', () => {
  it('issues audience-scoped service tokens for known clients only', async () => {
    const ok = await request(rt.app).post('/internal/v1/service-tokens').send({ clientId: 'svc-tenant', clientSecret: 'test-secret-tenant', audience: 'svc-auth' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const bad = await request(rt.app).post('/internal/v1/service-tokens').send({ clientId: 'svc-tenant', clientSecret: 'wrong', audience: 'svc-auth' });
    assert.equal(bad.status, 401);

    const ensure = await request(rt.app).post('/internal/v1/users:ensure').set('Authorization', `Bearer ${ok.body.accessToken}`).send({ email: 'New.Member@acme.test', fullName: 'New Member' });
    assert.equal(ensure.status, 200, JSON.stringify(ensure.body));
    assert.equal(ensure.body.data.created, true);
    assert.equal(ensure.body.data.status, 'INVITED');
    const again = await request(rt.app).post('/internal/v1/users:ensure').set('Authorization', `Bearer ${ok.body.accessToken}`).send({ email: 'new.member@acme.test', fullName: 'New Member', password: 'Memb3rPassword1' });
    assert.equal(again.body.data.created, false);
    assert.equal(again.body.data.status, 'ACTIVE');

    const otherAudience = await request(rt.app).post('/internal/v1/service-tokens').send({ clientId: 'svc-iam', clientSecret: 'test-secret-iam', audience: 'svc-inventory' });
    const wrongAud = await request(rt.app).post('/internal/v1/users:ensure').set('Authorization', `Bearer ${otherAudience.body.accessToken}`).send({ email: 'x@acme.test', fullName: 'X' });
    assert.equal(wrongAud.status, 401, 'audience must be svc-auth');

    await seedTenantUser('tenanttoken@acme.test', [randomUUID()]);
    const tenant = await login('tenanttoken@acme.test');
    const tenantOnInternal = await request(rt.app).post('/internal/v1/users:ensure').set('Authorization', `Bearer ${tenant.body.data.accessToken}`).send({ email: 'y@acme.test', fullName: 'Y' });
    assert.equal(tenantOnInternal.status, 401, 'tenant tokens are not accepted on internal routes');
  });

  it('applies the per-IP+email login rate limit', async () => {
    const limited = await bootAuth({ LOGIN_RATE_LIMIT_PER_MIN: 2 });
    try {
      const results = [];
      for (let i = 0; i < 3; i += 1) results.push((await request(limited.runtime.app).post('/api/v1/auth/login').send({ email: 'rate@acme.test', password: 'whatever-1' })).status);
      assert.deepEqual(results, [401, 401, 429]);
    } finally {
      await limited.runtime.stop();
      ({ runtime: rt, broker, tenantStatus } = await bootAuth());
    }
  });
});

describe('outbox relay', () => {
  it('publishes auth events through the broker exactly once', async () => {
    await seedTenantUser('relay@acme.test', [randomUUID()]);
    await login('relay@acme.test');
    const pending = await rt.prisma.outboxEvent.count({ where: { publishedAt: null } });
    assert.ok(pending > 0);
    await settleEvents(broker, [rt.relay]);
    assert.equal(await rt.prisma.outboxEvent.count({ where: { publishedAt: null } }), 0);
    const ids = broker.published.map((p) => p.envelope.eventId);
    assert.equal(new Set(ids).size, ids.length);
  });
});
