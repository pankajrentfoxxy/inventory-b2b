/**
 * Phase 2 step 8.7 / 9: route x system-role matrix for the legacy API. For every system role a
 * platform token is minted with that role's permission set (from packages/contracts) and every
 * route is called. Permitted -> not 403 (2xx or a validation error); not permitted -> 403.
 * The matrix is documented in docs/phase-2/route-permission-matrix.md.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { LEGACY_PERMISSION_MAP, SYSTEM_ROLES, resolveRolePermissions } from '@b2b/contracts';
import { StaticKeyProvider } from '@b2b/platform-kit';
import { mintToken, testKeys } from '@b2b/test-kit';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { configureTokenVerifier } from '../src/middleware/auth.js';
import { registerOrg, resetDatabase, type Session } from './helpers.js';

const app = createApp();
let owner: Session;

interface RouteSpec {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  legacyPermission: string;
  /** Extra legacy codes that also open the route (e.g. items are visible to purchasing roles). */
  anyOf?: string[];
  body?: unknown;
}

/** Representative route per legacy permission (docs/phase-2/route-permission-matrix.md). */
const ROUTES: RouteSpec[] = [
  { method: 'get', path: '/api/vendors', legacyPermission: 'vendor.view' },
  { method: 'post', path: '/api/vendors', legacyPermission: 'vendor.create', body: {} },
  { method: 'get', path: '/api/items', legacyPermission: 'item.view', anyOf: ['purchase_order.view', 'purchase_order.create', 'purchase_order.edit'] },
  { method: 'post', path: '/api/items', legacyPermission: 'item.create', body: {} },
  { method: 'get', path: '/api/purchase-orders', legacyPermission: 'purchase_order.view' },
  { method: 'post', path: '/api/purchase-orders', legacyPermission: 'purchase_order.create', body: {} },
  { method: 'post', path: `/api/purchase-orders/${randomUUID()}/issue`, legacyPermission: 'purchase_order.issue' },
  { method: 'post', path: `/api/purchase-orders/${randomUUID()}/cancel`, legacyPermission: 'purchase_order.cancel', body: {} },
  { method: 'delete', path: `/api/purchase-orders/${randomUUID()}`, legacyPermission: 'purchase_order.delete' },
  { method: 'get', path: '/api/purchase-receives', legacyPermission: 'purchase_receive.view' },
  { method: 'post', path: '/api/purchase-receives', legacyPermission: 'purchase_receive.create', body: {} },
  { method: 'post', path: `/api/purchase-receives/${randomUUID()}/cancel`, legacyPermission: 'purchase_receive.cancel', body: {} },
  { method: 'get', path: '/api/settings/locations', legacyPermission: 'settings.view', anyOf: ['vendor.view', 'purchase_order.view', 'item.view', 'settings.manage'] },
  { method: 'post', path: '/api/settings/locations', legacyPermission: 'settings.manage', body: {} },
];

function roleAllows(rolePerms: string[], legacyPermission: string): boolean {
  const mapped = LEGACY_PERMISSION_MAP[legacyPermission] ?? [];
  return mapped.some((c) => rolePerms.includes(c));
}

before(async () => {
  await resetDatabase();
  configureTokenVerifier(new StaticKeyProvider(testKeys().publicKeyPem));
  owner = await registerOrg(app, 'Matrix Org', 'owner@matrix.test');
});
after(async () => {
  configureTokenVerifier(null);
  await prisma.$disconnect();
});

describe('route x role matrix (legacy API with platform tokens)', () => {
  for (const role of SYSTEM_ROLES) {
    it(`${role.key}: every route answers 403 exactly when the role lacks the mapped permission`, async () => {
      const perms = resolveRolePermissions(role);
      const token = mintToken({ sub: owner.userId, typ: 'tenant', tid: owner.orgId, mid: randomUUID(), perms, pv: 1, sid: randomUUID(), email: owner.email, name: role.key });
      for (const route of ROUTES) {
        const req = request(app)[route.method](route.path).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', randomUUID());
        const res = route.body !== undefined ? await req.send(route.body as object) : await req;
        const allowed = [route.legacyPermission, ...(route.anyOf ?? [])].some((p) => roleAllows(perms, p));
        if (allowed) assert.notEqual(res.status, 403, `${role.key} ${route.method.toUpperCase()} ${route.path} should be permitted (${route.legacyPermission}) but got 403`);
        else assert.equal(res.status, 403, `${role.key} ${route.method.toUpperCase()} ${route.path} should be forbidden (${route.legacyPermission}) but got ${res.status}`);
        assert.notEqual(res.status, 500, `${route.path} crashed: ${JSON.stringify(res.body)}`);
      }
    });
  }
});
