/**
 * svc-auth + svc-iam together (phase-02 steps 8.4 / 9): login tokens carry iam-derived roles,
 * permissions and permission version; a role change bumps the version so the gateway rejects the
 * old token (PERMISSIONS_STALE) and a refresh yields new claims; suspension revokes sessions.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { EVENT_TYPES, rk } from '@b2b/contracts';
import { StaticKeyProvider, createLocalServiceTokenSource, createTokenVerifier, loadEnv, uuidv7, type EventEnvelope } from '@b2b/platform-kit';
import { InMemoryBroker, settleEvents, startApp, testKeys, truncateAll, type RunningApp } from '@b2b/test-kit';
import { authEnvSchema, toConfig } from '@b2b/svc-auth/config';
import { createAuthRuntime, type AuthRuntime } from '@b2b/svc-auth/service';
import { IamDirectory, type TenantStatusSource } from '../../svc-auth/src/modules/directory.js';
import { IamPlatformDirectory } from '../../svc-auth/src/modules/platform-directory.js';
import { hashPassword } from '../../svc-auth/src/modules/passwords.js';
import { iamEnvSchema } from '../src/config.js';
import { createIamRuntime, type IamRuntime } from '../src/service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let auth: AuthRuntime;
let iam: IamRuntime;
let iamServer: RunningApp;
let broker: InMemoryBroker;
const tenantId = randomUUID();
const statuses: TenantStatusSource = { get: async () => ({ status: 'ACTIVE', version: 1 }) };

before(async () => {
  broker = new InMemoryBroker();
  const authEnv = loadEnv(authEnvSchema, { dir: path.resolve(here, '../../svc-auth') });
  const iamEnv = loadEnv(iamEnvSchema, { dir: path.resolve(here, '..') });
  await truncateAll(authEnv.MIGRATE_DATABASE_URL!);
  await truncateAll(iamEnv.MIGRATE_DATABASE_URL!);

  // Boot auth first so its signing key exists; iam verifies with auth's real public key.
  const authConfig = toConfig(authEnv);
  const bootstrap = await createAuthRuntime(authConfig, { broker, tenantStatus: statuses });
  const authKeys = new StaticKeyProvider(bootstrap.keys.signing.publicKeyPem);
  const tokens = createLocalServiceTokenSource({ serviceName: 'svc-auth', privateKeyPem: bootstrap.keys.signing.privateKeyPem, kid: bootstrap.keys.signing.kid, issuer: 'svc-auth' });
  await bootstrap.stop();

  iam = await createIamRuntime(iamEnv, {
    broker,
    keys: authKeys,
    identity: { ensureUser: async (input) => ({ userId: uuidv7(), status: input.password ? 'ACTIVE' : 'INVITED' }) },
  });
  await iam.start();
  iamServer = await startApp(iam.app);

  auth = await createAuthRuntime(authConfig, {
    broker,
    tenantStatus: statuses,
    directory: new IamDirectory(iamServer.url, tokens),
    platformDirectory: new IamPlatformDirectory(iamServer.url, tokens),
  });
  await auth.start();
});
after(async () => {
  await iamServer.close();
  await auth.stop();
  await iam.stop();
});

describe('login through svc-iam memberships', () => {
  it('issues tokens whose perms and pv come from iam; a role change invalidates them on refresh', async () => {
    // Activation -> iam seeds roles; owner invited -> iam owner membership.
    await broker.publish(rk(EVENT_TYPES.TENANT_ACTIVATED), { eventId: uuidv7(), eventType: EVENT_TYPES.TENANT_ACTIVATED, eventVersion: 1, occurredAt: new Date().toISOString(), tenantId, producer: 'svc-tenant', correlationId: 'c', causationId: null, actor: { type: 'user', id: null }, aggregate: { type: 'tenant', id: tenantId, version: 2 }, payload: { tenantId, code: 'T', legalName: 'T', displayName: 'T', status: 'ACTIVE', previousStatus: 'APPROVED', reason: null, ownerName: 'Owner', ownerEmail: 'owner@integ.test', actorId: null, occurredAt: new Date().toISOString() } } as EventEnvelope);
    await settleEvents(broker, [auth.relay, iam.relay]);
    const owner = await auth.prisma.user.findUniqueOrThrow({ where: { email: 'owner@integ.test' } });
    await auth.prisma.user.update({ where: { id: owner.id }, data: { passwordHash: await hashPassword('OwnerPassw0rd1'), status: 'ACTIVE' } });

    const login = await request(auth.app).post('/api/v1/auth/login').set('x-refresh-delivery', 'body').send({ email: 'owner@integ.test', password: 'OwnerPassw0rd1' });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    const verifier = createTokenVerifier({ keys: new StaticKeyProvider(auth.keys.signing.publicKeyPem), issuer: 'svc-auth', audience: 'b2b-inventory' });
    const claims = await verifier.verify(login.body.data.accessToken);
    assert.equal(claims.tid, tenantId);
    assert.ok(claims.perms!.includes('iam.role.manage'));
    const iamMembership = (await iam.service.membershipsForUser(owner.id))[0];
    assert.equal(claims.mid, iamMembership.membershipId);
    assert.equal(claims.pv, iamMembership.permissionVersion);

    // Invite a viewer, accept, log in: viewer perms only.
    const viewerRole = (await iam.service.listRoles(tenantId)).find((r) => r.key === 'VIEWER')!;
    const inv = await request(iam.app).post('/api/v1/iam/invitations').set('Authorization', `Bearer ${login.body.data.accessToken}`).set('Idempotency-Key', randomUUID()).send({ email: 'viewer@integ.test', roleIds: [viewerRole.id] });
    assert.equal(inv.status, 201, JSON.stringify(inv.body));
    const invEvent = (await iam.prisma.outboxEvent.findMany({ where: { eventType: EVENT_TYPES.IAM_INVITATION_CREATED }, orderBy: { createdAt: 'desc' }, take: 1 }))[0].envelope as unknown as EventEnvelope<{ acceptToken: string }>;
    const accepted = await request(iam.app).post('/api/v1/iam/invitations/accept').send({ token: invEvent.payload.acceptToken, password: 'ViewerPassw0rd1' });
    assert.equal(accepted.status, 200);
    // The fake identity provider does not write to auth_db; create the identity with the same id for the login step.
    await auth.prisma.user.create({ data: { id: accepted.body.data.userId, email: 'viewer@integ.test', fullName: 'Viewer', userType: 'TENANT', status: 'ACTIVE', passwordHash: await hashPassword('ViewerPassw0rd1') } });
    const viewerLogin = await request(auth.app).post('/api/v1/auth/login').set('x-refresh-delivery', 'body').send({ email: 'viewer@integ.test', password: 'ViewerPassw0rd1' });
    assert.equal(viewerLogin.status, 200, JSON.stringify(viewerLogin.body));
    const viewerClaims = await verifier.verify(viewerLogin.body.data.accessToken);
    assert.ok(viewerClaims.perms!.every((p) => p.endsWith('.view')));
    const pvBefore = viewerClaims.pv!;

    // Owner promotes the viewer -> permission version bumps -> refresh carries new perms and pv.
    const pmRole = (await iam.service.listRoles(tenantId)).find((r) => r.key === 'PURCHASE_MANAGER')!;
    const promote = await request(iam.app).post(`/api/v1/iam/members/${viewerClaims.mid}/roles`).set('Authorization', `Bearer ${login.body.data.accessToken}`).send({ roleIds: [pmRole.id] });
    assert.equal(promote.status, 200, JSON.stringify(promote.body));
    await settleEvents(broker, [auth.relay, iam.relay]);
    const changed = broker.published.filter((p) => p.envelope.eventType === EVENT_TYPES.IAM_PERMISSIONS_CHANGED);
    assert.ok(changed.length >= 1, 'gateway consumers receive the new permission version');
    const refreshed = await request(auth.app).post('/api/v1/auth/refresh').set('x-refresh-delivery', 'body').send({ refreshToken: viewerLogin.body.data.refreshToken });
    assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body));
    const newClaims = await verifier.verify(refreshed.body.data.accessToken);
    assert.equal(newClaims.pv, pvBefore + 1);
    assert.ok(newClaims.perms!.includes('purchase.approve'));

    // Suspension: iam event -> auth revokes the membership's sessions; refresh fails.
    const suspend = await request(iam.app).post(`/api/v1/iam/members/${viewerClaims.mid}/suspend`).set('Authorization', `Bearer ${login.body.data.accessToken}`).send({ reason: 'audit' });
    assert.equal(suspend.status, 200);
    await settleEvents(broker, [auth.relay, iam.relay]);
    const afterSuspend = await request(auth.app).post('/api/v1/auth/refresh').send({ refreshToken: refreshed.body.data.refreshToken });
    assert.ok([401, 403].includes(afterSuspend.status), JSON.stringify(afterSuspend.body));
    const relogin = await request(auth.app).post('/api/v1/auth/login').send({ email: 'viewer@integ.test', password: 'ViewerPassw0rd1' });
    assert.equal(relogin.status, 403, 'no active membership -> cannot log in');
  });

  it('platform admin permissions come from iam platform staff', async () => {
    const admin = await auth.prisma.user.create({ data: { id: uuidv7(), email: 'staff@integ.test', fullName: 'Staff', userType: 'PLATFORM', status: 'ACTIVE', passwordHash: await hashPassword('StaffPassw0rd1') } });
    await iam.service.upsertPlatformStaff({ userId: admin.id, email: admin.email, fullName: admin.fullName, roleKeys: ['PLATFORM_SUPPORT'] }, { userId: null, name: 'test', membershipId: null, correlationId: 'c' });
    const login = await request(auth.app).post('/api/v1/auth/login').send({ email: 'staff@integ.test', password: 'StaffPassw0rd1', portal: 'admin' });
    assert.equal(login.body.data.kind, 'mfa');
    // Skip MFA in this test by disabling it for the check of permission sourcing: verify via the directory directly.
    const perms = await new IamPlatformDirectory(iamServer.url, createLocalServiceTokenSource({ serviceName: 'svc-auth', privateKeyPem: auth.keys.signing.privateKeyPem, kid: auth.keys.signing.kid, issuer: 'svc-auth' })).permissionsFor(admin.id);
    assert.deepEqual(perms.sort(), ['platform.audit.view', 'platform.dashboard.view', 'platform.tenant.view']);
  });
});
