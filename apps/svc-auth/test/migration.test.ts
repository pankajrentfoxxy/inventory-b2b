/**
 * Legacy identity migration: organizations -> tenants (same ids), users -> identities (bcrypt kept),
 * memberships -> bootstrap rows; counts reconcile; migrated users can log in and are rehashed.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Client } from 'pg';
import request from 'supertest';
import { migrateLegacyIdentity } from '../scripts/migrate-legacy.js';
import { bootAuth, testConfig, type FakeTenantStatus } from './setup.js';
import type { AuthRuntime } from '../src/service.js';

const LEGACY_URL = process.env.LEGACY_TEST_DATABASE_URL ?? 'postgresql://postgres:password123@localhost:5433/b2b_inventory_test';
const TENANT_URL = 'postgresql://postgres:password123@localhost:5433/tenant_test';
const orgId = randomUUID();
const ownerId = randomUUID();
const viewerId = randomUUID();
let rt: AuthRuntime;
let tenantStatus: FakeTenantStatus;
let legacyAvailable = true;

async function seedLegacy() {
  const c = new Client({ connectionString: LEGACY_URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query(`DELETE FROM organization_members WHERE organization_id = $1`, [orgId]);
    await c.query(`DELETE FROM roles WHERE organization_id = $1`, [orgId]);
    await c.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    await c.query(`DELETE FROM users WHERE email IN ('mig-owner@legacy.test','mig-viewer@legacy.test')`);
    await c.query(`INSERT INTO organizations (id, name, slug, country_code, base_currency, created_at, updated_at) VALUES ($1, 'Legacy Traders', $2, 'IN', 'INR', now(), now())`, [orgId, `legacy-${orgId.slice(0, 8)}`]);
    const ownerRole = randomUUID();
    const viewerRole = randomUUID();
    await c.query(`INSERT INTO roles (id, organization_id, code, name, description, is_system, created_at, updated_at) VALUES ($1, $2, 'OWNER', 'Owner', '', true, now(), now()), ($3, $2, 'VIEWER', 'Viewer', '', true, now(), now())`, [ownerRole, orgId, viewerRole]);
    const hash = await bcrypt.hash('LegacyPassw0rd!', 10);
    await c.query(`INSERT INTO users (id, email, password_hash, name, is_active, created_at, updated_at) VALUES ($1, 'mig-owner@legacy.test', $3, 'Legacy Owner', true, now(), now()), ($2, 'mig-viewer@legacy.test', $3, 'Legacy Viewer', true, now(), now())`, [ownerId, viewerId, hash]);
    await c.query(`INSERT INTO organization_members (id, organization_id, user_id, role_id, status, is_owner, created_at, updated_at) VALUES ($1, $2, $3, $4, 'ACTIVE', true, now(), now()), ($5, $2, $6, $7, 'ACTIVE', false, now(), now())`, [randomUUID(), orgId, ownerId, ownerRole, randomUUID(), viewerId, viewerRole]);
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    await c.end();
  }
}

before(async () => {
  try {
    await seedLegacy();
  } catch (err) {
    legacyAvailable = false;
    console.warn(`legacy test database not available, skipping migration tests: ${(err as Error).message}`);
  }
  ({ runtime: rt, tenantStatus } = await bootAuth());
  const tenant = new Client({ connectionString: TENANT_URL });
  await tenant.connect();
  await tenant.query('TRUNCATE TABLE tenant_status_history, tenant_settings, vendor_applications, tenants CASCADE').catch(() => undefined);
  await tenant.end();
});
after(async () => {
  await rt.stop();
});

describe('legacy identity migration', { skip: !legacyAvailable }, () => {
  it('dry-run reports counts without writing; the real run migrates with preserved ids and reconciles', async () => {
    const config = testConfig();
    const urls = { legacy: LEGACY_URL, tenant: TENANT_URL, auth: config.MIGRATE_DATABASE_URL! };
    const dry = await migrateLegacyIdentity(urls, { dryRun: true });
    assert.ok(dry.organizations.legacy >= 1);
    assert.equal(await rt.prisma.user.count({ where: { email: 'mig-owner@legacy.test' } }), 0, 'dry run wrote nothing');

    const report = await migrateLegacyIdentity(urls);
    assert.equal(report.organizations.migrated + report.organizations.skipped, report.organizations.legacy);
    assert.equal(report.users.migrated + report.users.skipped, report.users.legacy);
    assert.equal(report.memberships.migrated + report.memberships.skipped, report.memberships.legacy);

    const user = await rt.prisma.user.findUniqueOrThrow({ where: { email: 'mig-owner@legacy.test' } });
    assert.equal(user.id, ownerId, 'user id preserved');
    assert.equal(user.passwordAlgo, 'bcrypt');
    const membership = await rt.prisma.tenantMembershipBootstrap.findUniqueOrThrow({ where: { tenantId_userId: { tenantId: orgId, userId: ownerId } } });
    assert.equal(membership.role, 'OWNER');
    assert.equal((await rt.prisma.tenantMembershipBootstrap.findUniqueOrThrow({ where: { tenantId_userId: { tenantId: orgId, userId: viewerId } } })).role, 'VIEWER');
    assert.equal((await rt.prisma.tenantStatusReplica.findUniqueOrThrow({ where: { tenantId: orgId } })).status, 'ACTIVE');

    const tenant = new Client({ connectionString: TENANT_URL });
    await tenant.connect();
    const row = (await tenant.query('SELECT id, status, source, owner_email FROM tenants WHERE id = $1', [orgId])).rows[0];
    await tenant.end();
    assert.equal(row.status, 'ACTIVE');
    assert.equal(row.source, 'LEGACY_MIGRATION');
    assert.equal(row.owner_email, 'mig-owner@legacy.test');

    // Re-run is idempotent.
    const again = await migrateLegacyIdentity(urls);
    assert.equal(again.organizations.migrated, 0);
    assert.equal(again.users.migrated, 0);

    // Migrated user logs in with the legacy password and gets rehashed to argon2id (the test's fake
    // status source stands in for svc-tenant; the replica row was asserted above).
    tenantStatus.set(orgId, 'ACTIVE');
    const login = await request(rt.app).post('/api/v1/auth/login').send({ email: 'mig-owner@legacy.test', password: 'LegacyPassw0rd!' });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    assert.equal(login.body.data.tenant.id, orgId);
    assert.equal((await rt.prisma.user.findUniqueOrThrow({ where: { id: ownerId } })).passwordAlgo, 'argon2id');
  });
});
