/**
 * svc-party (phase-03 step 9): GSTIN format / checksum / state mismatch, registered-needs-GSTIN,
 * duplicate GSTIN per type, generated codes, If-Match, block/unblock, delete guard with references,
 * addresses/contacts/bank accounts (masked + audited reveal), RLS isolation, internal snapshots, events.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { EVENT_TYPES, rk } from '@b2b/contracts';
import { StaticKeyProvider, loadEnv, uuidv7, type EventEnvelope } from '@b2b/platform-kit';
import { InMemoryBroker, serviceToken, tenantToken, testKeys, truncateAll } from '@b2b/test-kit';
import { partyEnvSchema } from '../src/config.js';
import { createPartyRuntime, type PartyRuntime } from '../src/service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let rt: PartyRuntime;
let broker: InMemoryBroker;
const tenantA = randomUUID();
const tenantB = randomUUID();
const ownerA = tenantToken({ tenantId: tenantA, name: 'Owner A' });
const ownerB = tenantToken({ tenantId: tenantB, name: 'Owner B' });
const buyer = tenantToken({ tenantId: tenantA, perms: ['purchase.view', 'supplier.view'] });
const GSTIN_MH = '27AAPFU0939F1ZV';
const GSTIN_KA = '29ABCDE1234F1ZW';

const api = (token: string) => ({
  get: (p: string) => request(rt.app).get(p).set('Authorization', `Bearer ${token}`),
  post: (p: string, body: unknown = {}) => request(rt.app).post(p).set('Authorization', `Bearer ${token}`).send(body as object),
  patch: (p: string, body: unknown, version?: number) => {
    const r = request(rt.app).patch(p).set('Authorization', `Bearer ${token}`);
    return (version !== undefined ? r.set('If-Match', String(version)) : r).send(body as object);
  },
  del: (p: string) => request(rt.app).delete(p).set('Authorization', `Bearer ${token}`),
});

let seq = 0;
const billing = (stateCode = '27') => ({ kind: 'BILLING', line1: '12 MIDC Road', city: 'Pune', state: 'Maharashtra', stateCode, pincode: '411001', isDefault: true });
const supplier = (overrides: Record<string, unknown> = {}) => {
  seq += 1;
  return { legalName: `Acme Components ${seq} Pvt Ltd`, displayName: `Acme ${seq}`, gstTreatment: 'UNREGISTERED', addresses: [billing()], contacts: [{ name: 'Anita Desai', email: 'anita@acme.test', isPrimary: true }], ...overrides };
};

before(async () => {
  const env = loadEnv(partyEnvSchema, { dir: path.resolve(here, '..') });
  await truncateAll(env.MIGRATE_DATABASE_URL!);
  broker = new InMemoryBroker();
  rt = await createPartyRuntime(env, { broker, keys: new StaticKeyProvider(testKeys().publicKeyPem) });
  await rt.start();
});
after(async () => {
  await rt.stop();
});

describe('GST validation', () => {
  it('validates GSTIN format, checksum, state match and registration requirements', async () => {
    const ok = await api(ownerA).post('/api/v1/party/suppliers', supplier({ gstTreatment: 'REGISTERED', gstin: GSTIN_MH, pan: 'AAPFU0939F' }));
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.data.stateCode, '27');
    assert.equal(ok.body.data.status, 'ACTIVE');
    assert.match(ok.body.data.code, /^ACME/);
    const badFormat = await api(ownerA).post('/api/v1/party/suppliers', supplier({ gstTreatment: 'REGISTERED', gstin: 'NOTAGSTIN123456' }));
    assert.equal(badFormat.status, 422);
    const badChecksum = await api(ownerA).post('/api/v1/party/suppliers', supplier({ gstTreatment: 'REGISTERED', gstin: '27AAPFU0939F1ZX' }));
    assert.equal(badChecksum.status, 422);
    assert.ok(['PARTY_INVALID_GSTIN', 'VALIDATION_FAILED'].includes(badChecksum.body.error.code));
    const mismatch = await api(ownerA).post('/api/v1/party/suppliers', supplier({ gstTreatment: 'REGISTERED', gstin: GSTIN_KA, addresses: [billing('27')] }));
    assert.equal(mismatch.status, 422);
    assert.equal(mismatch.body.error.code, 'PARTY_GSTIN_STATE_MISMATCH');
    const registeredNoGstin = await api(ownerA).post('/api/v1/party/suppliers', supplier({ gstTreatment: 'REGISTERED', gstin: null }));
    assert.equal(registeredNoGstin.status, 422);
    assert.ok(registeredNoGstin.body.error.details.some((d: { path: string }) => d.path === 'gstin'));
    const panMismatch = await api(ownerA).post('/api/v1/party/suppliers', supplier({ gstTreatment: 'REGISTERED', gstin: GSTIN_MH, pan: 'ZZZZZ9999Z' }));
    assert.equal(panMismatch.status, 422);
    const dup = await api(ownerA).post('/api/v1/party/suppliers', supplier({ gstTreatment: 'REGISTERED', gstin: GSTIN_MH }));
    assert.equal(dup.status, 422);
    assert.equal(dup.body.error.code, 'PARTY_DUPLICATE_GSTIN');
    const asCustomer = await api(ownerA).post('/api/v1/party/customers', supplier({ gstTreatment: 'REGISTERED', gstin: GSTIN_MH }));
    assert.equal(asCustomer.status, 201, 'the same business can be a customer too');
    const codeDup = await api(ownerA).post('/api/v1/party/suppliers', supplier({ code: ok.body.data.code }));
    assert.equal(codeDup.status, 422);
    assert.equal(codeDup.body.error.code, 'MASTER_DUPLICATE_CODE');
  });
});

describe('lifecycle and edits', () => {
  it('patches with If-Match, blocks with a reason, unblocks, and guards deletes with references', async () => {
    const created = await api(ownerA).post('/api/v1/party/suppliers', supplier());
    const id = created.body.data.id as string;
    assert.equal((await api(ownerA).patch(`/api/v1/party/suppliers/${id}`, { displayName: 'Renamed' }, 3)).status, 409);
    const renamed = await api(ownerA).patch(`/api/v1/party/suppliers/${id}`, { displayName: 'Renamed', creditLimit: 50000 }, 0);
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
    assert.equal(renamed.body.data.version, 1);
    const blocked = await api(ownerA).post(`/api/v1/party/suppliers/${id}/block`, { reason: 'quality issues' });
    assert.equal(blocked.status, 200);
    assert.equal(blocked.body.data.status, 'BLOCKED');
    assert.equal(blocked.body.data.blockedReason, 'quality issues');
    assert.equal((await api(ownerA).post(`/api/v1/party/suppliers/${id}/status`, { status: 'INACTIVE' })).status, 409, 'unblock first');
    assert.equal((await api(ownerA).post(`/api/v1/party/suppliers/${id}/block`, { reason: 'again' })).status, 409);
    const lookups = await api(ownerA).get('/api/v1/party/lookups/suppliers?q=Renamed');
    assert.equal(lookups.body.data.length, 0, 'blocked suppliers are not offered on new documents');
    assert.equal((await api(ownerA).post(`/api/v1/party/suppliers/${id}/unblock`, { reason: 'resolved' })).body.data.status, 'ACTIVE');
    const events = await rt.prisma.outboxEvent.findMany({ where: { aggregateId: id, eventType: { startsWith: 'party.supplier.' } }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(events.map((e) => e.eventType), [EVENT_TYPES.PARTY_SUPPLIER_CREATED, EVENT_TYPES.PARTY_SUPPLIER_UPDATED, EVENT_TYPES.PARTY_SUPPLIER_BLOCKED, EVENT_TYPES.PARTY_SUPPLIER_UPDATED]);
    assert.deepEqual(events.map((e) => (e.envelope as unknown as EventEnvelope).aggregate.version), [0, 1, 2, 3]);

    await broker.publish(rk(EVENT_TYPES.PO_CREATED), { eventId: uuidv7(), eventType: EVENT_TYPES.PO_CREATED, eventVersion: 1, occurredAt: new Date().toISOString(), tenantId: tenantA, producer: 'svc-procurement', correlationId: 'c', causationId: null, actor: { type: 'user', id: null }, aggregate: { type: 'po', id: randomUUID(), version: 0 }, payload: { supplierId: id, lines: [] } });
    await broker.drain();
    const guarded = await api(ownerA).del(`/api/v1/party/suppliers/${id}`);
    assert.equal(guarded.status, 422);
    assert.equal(guarded.body.error.code, 'MASTER_IN_USE');
    assert.deepEqual((await api(ownerA).get(`/api/v1/party/suppliers/${id}`)).body.data.referencedBy, ['svc-procurement']);
    const fresh = await api(ownerA).post('/api/v1/party/suppliers', supplier());
    assert.equal((await api(ownerA).del(`/api/v1/party/suppliers/${fresh.body.data.id}`)).status, 200);
    assert.equal((await api(buyer).post('/api/v1/party/suppliers', supplier())).status, 403);
    assert.equal((await api(buyer).get(`/api/v1/party/suppliers/${id}`)).status, 200);
  });

  it('manages addresses, contacts and bank accounts; account numbers are masked and reveals are audited', async () => {
    const created = await api(ownerA).post('/api/v1/party/suppliers', supplier({ gstTreatment: 'REGISTERED', gstin: GSTIN_KA, addresses: [billing('29')], bankAccounts: [{ bankName: 'HDFC Bank', accountHolder: 'Acme', accountNumber: '50100123456789', ifsc: 'HDFC0001234', accountType: 'CURRENT' }] }));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.data.id as string;
    assert.equal(created.body.data.bankAccounts[0].accountNumber, '****6789');
    assert.equal(created.body.data.bankAccounts[0].isPrimary, true);
    const ship = await api(ownerA).post(`/api/v1/party/suppliers/${id}/addresses`, { kind: 'SHIPPING', line1: 'Plot 7', city: 'Bengaluru', stateCode: '29', pincode: '560001' });
    assert.equal(ship.status, 201);
    assert.equal(ship.body.data.isDefault, true, 'first shipping address becomes default');
    const badBilling = await api(ownerA).post(`/api/v1/party/suppliers/${id}/addresses`, { kind: 'BILLING', line1: 'Elsewhere', city: 'Pune', stateCode: '27', pincode: '411001', isDefault: true });
    assert.equal(badBilling.status, 422, 'a default billing address in another state contradicts the GSTIN');
    assert.equal(badBilling.body.error.code, 'PARTY_GSTIN_STATE_MISMATCH');
    const contact = await api(ownerA).post(`/api/v1/party/suppliers/${id}/contacts`, { name: 'Bharat Shah', phone: '9000000002', isPrimary: true });
    assert.equal(contact.status, 201);
    const detail = await api(ownerA).get(`/api/v1/party/suppliers/${id}`);
    assert.equal(detail.body.data.contacts.filter((c: { isPrimary: boolean }) => c.isPrimary).length, 1);
    const acctId = created.body.data.bankAccounts[0].id as string;
    const reveal = await api(ownerA).post(`/api/v1/party/suppliers/${id}/bank-accounts/${acctId}/reveal`);
    assert.equal(reveal.status, 200);
    assert.equal(reveal.body.data.accountNumber, '50100123456789');
    assert.equal((await api(buyer).post(`/api/v1/party/suppliers/${id}/bank-accounts/${acctId}/reveal`)).status, 403);
    const audits = (await rt.prisma.outboxEvent.findMany({ where: { tenantId: tenantA, eventType: EVENT_TYPES.AUDIT_RECORDED } })).map((e) => JSON.stringify(e.envelope));
    assert.ok(audits.some((a) => a.includes('BANK_ACCOUNT_REVEALED')));
    assert.ok(!audits.some((a) => a.includes('50100123456789')), 'full account numbers never reach the audit trail');
    const stored = await rt.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
      return tx.partyBankAccount.findUniqueOrThrow({ where: { id: acctId } });
    });
    assert.ok(stored.accountNumberEnc.startsWith('v1.'), 'encrypted at rest');
    assert.equal((await api(ownerA).del(`/api/v1/party/suppliers/${id}/addresses/${ship.body.data.id}`)).status, 200);
    assert.equal((await api(ownerA).del(`/api/v1/party/suppliers/${id}/bank-accounts/${acctId}`)).status, 200);
  });
});

describe('isolation and internal API', () => {
  it('hides tenant A parties from tenant B and serves snapshots to services on behalf of a tenant', async () => {
    const a = await api(ownerA).post('/api/v1/party/customers', supplier({ displayName: 'Isolated Customer' }));
    assert.equal((await api(ownerB).get(`/api/v1/party/customers/${a.body.data.id}`)).status, 404);
    assert.equal((await api(ownerB).post(`/api/v1/party/customers/${a.body.data.id}/block`, { reason: 'hijack' })).status, 404);
    assert.equal((await api(ownerB).get('/api/v1/party/customers?q=Isolated')).body.data.length, 0);
    const raw = await rt.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantB}, true), set_config('app.platform', 'false', true)`;
      return tx.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "parties"`;
    });
    assert.equal(Number(raw[0].n), 0);
    const svc = serviceToken('svc-sales', 'svc-party');
    const snap = await request(rt.app).get(`/internal/v1/parties/${a.body.data.id}/snapshot`).set('Authorization', `Bearer ${svc}`).set('x-on-behalf-of-tenant', tenantA);
    assert.equal(snap.status, 200, JSON.stringify(snap.body));
    assert.equal(snap.body.data.partyType, 'CUSTOMER');
    assert.equal(snap.body.data.billingAddress.city, 'Pune');
    assert.equal((await request(rt.app).get(`/internal/v1/parties/${a.body.data.id}/snapshot`).set('Authorization', `Bearer ${svc}`).set('x-on-behalf-of-tenant', tenantB)).status, 404);
    const list = await api(ownerA).get('/api/v1/party/customers?limit=1');
    assert.equal(list.body.data.length, 1);
  });
});
