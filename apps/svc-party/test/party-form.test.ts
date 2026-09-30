/**
 * The vendor-form endpoints (POST /suppliers/form, GET|PUT /suppliers/:id/form and the customer
 * equivalents): legacy vendor form fields end to end, blank addresses dropped, GST rules, child rows
 * updated by id / added / removed, bank numbers kept when not re-entered and never exposed,
 * vendor-only fields cleared for customers, If-Match, tenant isolation and permissions.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { EVENT_TYPES } from '@b2b/contracts';
import { StaticKeyProvider, loadEnv } from '@b2b/platform-kit';
import { InMemoryBroker, tenantToken, testKeys, truncateAll } from '@b2b/test-kit';
import { partyEnvSchema } from '../src/config.js';
import { createPartyRuntime, type PartyRuntime } from '../src/service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let rt: PartyRuntime;
const tenantA = randomUUID();
const tenantB = randomUUID();
const ownerA = tenantToken({ tenantId: tenantA, name: 'Owner A' });
const ownerB = tenantToken({ tenantId: tenantB, name: 'Owner B' });
const viewer = tenantToken({ tenantId: tenantA, perms: ['supplier.view'] });
const GSTIN_MH = '27AAPFU0939F1ZV';

const api = (token: string) => ({
  get: (p: string) => request(rt.app).get(p).set('Authorization', `Bearer ${token}`),
  post: (p: string, body: unknown = {}) => request(rt.app).post(p).set('Authorization', `Bearer ${token}`).send(body as object),
  put: (p: string, body: unknown, version?: number) => {
    const r = request(rt.app).put(p).set('Authorization', `Bearer ${token}`);
    return (version !== undefined ? r.set('If-Match', String(version)) : r).send(body as object);
  },
});

const blankAddress = (type: 'BILLING' | 'SHIPPING') => ({ type, attention: '', countryCode: 'IN', addressLine1: '', addressLine2: '', city: '', state: '', stateCode: '', postalCode: '', phone: '', fax: '', isPrimary: true });
const vendorForm = (overrides: Record<string, unknown> = {}) => ({
  salutation: 'Mr.',
  firstName: 'Ramesh',
  lastName: 'Kumar',
  companyName: 'ABC Computers Pvt Ltd',
  displayName: 'ABC Computers',
  email: 'accounts@abc.test',
  workPhoneCountryCode: '+91',
  workPhone: '02024567890',
  mobileCountryCode: '+91',
  mobile: '9876543210',
  language: 'en',
  website: 'https://abc.test',
  gstTreatment: 'REGISTERED',
  sourceOfSupply: '27',
  gstin: GSTIN_MH,
  pan: 'AAPFU0939F',
  currencyCode: 'INR',
  vendorType: 'SUPPLIER',
  msmeRegistered: true,
  msmeNumber: 'udyam-mh-26-0012345',
  tdsApplicable: true,
  tdsSectionCode: '194c',
  tcsApplicable: false,
  openingBalance: 12500.5,
  remarks: 'Preferred laptop vendor',
  addresses: [
    { type: 'BILLING', attention: 'Accounts', countryCode: 'IN', addressLine1: '12 MIDC Road', addressLine2: 'Bhosari', city: 'Pune', state: 'Maharashtra', stateCode: '27', postalCode: '411026', phone: '02024567890', fax: '', isPrimary: true },
    blankAddress('SHIPPING'),
  ],
  contacts: [{ salutation: 'Ms.', firstName: 'Anita', lastName: 'Desai', email: 'anita@abc.test', workPhone: '', mobile: '9811122233', designation: 'Sales', department: 'Sales', isPrimary: true }],
  bankAccounts: [{ bankName: 'HDFC Bank', accountHolderName: 'ABC Computers Pvt Ltd', accountNumber: '50100012345678', ifsc: 'HDFC0000123', branch: 'Pune Camp', accountType: 'CURRENT', isPrimary: true }],
  customFields: [],
  ...overrides,
});

before(async () => {
  const env = loadEnv(partyEnvSchema, { dir: path.resolve(here, '..') });
  await truncateAll(env.MIGRATE_DATABASE_URL!);
  rt = await createPartyRuntime(env, { broker: new InMemoryBroker(), keys: new StaticKeyProvider(testKeys().publicKeyPem) });
  await rt.start();
});
after(async () => {
  await rt.stop();
});

describe('vendor form', () => {
  let id: string;
  let version: number;

  it('creates a vendor with every legacy vendor-form field and drops blank addresses', async () => {
    const r = await api(ownerA).post('/api/v1/party/suppliers/form', vendorForm());
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const v = r.body.data;
    id = v.id;
    version = v.version;
    assert.equal(v.partyType, 'SUPPLIER');
    assert.equal(v.companyName, 'ABC Computers Pvt Ltd');
    assert.equal(v.displayName, 'ABC Computers');
    assert.deepEqual([v.salutation, v.firstName, v.lastName], ['Mr.', 'Ramesh', 'Kumar']);
    assert.deepEqual([v.workPhoneCountryCode, v.workPhone, v.mobileCountryCode, v.mobile], ['+91', '02024567890', '+91', '9876543210']);
    assert.deepEqual([v.gstTreatment, v.sourceOfSupply, v.gstin, v.pan, v.currencyCode], ['REGISTERED', '27', GSTIN_MH, 'AAPFU0939F', 'INR']);
    assert.deepEqual([v.vendorType, v.msmeRegistered, v.msmeNumber, v.tdsApplicable, v.tdsSectionCode], ['SUPPLIER', true, 'UDYAM-MH-26-0012345', true, '194C']);
    assert.equal(v.openingBalance, 12500.5);
    assert.equal(v.addresses.length, 1, 'the blank shipping address is not saved');
    assert.equal(v.addresses[0].addressLine2, 'Bhosari');
    assert.equal(v.contacts[0].department, 'Sales');
    assert.equal(v.bankAccounts[0].accountNumberMasked, 'XXXX5678');
    assert.equal(JSON.stringify(v).includes('50100012345678'), false, 'the full account number is never returned');

    const list = await api(ownerA).get('/api/v1/party/suppliers?q=ABC');
    assert.equal(list.body.data[0].legalName, 'ABC Computers Pvt Ltd', 'the vendor is a normal supplier for POs');
    const lookup = await api(ownerA).get('/api/v1/party/lookups/suppliers?q=ABC');
    assert.equal(lookup.body.data[0].stateCode, '27');

    const outbox = await rt.prisma.outboxEvent.findMany({ where: { tenantId: tenantA } });
    assert.ok(outbox.some((e) => e.eventType === EVENT_TYPES.PARTY_SUPPLIER_CREATED));
    assert.equal(outbox.some((e) => JSON.stringify(e.envelope).includes('50100012345678')), false, 'no bank number in events or audit');
  });

  it('applies the vendor form rules (shared schema + GST rules)', async () => {
    const noGstin = await api(ownerA).post('/api/v1/party/suppliers/form', vendorForm({ gstin: '', pan: '' }));
    assert.equal(noGstin.status, 422);
    assert.ok(noGstin.body.error.details.some((d: { path: string }) => d.path === 'gstin'));
    const wrongSource = await api(ownerA).post('/api/v1/party/suppliers/form', vendorForm({ displayName: 'Other', sourceOfSupply: '29' }));
    assert.equal(wrongSource.status, 422);
    assert.equal(wrongSource.body.error.details[0].path, 'sourceOfSupply');
    const msme = await api(ownerA).post('/api/v1/party/suppliers/form', vendorForm({ displayName: 'Other', gstTreatment: 'UNREGISTERED', gstin: '', pan: '', msmeNumber: '' }));
    assert.equal(msme.status, 422);
    assert.ok(msme.body.error.details.some((d: { path: string }) => d.path === 'msmeNumber'));
    const dupGstin = await api(ownerA).post('/api/v1/party/suppliers/form', vendorForm({ displayName: 'ABC Again' }));
    assert.equal(dupGstin.status, 422);
    assert.equal(dupGstin.body.error.code, 'PARTY_DUPLICATE_GSTIN');
    const stateMismatch = await api(ownerA).post('/api/v1/party/suppliers/form', vendorForm({ displayName: 'Other', gstin: '29ABCDE1234F1ZW', pan: 'ABCDE1234F', sourceOfSupply: '29' }));
    assert.equal(stateMismatch.status, 422, 'GSTIN state must match the billing address state');
    const newBankNoNumber = await api(ownerA).post('/api/v1/party/suppliers/form', vendorForm({ displayName: 'Other', gstTreatment: 'UNREGISTERED', gstin: '', pan: '', bankAccounts: [{ bankName: 'SBI', accountHolderName: 'X', ifsc: 'SBIN0001234', accountType: 'SAVINGS', isPrimary: true }] }));
    assert.equal(newBankNoNumber.status, 422);
    assert.ok(newBankNoNumber.body.error.details.some((d: { path: string }) => d.path === 'bankAccounts.0.accountNumber'));
  });

  it('updates everything in one save: rows by id, new rows, removed rows, bank number kept', async () => {
    const current = (await api(ownerA).get(`/api/v1/party/suppliers/${id}/form`)).body.data;
    const body = vendorForm({
      displayName: 'ABC Computers (Pune)',
      addresses: [
        { ...current.addresses[0], city: 'Pimpri', postalCode: '411018' },
        { type: 'SHIPPING', attention: 'Warehouse', countryCode: 'IN', addressLine1: 'Plot 7', addressLine2: '', city: 'Chakan', state: 'Maharashtra', stateCode: '27', postalCode: '410501', phone: '', fax: '', isPrimary: true },
      ],
      contacts: [{ salutation: 'Mr.', firstName: 'Vikram', lastName: 'Rao', email: 'vikram@abc.test', workPhone: '', mobile: '', designation: 'Owner', department: '', isPrimary: true }],
      bankAccounts: [{ ...current.bankAccounts[0], accountNumber: '', branch: 'Pune Main' }],
    });
    const stale = await api(ownerA).put(`/api/v1/party/suppliers/${id}/form`, body, version + 7);
    assert.equal(stale.status, 409);
    const r = await api(ownerA).put(`/api/v1/party/suppliers/${id}/form`, body, version);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const v = r.body.data;
    assert.equal(v.displayName, 'ABC Computers (Pune)');
    assert.equal(v.version, version + 1);
    assert.equal(v.addresses.length, 2);
    assert.equal(v.addresses.find((a: { type: string }) => a.type === 'BILLING').id, current.addresses[0].id, 'existing row updated in place');
    assert.equal(v.addresses.find((a: { type: string }) => a.type === 'BILLING').city, 'Pimpri');
    assert.equal(v.contacts.length, 1);
    assert.equal(v.contacts[0].firstName, 'Vikram', 'the old contact was removed and the new one added');
    assert.equal(v.bankAccounts[0].accountNumberMasked, 'XXXX5678', 'the stored number is kept when not re-entered');
    assert.equal(v.bankAccounts[0].branch, 'Pune Main');
    const revealed = await api(ownerA).post(`/api/v1/party/suppliers/${id}/bank-accounts/${v.bankAccounts[0].id}/reveal`);
    assert.equal(revealed.body.data.accountNumber, '50100012345678');
  });

  it('clears vendor-only fields for customers, isolates tenants and enforces permissions', async () => {
    const customer = await api(ownerA).post('/api/v1/party/customers/form', vendorForm({ displayName: 'Laptop Buyer', gstTreatment: 'CONSUMER', gstin: '', pan: '', bankAccounts: [] }));
    assert.equal(customer.status, 201, JSON.stringify(customer.body));
    assert.equal(customer.body.data.partyType, 'CUSTOMER');
    assert.deepEqual([customer.body.data.vendorType, customer.body.data.msmeRegistered, customer.body.data.tdsApplicable], [null, false, false]);

    assert.equal((await api(ownerB).get(`/api/v1/party/suppliers/${id}/form`)).status, 404);
    assert.equal((await api(ownerA).get(`/api/v1/party/customers/${id}/form`)).status, 404, 'a vendor is not a customer');
    assert.equal((await api(viewer).get(`/api/v1/party/suppliers/${id}/form`)).status, 200);
    assert.equal((await api(viewer).post('/api/v1/party/suppliers/form', vendorForm({ displayName: 'Nope' }))).status, 403);
  });
});
