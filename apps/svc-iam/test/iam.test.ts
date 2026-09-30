/**
 * svc-iam (phase-02 step 9): seeding from events, roles and anti-escalation, last-owner protection,
 * permission-version propagation, invitations (expired 410, double accept, duplicate pending),
 * member transitions, warehouse scope, platform permissions in tenant roles rejected, tenant
 * isolation under RLS, internal API for svc-auth, bootstrap migration.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { EVENT_TYPES, TENANT_PERMISSION_CODES, rk } from '@b2b/contracts';
import { uuidv7, type EventEnvelope } from '@b2b/platform-kit';
import { InMemoryBroker, serviceToken, tenantToken } from '@b2b/test-kit';
import { bootIam, type FakeIdentity } from './setup.js';
import type { IamRuntime } from '../src/service.js';

let rt: IamRuntime;
let broker: InMemoryBroker;
let identity: FakeIdentity;

const tenantA = randomUUID();
const tenantB = randomUUID();
const ownerA = { userId: randomUUID(), email: 'owner@a.test', name: 'Owner A' };
const ownerB = { userId: randomUUID(), email: 'owner@b.test', name: 'Owner B' };

function ownerInvited(tenantId: string, owner: { userId: string; email: string; name: string }): EventEnvelope {
  return { eventId: uuidv7(), eventType: EVENT_TYPES.AUTH_OWNER_INVITED, eventVersion: 1, occurredAt: new Date().toISOString(), tenantId, producer: 'svc-auth', correlationId: 'c', causationId: null, actor: { type: 'system', id: null }, aggregate: { type: 'user', id: owner.userId, version: null }, payload: { userId: owner.userId, tenantId, email: owner.email, fullName: owner.name, inviteToken: 'x', expiresAt: new Date().toISOString(), alreadyActive: false } };
}
function tenantActivated(tenantId: string): EventEnvelope {
  return { eventId: uuidv7(), eventType: EVENT_TYPES.TENANT_ACTIVATED, eventVersion: 1, occurredAt: new Date().toISOString(), tenantId, producer: 'svc-tenant', correlationId: 'c', causationId: null, actor: { type: 'user', id: null }, aggregate: { type: 'tenant', id: tenantId, version: 2 }, payload: { tenantId, code: 'T', legalName: 'T', displayName: 'T', status: 'ACTIVE', previousStatus: 'APPROVED', reason: null, ownerName: 'o', ownerEmail: 'o@t.test', actorId: null, occurredAt: new Date().toISOString() } };
}

/** Token for a real membership: claims mirror what svc-auth would issue from iam data. */
async function tokenFor(tenantId: string, userId: string) {
  const memberships = await rt.service.membershipsForUser(userId);
  const m = memberships.find((x) => x.tenantId === tenantId);
  if (!m) throw new Error('no membership');
  return tenantToken({ tenantId, userId, membershipId: m.membershipId, perms: m.permissions, pv: m.permissionVersion, email: 'x@y.test', name: 'User' });
}
const api = (token: string) => ({
  get: (p: string) => request(rt.app).get(p).set('Authorization', `Bearer ${token}`),
  post: (p: string, body: unknown = {}) => request(rt.app).post(p).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', randomUUID()).send(body as object),
  put: (p: string, body: unknown, version?: number) => {
    const r = request(rt.app).put(p).set('Authorization', `Bearer ${token}`);
    return (version !== undefined ? r.set('If-Match', String(version)) : r).send(body as object);
  },
  del: (p: string) => request(rt.app).delete(p).set('Authorization', `Bearer ${token}`),
});

async function roleId(tenantId: string, key: string): Promise<string> {
  const roles = await rt.service.listRoles(tenantId);
  return roles.find((r) => r.key === key)!.id;
}

/** Invites, accepts and returns the new member (membership id + token). */
async function addMember(tenantId: string, inviterToken: string, email: string, roleKeys: string[], warehouseIds: string[] = []) {
  const roleIds = await Promise.all(roleKeys.map((k) => roleId(tenantId, k)));
  const inv = await api(inviterToken).post('/api/v1/iam/invitations', { email, roleIds, warehouseIds });
  assert.equal(inv.status, 201, JSON.stringify(inv.body));
  const created = (await rt.prisma.outboxEvent.findMany({ where: { eventType: EVENT_TYPES.IAM_INVITATION_CREATED }, orderBy: { createdAt: 'desc' }, take: 1 }))[0].envelope as unknown as EventEnvelope<{ acceptToken: string }>;
  const accepted = await request(rt.app).post('/api/v1/iam/invitations/accept').send({ token: created.payload.acceptToken, password: 'Memb3rPassword1', fullName: 'New Member' });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  const userId = accepted.body.data.userId as string;
  return { membershipId: accepted.body.data.membershipId as string, userId, token: await tokenFor(tenantId, userId), invitationId: inv.body.data.id as string };
}

before(async () => {
  ({ runtime: rt, broker, identity } = await bootIam());
  await broker.publish(rk(EVENT_TYPES.TENANT_ACTIVATED), tenantActivated(tenantA));
  await broker.publish(rk(EVENT_TYPES.AUTH_OWNER_INVITED), ownerInvited(tenantA, ownerA));
  await broker.publish(rk(EVENT_TYPES.AUTH_OWNER_INVITED), ownerInvited(tenantA, ownerA)); // redelivery
  await broker.publish(rk(EVENT_TYPES.TENANT_ACTIVATED), tenantActivated(tenantB));
  await broker.publish(rk(EVENT_TYPES.AUTH_OWNER_INVITED), ownerInvited(tenantB, ownerB));
  await broker.drain();
});
after(async () => {
  await rt.stop();
});

describe('seeding', () => {
  it('seeds the 10 system roles per tenant and one OWNER membership with every tenant permission', async () => {
    const roles = await rt.service.listRoles(tenantA);
    assert.equal(roles.length, 10);
    const owner = roles.find((r) => r.key === 'OWNER')!;
    assert.deepEqual(owner.permissionCodes, [...TENANT_PERMISSION_CODES].sort());
    assert.ok(roles.every((r) => r.isSystem));
    assert.ok(roles.every((r) => r.permissionCodes.every((c) => !c.startsWith('platform.'))), 'no platform permission in tenant roles');
    const members = await rt.service.listMembers(tenantA, {});
    assert.equal(members.length, 1, 'one owner despite the redelivered event');
    assert.equal(members[0].status, 'ACTIVE');
    assert.deepEqual(members[0].roles.map((r) => r.key), ['OWNER']);
    const catalog = await request(rt.app).get('/api/v1/iam/permissions').set('Authorization', `Bearer ${await tokenFor(tenantA, ownerA.userId)}`);
    assert.equal(catalog.status, 200);
    assert.ok(catalog.body.data.some((m: { module: string }) => m.module === 'purchase'));
    assert.ok(!catalog.body.data.some((m: { module: string }) => m.module === 'platform'));
  });
});

describe('roles and anti-escalation', () => {
  it('creates, clones, edits and deletes custom roles within the caller rank and permissions', async () => {
    const owner = await tokenFor(tenantA, ownerA.userId);
    const created = await api(owner).post('/api/v1/iam/roles', { name: 'Ops Lead', permissionCodes: ['purchase.view', 'grn.view', 'inventory.view'], rank: 40 });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.data.key, 'custom_ops_lead');
    const cloned = await api(owner).post(`/api/v1/iam/roles/${created.body.data.id}/clone`, { name: 'Ops Lead Copy' });
    assert.equal(cloned.status, 201);
    assert.deepEqual(cloned.body.data.permissionCodes, ['grn.view', 'inventory.view', 'purchase.view']);
    const tooHigh = await api(owner).post('/api/v1/iam/roles', { name: 'Shadow Owner', permissionCodes: ['purchase.view'], rank: 99 });
    assert.equal(tooHigh.status, 201, 'owner (100) may create rank 99');
    const platform = await api(owner).post('/api/v1/iam/roles', { name: 'Sneaky', permissionCodes: ['platform.tenant.approve'], rank: 10 });
    assert.equal(platform.status, 422);
    assert.equal(platform.body.error.code, 'IAM_PLATFORM_PERMISSION_IN_TENANT');
    const unknown = await api(owner).post('/api/v1/iam/roles', { name: 'Typo', permissionCodes: ['purchase.fly'], rank: 10 });
    assert.equal(unknown.status, 422);

    const systemRole = await roleId(tenantA, 'PURCHASE_MANAGER');
    const immutable = await api(owner).put(`/api/v1/iam/roles/${systemRole}/permissions`, { permissionCodes: ['purchase.view'] });
    assert.equal(immutable.status, 422);
    assert.equal(immutable.body.error.code, 'IAM_SYSTEM_ROLE_IMMUTABLE');
    const stale = await api(owner).put(`/api/v1/iam/roles/${created.body.data.id}/permissions`, { permissionCodes: ['purchase.view'] }, 9);
    assert.equal(stale.status, 409);
    const edited = await api(owner).put(`/api/v1/iam/roles/${created.body.data.id}/permissions`, { permissionCodes: ['purchase.view', 'purchase.create'] }, 0);
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.data.version, 1);
    const removed = await api(owner).del(`/api/v1/iam/roles/${cloned.body.data.id}`);
    assert.equal(removed.status, 200);
    assert.equal((await api(owner).del(`/api/v1/iam/roles/${systemRole}`)).status, 422);
  });

  it('a purchase manager cannot create roles, grant what they do not hold, assign upward, or edit their own roles', async () => {
    const owner = await tokenFor(tenantA, ownerA.userId);
    const pm = await addMember(tenantA, owner, 'pm@a.test', ['PURCHASE_MANAGER']);
    const noPerm = await api(pm.token).post('/api/v1/iam/roles', { name: 'X', permissionCodes: ['purchase.view'], rank: 10 });
    assert.equal(noPerm.status, 403);
    assert.equal(noPerm.body.error.code, 'FORBIDDEN');
    assert.equal(noPerm.body.error.details[0].message, 'iam.role.manage');

    // Give the manager iam.role.manage + iam.role.assign through a custom role to reach the escalation rules.
    const helper = await api(owner).post('/api/v1/iam/roles', { name: 'Role Admin', permissionCodes: ['iam.role.manage', 'iam.role.assign', 'iam.member.view', 'iam.member.invite'], rank: 60 });
    assert.equal(helper.status, 201);
    const pmRole = await roleId(tenantA, 'PURCHASE_MANAGER');
    const setRoles = await api(owner).post(`/api/v1/iam/members/${pm.membershipId}/roles`, { roleIds: [pmRole, helper.body.data.id] });
    assert.equal(setRoles.status, 200, JSON.stringify(setRoles.body));
    const pmToken = await tokenFor(tenantA, pm.userId);

    const escalate = await api(pmToken).post('/api/v1/iam/roles', { name: 'Finance Plus', permissionCodes: ['billing.manage'], rank: 20 });
    assert.equal(escalate.status, 403);
    assert.equal(escalate.body.error.code, 'IAM_ESCALATION_DENIED');
    const tooHigh = await api(pmToken).post('/api/v1/iam/roles', { name: 'Peer', permissionCodes: ['purchase.view'], rank: 60 });
    assert.equal(tooHigh.status, 403, 'rank must be below the caller max rank (60)');
    const ok = await api(pmToken).post('/api/v1/iam/roles', { name: 'Junior Buyer', permissionCodes: ['purchase.view', 'purchase.create'], rank: 20 });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));

    const ownerRole = await roleId(tenantA, 'OWNER');
    const viewer = await addMember(tenantA, owner, 'viewer@a.test', ['VIEWER']);
    const assignOwner = await api(pmToken).post(`/api/v1/iam/members/${viewer.membershipId}/roles`, { roleIds: [ownerRole] });
    assert.equal(assignOwner.status, 403);
    assert.equal(assignOwner.body.error.code, 'IAM_ESCALATION_DENIED');
    const self = await api(pmToken).post(`/api/v1/iam/members/${pm.membershipId}/roles`, { roleIds: [pmRole] });
    assert.equal(self.status, 403);
    assert.equal(self.body.error.code, 'IAM_SELF_ROLE_CHANGE');
    const ownerMembership = (await rt.service.listMembers(tenantA, {})).find((m) => m.userId === ownerA.userId)!;
    const demoteOwner = await api(pmToken).post(`/api/v1/iam/members/${ownerMembership.id}/roles`, { roleIds: [pmRole] });
    assert.equal(demoteOwner.status, 403, 'cannot touch members ranked above you');
  });

  it('protects the last active owner from suspension, removal and demotion', async () => {
    const owner = await tokenFor(tenantA, ownerA.userId);
    const ownerMembership = (await rt.service.listMembers(tenantA, {})).find((m) => m.userId === ownerA.userId)!;
    const admin = await addMember(tenantA, owner, 'admin@a.test', ['ADMIN']);
    const pmRole = await roleId(tenantA, 'PURCHASE_MANAGER');
    const demote = await api(admin.token).post(`/api/v1/iam/members/${ownerMembership.id}/roles`, { roleIds: [pmRole] });
    assert.equal(demote.status, 403, 'admin (90) cannot change an owner (100)');
    // A second owner makes the first one replaceable.
    const ownerRole = await roleId(tenantA, 'OWNER');
    const second = await addMember(tenantA, owner, 'owner2@a.test', ['OWNER']);
    const owner2 = second.token;
    // Owners hold iam.owner.transfer, so they may act on peers of equal rank.
    const suspendSecond = await api(owner).post(`/api/v1/iam/members/${second.membershipId}/suspend`, { reason: 'handover' });
    assert.equal(suspendSecond.status, 200, JSON.stringify(suspendSecond.body));
    // Now the first owner is the only active owner: the last-owner rule forbids removing or demoting them.
    await assert.rejects(rt.service.checkLastOwnerRule(tenantA, ownerMembership.id), (err: { code?: string }) => err.code === 'IAM_LAST_OWNER');
    await assert.rejects(rt.service.checkLastOwnerRule(tenantA, ownerMembership.id, [pmRole]), (err: { code?: string }) => err.code === 'IAM_LAST_OWNER');
    await rt.service.checkLastOwnerRule(tenantA, ownerMembership.id, [ownerRole]); // staying an owner is fine
    assert.equal((await api(owner).post(`/api/v1/iam/members/${second.membershipId}/reactivate`, { reason: 'back' })).status, 200);
    await rt.service.checkLastOwnerRule(tenantA, ownerMembership.id); // two active owners again
    assert.equal((await api(owner2).post(`/api/v1/iam/members/${ownerMembership.id}/remove`, { reason: 'self-service by peer' })).status, 200, 'peers with owner.transfer may act on each other');
    // Restore the primary owner for later tests.
    await broker.publish(rk(EVENT_TYPES.AUTH_OWNER_INVITED), ownerInvited(tenantA, ownerA));
    await broker.drain();
    assert.equal((await rt.service.effectivePermissions(ownerMembership.id))!.status, 'ACTIVE');
  });
});

describe('invitations', () => {
  it('rejects duplicate pending invites, expired and reused tokens; accepted members get their roles and scope', async () => {
    const owner = await tokenFor(tenantA, ownerA.userId);
    const execRole = await roleId(tenantA, 'PURCHASE_EXECUTIVE');
    const wh = randomUUID();
    const inv = await api(owner).post('/api/v1/iam/invitations', { email: 'exec@a.test', roleIds: [execRole], warehouseIds: [wh] });
    assert.equal(inv.status, 201, JSON.stringify(inv.body));
    const dup = await api(owner).post('/api/v1/iam/invitations', { email: 'EXEC@a.test', roleIds: [execRole] });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'IAM_INVITE_PENDING_EXISTS');
    const missingKey = await request(rt.app).post('/api/v1/iam/invitations').set('Authorization', `Bearer ${owner}`).send({ email: 'k@a.test', roleIds: [execRole] });
    assert.equal(missingKey.status, 400);

    const event = (await rt.prisma.outboxEvent.findMany({ where: { eventType: EVENT_TYPES.IAM_INVITATION_CREATED }, orderBy: { createdAt: 'desc' }, take: 1 }))[0].envelope as unknown as EventEnvelope<{ acceptToken: string; roleKeys: string[] }>;
    assert.deepEqual(event.payload.roleKeys, ['PURCHASE_EXECUTIVE']);
    const bad = await request(rt.app).post('/api/v1/iam/invitations/accept').send({ token: 'nope-nope-nope', password: 'Memb3rPassword1' });
    assert.equal(bad.status, 401);
    const ok = await request(rt.app).post('/api/v1/iam/invitations/accept').send({ token: event.payload.acceptToken, password: 'Memb3rPassword1', fullName: 'Exec A' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(identity.users.get('exec@a.test')?.status, 'ACTIVE', 'identity created in svc-auth');
    const twice = await request(rt.app).post('/api/v1/iam/invitations/accept').send({ token: event.payload.acceptToken, password: 'Memb3rPassword1' });
    assert.equal(twice.status, 401);

    const info = await rt.service.effectivePermissions(ok.body.data.membershipId);
    assert.deepEqual(info!.roleKeys, ['PURCHASE_EXECUTIVE']);
    assert.equal(info!.allWarehouses, false);
    assert.deepEqual(info!.warehouseIds, [wh]);
    assert.ok(info!.permissions.includes('grn.create'));
    assert.ok(!info!.permissions.includes('purchase.approve'));
    const me = await request(rt.app).get('/api/v1/iam/me').set('Authorization', `Bearer ${await tokenFor(tenantA, ok.body.data.userId)}`);
    assert.equal(me.status, 200);
    assert.deepEqual(me.body.data.warehouseIds, [wh]);

    // Expired invitation -> 410; resend refreshes token and expiry; revoke ends it.
    const late = await api(owner).post('/api/v1/iam/invitations', { email: 'late@a.test', roleIds: [execRole] });
    await rt.service.platformTx((tx) => tx.$executeRaw`UPDATE "invitations" SET "expires_at" = now() - interval '1 hour' WHERE "id" = ${late.body.data.id}::uuid`);
    const lateEvent = (await rt.prisma.outboxEvent.findMany({ where: { eventType: EVENT_TYPES.IAM_INVITATION_CREATED }, orderBy: { createdAt: 'desc' }, take: 1 }))[0].envelope as unknown as EventEnvelope<{ acceptToken: string }>;
    const expired = await request(rt.app).post('/api/v1/iam/invitations/accept').send({ token: lateEvent.payload.acceptToken, password: 'Memb3rPassword1' });
    assert.equal(expired.status, 410);
    assert.equal(expired.body.error.code, 'IAM_INVITE_EXPIRED');
    const resent = await api(owner).post(`/api/v1/iam/invitations/${late.body.data.id}/resend`);
    assert.equal(resent.status, 409, 'an expired invitation is not pending anymore');
    const fresh = await api(owner).post('/api/v1/iam/invitations', { email: 'late@a.test', roleIds: [execRole] });
    assert.equal(fresh.status, 201);
    assert.equal((await api(owner).post(`/api/v1/iam/invitations/${fresh.body.data.id}/resend`)).status, 200);
    assert.equal((await api(owner).post(`/api/v1/iam/invitations/${fresh.body.data.id}/revoke`)).status, 200);
    assert.equal((await api(owner).post(`/api/v1/iam/invitations/${fresh.body.data.id}/resend`)).status, 409);
  });
});

describe('membership changes and permission versions', () => {
  it('bumps permission versions and emits events on role edits, member role changes, suspension and removal', async () => {
    const owner = await tokenFor(tenantA, ownerA.userId);
    const custom = await api(owner).post('/api/v1/iam/roles', { name: 'Store Keeper', permissionCodes: ['inventory.view'], rank: 25 });
    const member = await addMember(tenantA, owner, 'keeper@a.test', ['VIEWER']);
    const setRoles = await api(owner).post(`/api/v1/iam/members/${member.membershipId}/roles`, { roleIds: [custom.body.data.id] });
    assert.equal(setRoles.status, 200);
    const pv1 = setRoles.body.data.permissionVersion as number;
    assert.ok(pv1 >= 2);

    const edit = await api(owner).put(`/api/v1/iam/roles/${custom.body.data.id}/permissions`, { permissionCodes: ['inventory.view', 'inventory.adjust'] });
    assert.equal(edit.status, 200);
    assert.equal(edit.body.data.affectedMemberships, 1);
    const info = await rt.service.effectivePermissions(member.membershipId);
    assert.equal(info!.permissionVersion, pv1 + 1);
    assert.ok(info!.permissions.includes('inventory.adjust'));
    const changed = await rt.prisma.outboxEvent.findMany({ where: { eventType: EVENT_TYPES.IAM_PERMISSIONS_CHANGED } });
    const last = changed.at(-1)!.envelope as unknown as EventEnvelope<{ memberships: { membershipId: string; permissionVersion: number }[] }>;
    assert.deepEqual(last.payload.memberships, [{ membershipId: member.membershipId, permissionVersion: pv1 + 1 }]);

    const suspended = await api(owner).post(`/api/v1/iam/members/${member.membershipId}/suspend`, { reason: 'left the company' });
    assert.equal(suspended.status, 200);
    assert.equal((await rt.service.effectivePermissions(member.membershipId))!.status, 'SUSPENDED');
    assert.equal((await api(owner).post(`/api/v1/iam/members/${member.membershipId}/suspend`, { reason: 'again' })).status, 409);
    const reactivated = await api(owner).post(`/api/v1/iam/members/${member.membershipId}/reactivate`, { reason: 'came back' });
    assert.equal(reactivated.status, 200);
    const removed = await api(owner).post(`/api/v1/iam/members/${member.membershipId}/remove`, { reason: 'contract ended' });
    assert.equal(removed.status, 200);
    const types = (await rt.prisma.outboxEvent.findMany({ where: { aggregateId: member.membershipId }, orderBy: { createdAt: 'asc' } })).map((e) => e.eventType);
    assert.deepEqual(types.filter((t) => t.startsWith('iam.membership.')), [EVENT_TYPES.IAM_MEMBERSHIP_ACTIVATED, EVENT_TYPES.IAM_MEMBERSHIP_SUSPENDED, EVENT_TYPES.IAM_MEMBERSHIP_REACTIVATED, EVENT_TYPES.IAM_MEMBERSHIP_REMOVED]);
    const audits = (await rt.prisma.outboxEvent.findMany({ where: { eventType: EVENT_TYPES.AUDIT_RECORDED, tenantId: tenantA } })).map((e) => (e.envelope as unknown as EventEnvelope<{ action: string; oldValue: unknown; newValue: unknown }>).payload);
    const roleChange = audits.find((a) => a.action === 'USER_ROLE_CHANGED' && (a as { entityId?: string }).entityId === member.membershipId);
    assert.deepEqual(roleChange!.oldValue, { roles: ['VIEWER'] });
    assert.deepEqual(roleChange!.newValue, { roles: ['custom_store_keeper'] });
    assert.ok(audits.some((a) => a.action === 'ROLE_PERMISSIONS_CHANGED'));
    const memberAfterRemoval = await request(rt.app).get('/api/v1/iam/me').set('Authorization', `Bearer ${member.token}`);
    assert.equal(memberAfterRemoval.status, 200);
    assert.equal(memberAfterRemoval.body.data.status, 'REMOVED');
  });

  it('warehouse scope can be narrowed and widened', async () => {
    const owner = await tokenFor(tenantA, ownerA.userId);
    const member = await addMember(tenantA, owner, 'scoped@a.test', ['INVENTORY_MANAGER']);
    const wh = randomUUID();
    const narrow = await api(owner).put(`/api/v1/iam/members/${member.membershipId}/warehouse-scope`, { allWarehouses: false, warehouseIds: [wh] });
    assert.equal(narrow.status, 200, JSON.stringify(narrow.body));
    assert.deepEqual((await rt.service.effectivePermissions(member.membershipId))!.warehouseIds, [wh]);
    const invalid = await api(owner).put(`/api/v1/iam/members/${member.membershipId}/warehouse-scope`, { allWarehouses: false, warehouseIds: [] });
    assert.equal(invalid.status, 422);
    const widen = await api(owner).put(`/api/v1/iam/members/${member.membershipId}/warehouse-scope`, { allWarehouses: true, warehouseIds: [] });
    assert.equal(widen.body.data.allWarehouses, true);
  });
});

describe('tenant isolation (RLS with the runtime role)', () => {
  it('roles, members and invitations of tenant B are invisible and untouchable from tenant A', async () => {
    const ownerAToken = await tokenFor(tenantA, ownerA.userId);
    const ownerBToken = await tokenFor(tenantB, ownerB.userId);
    const rolesB = await api(ownerBToken).get('/api/v1/iam/roles');
    assert.equal(rolesB.body.data.length, 10);
    const bRoleId = rolesB.body.data.find((r: { key: string }) => r.key === 'VIEWER').id;
    const membersB = await api(ownerBToken).get('/api/v1/iam/members');
    assert.equal(membersB.body.data.length, 1);
    const bMembership = membersB.body.data[0].id;

    const rolesA = await api(ownerAToken).get('/api/v1/iam/roles');
    assert.ok(!rolesA.body.data.some((r: { id: string }) => r.id === bRoleId));
    const membersA = await api(ownerAToken).get('/api/v1/iam/members');
    assert.ok(!membersA.body.data.some((m: { id: string }) => m.id === bMembership));
    assert.equal((await api(ownerAToken).post(`/api/v1/iam/members/${bMembership}/suspend`, { reason: 'cross tenant' })).status, 404);
    assert.equal((await api(ownerAToken).put(`/api/v1/iam/roles/${bRoleId}/permissions`, { permissionCodes: [] })).status, 404);
    assert.equal((await api(ownerAToken).del(`/api/v1/iam/roles/${bRoleId}`)).status, 404);
    const crossInvite = await api(ownerAToken).post('/api/v1/iam/invitations', { email: 'x@a.test', roleIds: [bRoleId] });
    assert.equal(crossInvite.status, 422, 'a role id from another tenant is unknown');

    // Raw SQL under tenant A context sees only A rows (RLS, NOBYPASSRLS runtime role).
    const visible = await rt.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA}, true), set_config('app.platform', 'false', true)`;
      return tx.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "memberships" WHERE "tenant_id" = ${tenantB}::uuid`;
    });
    assert.equal(Number(visible[0].n), 0);
    const noContext = await rt.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "memberships"`;
    assert.equal(Number(noContext[0].n), 0, 'without any context nothing is visible');
  });
});

describe('internal API for svc-auth', () => {
  it('returns memberships with effective permissions to service tokens only', async () => {
    const svc = serviceToken('svc-auth', 'svc-iam');
    const res = await request(rt.app).get(`/internal/v1/users/${ownerA.userId}/memberships?status=ACTIVE`).set('Authorization', `Bearer ${svc}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].tenantId, tenantA);
    assert.deepEqual(res.body.data[0].roleKeys, ['OWNER']);
    const eff = await request(rt.app).get(`/internal/v1/memberships/${res.body.data[0].membershipId}/effective-permissions`).set('Authorization', `Bearer ${svc}`);
    assert.equal(eff.status, 200);
    assert.equal(eff.body.data.permissions.length, TENANT_PERMISSION_CODES.length);
    assert.equal((await request(rt.app).get(`/internal/v1/memberships/${randomUUID()}/effective-permissions`).set('Authorization', `Bearer ${svc}`)).status, 404);
    assert.equal((await request(rt.app).get(`/internal/v1/users/${ownerA.userId}/memberships`).set('Authorization', `Bearer ${await tokenFor(tenantA, ownerA.userId)}`)).status, 401);
    assert.equal((await request(rt.app).get(`/internal/v1/users/${ownerA.userId}/memberships`).set('Authorization', `Bearer ${serviceToken('svc-auth', 'svc-tenant')}`)).status, 401, 'wrong audience');

    const staff = await request(rt.app).post('/internal/v1/platform-staff').set('Authorization', `Bearer ${svc}`).send({ userId: randomUUID(), email: 'admin@platform.test', fullName: 'Admin', roleKeys: ['PLATFORM_REVIEWER'] });
    assert.equal(staff.status, 200, JSON.stringify(staff.body));
    const perms = await request(rt.app).get(`/internal/v1/users/${(await rt.service.listPlatformStaff())[0].userId}/platform-permissions`).set('Authorization', `Bearer ${svc}`);
    assert.ok(perms.body.data.permissions.includes('platform.tenant.approve'));
    assert.ok(!perms.body.data.permissions.includes('platform.iam.manage'));
  });
});
