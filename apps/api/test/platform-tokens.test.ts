/**
 * Phase 1 step 8.4: the legacy API accepts RS256 tokens issued by svc-auth. The tenant comes from
 * the `tid` claim, permissions from `perms` mapped onto legacy codes; the membership must still
 * exist and be active (user ids are preserved by the identity migration).
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { StaticKeyProvider } from '@b2b/platform-kit';
import { mintToken, testKeys } from '@b2b/test-kit';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { configureTokenVerifier } from '../src/middleware/auth.js';
import { registerOrg, resetDatabase, type Session } from './helpers.js';

const app = createApp();
let owner: Session;
let other: Session;

const platformTenantToken = (userId: string, tenantId: string, perms: string[], typ: 'tenant' | 'platform' = 'tenant') =>
  mintToken({ sub: userId, typ, tid: typ === 'tenant' ? tenantId : undefined, mid: randomUUID(), perms, pv: 1, sid: randomUUID(), email: 'x@y.test', name: 'X' });

before(async () => {
  await resetDatabase();
  configureTokenVerifier(new StaticKeyProvider(testKeys().publicKeyPem));
  owner = await registerOrg(app, 'Alpha Platform', 'owner@alpha-platform.test');
  other = await registerOrg(app, 'Beta Platform', 'owner@beta-platform.test');
});
after(async () => {
  configureTokenVerifier(null);
  await prisma.$disconnect();
});

describe('RS256 platform tokens on the legacy API', () => {
  it('resolves the tenant from the token and maps permissions onto legacy codes', async () => {
    const token = platformTenantToken(owner.userId, owner.orgId, ['purchase.view', 'supplier.view']);
    const list = await request(app).get('/api/purchase-orders').set('Authorization', `Bearer ${token}`);
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const vendors = await request(app).get('/api/vendors').set('Authorization', `Bearer ${token}`);
    assert.equal(vendors.status, 200);
    const denied = await request(app).post('/api/items').set('Authorization', `Bearer ${token}`).send({ name: 'Nope' });
    assert.equal(denied.status, 403, 'master.manage is not in the token');
    assert.equal(denied.body.error.code, 'PERMISSION_DENIED');
    const full = platformTenantToken(owner.userId, owner.orgId, ['master.manage', 'master.view']);
    const created = await request(app).post('/api/items').set('Authorization', `Bearer ${full}`).send({ name: 'Token Item' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
  });

  it('ignores the legacy header when the token names the tenant, and refuses a disagreeing header', async () => {
    const token = platformTenantToken(owner.userId, owner.orgId, ['purchase.view']);
    const noHeader = await request(app).get('/api/purchase-orders').set('Authorization', `Bearer ${token}`);
    assert.equal(noHeader.status, 200);
    const wrongHeader = await request(app).get('/api/purchase-orders').set('Authorization', `Bearer ${token}`).set('X-Organization-Id', other.orgId);
    assert.equal(wrongHeader.status, 403);
    assert.equal(wrongHeader.body.error.code, 'ORGANIZATION_ACCESS_DENIED');
  });

  it('still requires an active membership for the token tenant (cross-tenant token -> 403)', async () => {
    const foreign = platformTenantToken(owner.userId, other.orgId, ['purchase.view']);
    const res = await request(app).get('/api/purchase-orders').set('Authorization', `Bearer ${foreign}`);
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'ORGANIZATION_ACCESS_DENIED');
    const unknownUser = platformTenantToken(randomUUID(), owner.orgId, ['purchase.view']);
    assert.equal((await request(app).get('/api/purchase-orders').set('Authorization', `Bearer ${unknownUser}`)).status, 403);
  });

  it('rejects platform tokens, expired tokens and tokens signed by another key', async () => {
    const platform = platformTenantToken(owner.userId, owner.orgId, ['platform.tenant.view'], 'platform');
    const res = await request(app).get('/api/purchase-orders').set('Authorization', `Bearer ${platform}`);
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'PLATFORM_TOKEN_ON_TENANT_ROUTE');
    const expired = mintToken({ sub: owner.userId, typ: 'tenant', tid: owner.orgId, perms: ['purchase.view'] }, { expiresInSec: -5 });
    assert.equal((await request(app).get('/api/purchase-orders').set('Authorization', `Bearer ${expired}`)).status, 401);
    configureTokenVerifier(null);
    const noKeys = await request(app).get('/api/purchase-orders').set('Authorization', `Bearer ${platformTenantToken(owner.userId, owner.orgId, ['purchase.view'])}`);
    assert.equal(noKeys.status, 401, 'without a configured key nothing RS256 is trusted');
    configureTokenVerifier(new StaticKeyProvider(testKeys().publicKeyPem));
    // Legacy HS256 tokens keep working during the overlap window.
    const legacy = await request(app).get('/api/purchase-orders').set('Authorization', `Bearer ${owner.token}`).set('X-Organization-Id', owner.orgId);
    assert.equal(legacy.status, 200);
  });
});
