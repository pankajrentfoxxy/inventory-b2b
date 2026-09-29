import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import {
  VALID_GSTIN,
  VALID_GSTIN_2,
  addMemberWithRole,
  api,
  byCode,
  formOptions,
  registerOrg,
  resetDatabase,
  vendorPayload,
  type Session,
} from './helpers.js';

const app = createApp();

let owner: Session; // org A owner (all permissions)
let viewer: Session; // org A, vendor.view only
let executive: Session; // org A, create/edit but no status/bank
let otherOwner: Session; // org B owner
let opts: Awaited<ReturnType<typeof formOptions>>;

before(async () => {
  await resetDatabase();
  owner = await registerOrg(app, 'Alpha Traders', 'owner@alpha.test');
  otherOwner = await registerOrg(app, 'Beta Supplies', 'owner@beta.test');
  viewer = await addMemberWithRole(app, owner, 'VIEWER', 'viewer@alpha.test');
  executive = await addMemberWithRole(app, owner, 'PURCHASE_EXECUTIVE', 'exec@alpha.test');
  opts = await formOptions(app, owner);
});

after(async () => {
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------------- */
describe('authentication & tenant scoping', () => {
  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/vendors');
    assert.equal(res.status, 401);
  });

  it('rejects requests without an organization header', async () => {
    const res = await api(app, owner, '').get('/api/vendors');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'ORGANIZATION_REQUIRED');
  });

  it('rejects a user who is not a member of the organization', async () => {
    const res = await api(app, otherOwner, owner.orgId).get('/api/vendors');
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'ORGANIZATION_ACCESS_DENIED');
  });

  it('returns the caller context with resolved permissions', async () => {
    const res = await api(app, viewer).get('/api/organizations/current');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.permissions, ['item.view', 'purchase_order.view', 'purchase_receive.view', 'settings.view', 'vendor.view']);
  });
});

/* ------------------------------------------------------------------------- */
describe('create vendor', () => {
  let vendorId: string;

  it('creates a vendor with contacts, addresses and a masked bank account', async () => {
    const res = await api(app, owner).post('/api/vendors').send(vendorPayload(opts));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const v = res.body.data;
    vendorId = v.id;
    assert.equal(v.displayName, 'Acme Components');
    assert.equal(v.email, 'accounts@acme.example', 'email is lower-cased');
    assert.equal(v.workPhone, '02240001234', 'phones are stored as digits');
    assert.equal(v.mobile, '9876543210');
    assert.equal(v.status, 'ACTIVE');
    assert.equal(v.gstin, VALID_GSTIN);
    assert.equal(v.gstTreatment.code, 'REGISTERED_BUSINESS_REGULAR');
    assert.equal(v.sourceOfSupply.code, '27');
    assert.equal(v.addresses.length, 2);
    assert.equal(v.contacts.length, 2);
    assert.equal(v.contacts.filter((c: { isPrimary: boolean }) => c.isPrimary).length, 1);
    assert.equal(v.bankAccounts.length, 1);
    assert.equal(v.bankAccounts[0].accountNumberMasked, 'XXXXXX6789');
    assert.equal(v.bankAccounts[0].accountNumber, undefined, 'full number never in detail payload');
  });

  it('writes a VENDOR_CREATED audit entry without the bank account number', async () => {
    const res = await api(app, owner).get(`/api/vendors/${vendorId}/activity`);
    assert.equal(res.status, 200);
    const created = res.body.data.find((a: { action: string }) => a.action === 'VENDOR_CREATED');
    assert.ok(created);
    assert.equal(created.userName, 'Owner Alpha Traders');
    assert.equal(created.newValue.bankAccounts[0].accountNumber, 'XXXXXX6789');
    assert.ok(!JSON.stringify(created).includes('50100123456789'));
  });

  it('rejects a duplicate display name in the same organization (case-insensitive)', async () => {
    const res = await api(app, owner).post('/api/vendors').send(vendorPayload(opts, { displayName: '  acme components ' }));
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'DUPLICATE_DISPLAY_NAME');
    assert.equal(res.body.error.details[0].path, 'displayName');
  });

  it('allows the same display name in a different organization', async () => {
    const optsB = await formOptions(app, otherOwner);
    const res = await api(app, otherOwner).post('/api/vendors').send(vendorPayload(optsB));
    assert.equal(res.status, 201);
  });

  it('rejects missing required fields', async () => {
    const res = await api(app, owner).post('/api/vendors').send({ displayName: '' });
    assert.equal(res.status, 422);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    assert.ok(paths.includes('displayName'));
    assert.ok(paths.includes('gstTreatmentId'));
    assert.ok(paths.includes('sourceOfSupplyId'));
  });

  it('rejects an invalid GSTIN (bad check digit) and an invalid email', async () => {
    const res = await api(app, owner)
      .post('/api/vendors')
      .send(vendorPayload(opts, { displayName: 'Bad GSTIN Co', gstin: '27AAPFU0939F1ZX', email: 'not-an-email' }));
    assert.equal(res.status, 422);
    const byPath = Object.fromEntries(res.body.error.details.map((d: { path: string; message: string }) => [d.path, d.message]));
    assert.match(byPath.gstin, /GSTIN/);
    assert.match(byPath.email, /email/i);
  });

  it('rejects an invalid PAN and a PAN that does not match the GSTIN', async () => {
    const bad = await api(app, owner).post('/api/vendors').send(vendorPayload(opts, { displayName: 'Bad PAN', pan: '123' }));
    assert.equal(bad.status, 422);
    const mismatch = await api(app, owner).post('/api/vendors').send(vendorPayload(opts, { displayName: 'PAN Mismatch', pan: 'ABCDE1234F' }));
    assert.equal(mismatch.status, 422);
    assert.equal(mismatch.body.error.details[0].path, 'pan');
  });

  it('requires a GSTIN when the GST treatment demands one (master-driven rule)', async () => {
    const res = await api(app, owner).post('/api/vendors').send(vendorPayload(opts, { displayName: 'No GSTIN', gstin: '', pan: '' }));
    assert.equal(res.status, 422);
    assert.equal(res.body.error.details[0].path, 'gstin');

    const unregistered = byCode(opts.gstTreatments, 'UNREGISTERED_BUSINESS').id;
    const ok = await api(app, owner)
      .post('/api/vendors')
      .send(vendorPayload(opts, { displayName: 'Local Unregistered', gstin: '', pan: '', gstTreatmentId: unregistered, bankAccounts: [] }));
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
  });

  it('rejects invalid bank details and more than one primary contact', async () => {
    const res = await api(app, owner).post('/api/vendors').send(
      vendorPayload(opts, {
        displayName: 'Bad Bank',
        bankAccounts: [{ bankName: 'X', accountHolderName: 'Y', accountNumber: '12', ifsc: 'BAD', accountType: 'CURRENT' }],
        contacts: [
          { firstName: 'A', isPrimary: true },
          { firstName: 'B', isPrimary: true },
        ],
      }),
    );
    assert.equal(res.status, 422);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    assert.ok(paths.includes('bankAccounts.0.ifsc'));
    assert.ok(paths.includes('bankAccounts.0.accountNumber'));
    assert.ok(paths.includes('contacts'));
  });

  it('rejects masters that belong to another organization', async () => {
    const optsB = await formOptions(app, otherOwner);
    const res = await api(app, owner).post('/api/vendors').send(vendorPayload(opts, { displayName: 'Foreign Master', gstTreatmentId: optsB.gstTreatments[0].id }));
    assert.equal(res.status, 422);
    assert.equal(res.body.error.details[0].path, 'gstTreatmentId');
  });

  it('rejects an invalid Indian PIN code', async () => {
    const payload = vendorPayload(opts, { displayName: 'Bad Pin' }) as { addresses: { postalCode?: string }[] };
    payload.addresses[0].postalCode = '01234';
    const res = await api(app, owner).post('/api/vendors').send(payload);
    assert.equal(res.status, 422);
    assert.equal(res.body.error.details[0].path, 'addresses.0.postalCode');
  });
});

/* ------------------------------------------------------------------------- */
describe('list, search, filter, sort, paginate', () => {
  before(async () => {
    // A few more vendors with distinct attributes for search/sort assertions.
    const unregistered = byCode(opts.gstTreatments, 'UNREGISTERED_BUSINESS').id;
    const extra = [
      { displayName: 'Zenith Electronics', companyName: 'Zenith Electronics LLP', email: 'sales@zenith.example', mobile: '9111122222', gstin: VALID_GSTIN_2, pan: 'ABCDE1234F', sourceOfSupplyId: byCode(opts.sourcesOfSupply, '29').id },
      { displayName: 'Mango Logistics', companyName: 'Mango Logistics', email: 'ops@mango.example', mobile: '9333344444', gstin: '', pan: '', gstTreatmentId: unregistered },
      { displayName: 'Bravo Metals', companyName: 'Bravo Metals Pvt Ltd', email: 'bravo@metals.example', workPhone: '01140005000', gstin: '', pan: '', gstTreatmentId: unregistered },
    ];
    for (const o of extra) {
      const res = await api(app, owner).post('/api/vendors').send(vendorPayload(opts, { ...o, bankAccounts: [], contacts: [], addresses: [] }));
      assert.equal(res.status, 201, JSON.stringify(res.body));
    }
    const list = await api(app, owner).get('/api/vendors?search=Mango');
    await api(app, owner).patch(`/api/vendors/${list.body.data[0].id}/status`).send({ status: 'INACTIVE' });
  });

  it('lists only the caller organization vendors with pagination metadata and status counts', async () => {
    const res = await api(app, owner).get('/api/vendors?limit=2&page=1');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 2);
    assert.equal(res.body.pagination.limit, 2);
    assert.ok(res.body.pagination.total >= 5);
    assert.equal(res.body.pagination.totalPages, Math.ceil(res.body.pagination.total / 2));
    assert.equal(res.body.counts.ALL, res.body.counts.ACTIVE + res.body.counts.INACTIVE);
    assert.ok(res.body.counts.INACTIVE >= 1);

    const other = await api(app, otherOwner).get('/api/vendors');
    assert.equal(other.body.pagination.total, 1, 'org B sees only its own vendor');
  });

  it('sorts by display name ascending by default and supports other columns', async () => {
    const asc = await api(app, owner).get('/api/vendors?limit=50');
    const names = asc.body.data.map((v: { displayName: string }) => v.displayName);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));

    const desc = await api(app, owner).get('/api/vendors?sortBy=createdAt&sortOrder=desc&limit=1');
    assert.equal(desc.body.data[0].displayName, 'Bravo Metals');

    const invalid = await api(app, owner).get('/api/vendors?sortBy=passwordHash');
    assert.equal(invalid.status, 422);
  });

  it('searches by vendor name, company name, email, phone and GSTIN', async () => {
    const byName = await api(app, owner).get('/api/vendors?search=zenith');
    assert.equal(byName.body.data.length, 1);
    const byCompany = await api(app, owner).get('/api/vendors?search=Metals Pvt');
    assert.equal(byCompany.body.data[0].displayName, 'Bravo Metals');
    const byEmail = await api(app, owner).get('/api/vendors?search=sales@zenith');
    assert.equal(byEmail.body.data[0].displayName, 'Zenith Electronics');
    const byPhone = await api(app, owner).get('/api/vendors?search=91111 22222');
    assert.equal(byPhone.body.data[0].displayName, 'Zenith Electronics');
    const byGstin = await api(app, owner).get(`/api/vendors?search=${VALID_GSTIN_2.slice(0, 10).toLowerCase()}`);
    assert.equal(byGstin.body.data[0].displayName, 'Zenith Electronics');
    const none = await api(app, owner).get('/api/vendors?search=doesnotexist');
    assert.equal(none.body.data.length, 0);
  });

  it('filters by status and by source of supply', async () => {
    const inactive = await api(app, owner).get('/api/vendors?status=INACTIVE');
    assert.ok(inactive.body.data.every((v: { status: string }) => v.status === 'INACTIVE'));
    assert.equal(inactive.body.data[0].displayName, 'Mango Logistics');

    const active = await api(app, owner).get('/api/vendors?status=ACTIVE');
    assert.ok(active.body.data.every((v: { status: string }) => v.status === 'ACTIVE'));

    const ka = await api(app, owner).get(`/api/vendors?sourceOfSupplyId=${byCode(opts.sourcesOfSupply, '29').id}`);
    assert.equal(ka.body.data.length, 1);
    assert.equal(ka.body.data[0].displayName, 'Zenith Electronics');
  });

  it('list rows expose a primary contact and never bank details', async () => {
    const res = await api(app, owner).get('/api/vendors?search=Acme');
    const row = res.body.data[0];
    assert.equal(row.primaryContact, 'Mr. Ravi Kumar');
    assert.equal(row.bankAccounts, undefined);
    assert.equal(row.workPhone, '+91 02240001234');
  });
});

/* ------------------------------------------------------------------------- */
describe('read, update, status, delete', () => {
  let vendorId: string;

  before(async () => {
    const list = await api(app, owner).get('/api/vendors?search=Acme Components');
    vendorId = list.body.data[0].id;
  });

  it('returns the full vendor profile', async () => {
    const res = await api(app, owner).get(`/api/vendors/${vendorId}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.primaryContact, 'Mr. Ravi Kumar');
    assert.equal(res.body.data.paymentTerm.name, 'Due on Receipt');
    assert.equal(res.body.data.counts.notes, 0);
  });

  it('hides vendors of other organizations (404, not 403)', async () => {
    const res = await api(app, otherOwner).get(`/api/vendors/${vendorId}`);
    assert.equal(res.status, 404);
    const put = await api(app, otherOwner).put(`/api/vendors/${vendorId}`).send(vendorPayload(await formOptions(app, otherOwner)));
    assert.equal(put.status, 404);
    const del = await api(app, otherOwner).delete(`/api/vendors/${vendorId}`);
    assert.equal(del.status, 404);
    const status = await api(app, otherOwner).patch(`/api/vendors/${vendorId}/status`).send({ status: 'INACTIVE' });
    assert.equal(status.status, 404);
  });

  it('updates scalars and reconciles contacts, addresses and bank accounts with granular audit entries', async () => {
    const current = (await api(app, owner).get(`/api/vendors/${vendorId}`)).body.data;
    const [primary, secondary] = current.contacts;
    const payload = vendorPayload(opts, {
      displayName: 'Acme Components India',
      companyName: current.companyName,
      contacts: [
        { id: primary.id, salutation: primary.salutation, firstName: primary.firstName, lastName: primary.lastName, email: primary.email, mobile: primary.mobile, designation: primary.designation, isPrimary: false },
        { id: secondary.id, firstName: secondary.firstName, lastName: secondary.lastName, email: secondary.email, workPhone: secondary.workPhone, department: secondary.department, isPrimary: true },
        { firstName: 'Chitra', lastName: 'Rao', email: 'chitra@acme.example', isPrimary: false },
      ],
      addresses: [
        { ...current.addresses.find((a: { type: string }) => a.type === 'BILLING'), city: 'Mumbai', postalCode: '400001' },
      ],
      bankAccounts: [
        { id: current.bankAccounts[0].id, bankName: 'HDFC Bank', accountHolderName: 'Acme Components India Pvt Ltd', ifsc: 'HDFC0001234', branch: 'Pune MIDC', accountType: 'CURRENT', isPrimary: true },
        { bankName: 'ICICI Bank', accountHolderName: 'Acme Components India Pvt Ltd', accountNumber: '000405001234', ifsc: 'ICIC0000004', accountType: 'CURRENT', isPrimary: false },
      ],
    });
    const res = await api(app, owner).put(`/api/vendors/${vendorId}`).send(payload);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const v = res.body.data;
    assert.equal(v.displayName, 'Acme Components India');
    assert.equal(v.contacts.length, 3);
    assert.equal(v.contacts.find((c: { isPrimary: boolean }) => c.isPrimary).firstName, 'Bharat', 'primary switched');
    assert.equal(v.addresses.length, 1, 'shipping address removed');
    assert.equal(v.addresses[0].city, 'Mumbai');
    assert.equal(v.bankAccounts.length, 2);
    assert.equal(v.bankAccounts[0].accountNumberMasked, 'XXXXXX6789', 'existing number kept when omitted');
    assert.equal(v.bankAccounts[0].accountHolderName, 'Acme Components India Pvt Ltd');

    const activity = await api(app, owner).get(`/api/vendors/${vendorId}/activity?limit=50`);
    const actions = activity.body.data.map((a: { action: string }) => a.action);
    for (const expected of ['VENDOR_UPDATED', 'CONTACT_UPDATED', 'CONTACT_ADDED', 'ADDRESS_UPDATED', 'ADDRESS_REMOVED', 'BANK_ACCOUNT_UPDATED', 'BANK_ACCOUNT_ADDED']) {
      assert.ok(actions.includes(expected), `expected ${expected} in ${actions.join(',')}`);
    }
    const updated = activity.body.data.find((a: { action: string }) => a.action === 'VENDOR_UPDATED');
    assert.equal(updated.oldValue.displayName, 'Acme Components');
    assert.equal(updated.newValue.displayName, 'Acme Components India');
    assert.ok(!JSON.stringify(activity.body).includes('000405001234'), 'new bank number never logged');
  });

  it('rejects an update that would collide with another vendor display name', async () => {
    const res = await api(app, owner).put(`/api/vendors/${vendorId}`).send(vendorPayload(opts, { displayName: 'ZENITH electronics' }));
    assert.equal(res.status, 409);
  });

  it('rejects child ids that belong to another vendor', async () => {
    const zenith = (await api(app, owner).get('/api/vendors?search=Zenith')).body.data[0];
    const contact = await api(app, owner).post(`/api/vendors/${zenith.id}/contacts`).send({ firstName: 'Z', isPrimary: true });
    const res = await api(app, owner).put(`/api/vendors/${vendorId}`).send(
      vendorPayload(opts, { displayName: 'Acme Components India', contacts: [{ id: contact.body.data.id, firstName: 'Hijack' }] }),
    );
    assert.equal(res.status, 422);
  });

  it('deactivates and reactivates a vendor with audit entries', async () => {
    const off = await api(app, owner).patch(`/api/vendors/${vendorId}/status`).send({ status: 'INACTIVE', reason: 'Quality issues' });
    assert.equal(off.status, 200);
    assert.equal(off.body.data.status, 'INACTIVE');
    const on = await api(app, owner).patch(`/api/vendors/${vendorId}/status`).send({ status: 'ACTIVE' });
    assert.equal(on.body.data.status, 'ACTIVE');
    const bad = await api(app, owner).patch(`/api/vendors/${vendorId}/status`).send({ status: 'DELETED' });
    assert.equal(bad.status, 422);

    const activity = await api(app, owner).get(`/api/vendors/${vendorId}/activity?limit=5`);
    const changes = activity.body.data.filter((a: { action: string }) => a.action === 'VENDOR_STATUS_CHANGED');
    assert.equal(changes.length, 2);
    assert.equal(changes[1].newValue.reason, 'Quality issues');
  });

  it('soft-deletes a vendor and frees its display name', async () => {
    const created = await api(app, owner).post('/api/vendors').send(vendorPayload(opts, { displayName: 'Temp Vendor', bankAccounts: [] }));
    const id = created.body.data.id;
    const del = await api(app, owner).delete(`/api/vendors/${id}`);
    assert.equal(del.status, 200);
    const get = await api(app, owner).get(`/api/vendors/${id}`);
    assert.equal(get.status, 404);
    const list = await api(app, owner).get('/api/vendors?search=Temp Vendor');
    assert.equal(list.body.data.length, 0);
    const row = await prisma.vendor.findUnique({ where: { id } });
    assert.ok(row?.deletedAt, 'row kept with deleted_at set');
    const again = await api(app, owner).post('/api/vendors').send(vendorPayload(opts, { displayName: 'Temp Vendor', bankAccounts: [] }));
    assert.equal(again.status, 201);
  });
});

/* ------------------------------------------------------------------------- */
describe('contacts, addresses, bank accounts, notes sub-resources', () => {
  let vendorId: string;

  before(async () => {
    const res = await api(app, owner).post('/api/vendors').send(vendorPayload(opts, { displayName: 'Subresource Co', contacts: [], addresses: [], bankAccounts: [] }));
    vendorId = res.body.data.id;
  });

  it('first contact becomes primary; marking another primary demotes the previous one', async () => {
    const a = await api(app, owner).post(`/api/vendors/${vendorId}/contacts`).send({ firstName: 'First' });
    assert.equal(a.status, 201);
    assert.equal(a.body.data.isPrimary, true);
    const b = await api(app, owner).post(`/api/vendors/${vendorId}/contacts`).send({ firstName: 'Second', isPrimary: true });
    assert.equal(b.body.data.isPrimary, true);
    const v = (await api(app, owner).get(`/api/vendors/${vendorId}`)).body.data;
    assert.equal(v.contacts.filter((c: { isPrimary: boolean }) => c.isPrimary).length, 1);
    assert.equal(v.contacts.find((c: { isPrimary: boolean }) => c.isPrimary).firstName, 'Second');

    const removed = await api(app, owner).delete(`/api/vendors/${vendorId}/contacts/${b.body.data.id}`);
    assert.equal(removed.status, 200);
    const after = (await api(app, owner).get(`/api/vendors/${vendorId}`)).body.data;
    assert.equal(after.contacts[0].isPrimary, true, 'remaining contact promoted');
  });

  it('supports multiple addresses with one primary per type', async () => {
    const b1 = await api(app, owner).post(`/api/vendors/${vendorId}/addresses`).send({ type: 'BILLING', addressLine1: 'HQ', city: 'Delhi', countryCode: 'IN', postalCode: '110001' });
    const b2 = await api(app, owner).post(`/api/vendors/${vendorId}/addresses`).send({ type: 'BILLING', addressLine1: 'Branch', city: 'Noida', countryCode: 'IN', postalCode: '201301', isPrimary: true });
    const s1 = await api(app, owner).post(`/api/vendors/${vendorId}/addresses`).send({ type: 'SHIPPING', addressLine1: 'Dock 1', countryCode: 'IN' });
    assert.equal(b1.status, 201);
    assert.equal(b2.status, 201);
    assert.equal(s1.status, 201);
    const v = (await api(app, owner).get(`/api/vendors/${vendorId}`)).body.data;
    const billing = v.addresses.filter((a: { type: string }) => a.type === 'BILLING');
    assert.equal(billing.length, 2);
    assert.equal(billing.filter((a: { isPrimary: boolean }) => a.isPrimary).length, 1);
    assert.equal(billing.find((a: { isPrimary: boolean }) => a.isPrimary).city, 'Noida');
    assert.equal(v.addresses.find((a: { type: string }) => a.type === 'SHIPPING').isPrimary, true);

    const blank = await api(app, owner).post(`/api/vendors/${vendorId}/addresses`).send({ type: 'SHIPPING', countryCode: 'IN' });
    assert.equal(blank.status, 422);
  });

  it('adds, masks and reveals bank accounts according to permissions', async () => {
    const added = await api(app, owner).post(`/api/vendors/${vendorId}/bank-accounts`).send({
      bankName: 'SBI', accountHolderName: 'Subresource Co', accountNumber: '3123456789012', ifsc: 'SBIN0001234', accountType: 'CURRENT',
    });
    assert.equal(added.status, 201);
    assert.equal(added.body.data.accountNumberMasked, 'XXXXXX9012');
    assert.equal(added.body.data.accountNumber, undefined);

    const reveal = await api(app, owner).get(`/api/vendors/${vendorId}/bank-accounts/${added.body.data.id}/reveal`);
    assert.equal(reveal.status, 200);
    assert.equal(reveal.body.data.accountNumber, '3123456789012');

    const denied = await api(app, executive).get(`/api/vendors/${vendorId}/bank-accounts/${added.body.data.id}/reveal`);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error.code, 'PERMISSION_DENIED');

    const activity = await api(app, owner).get(`/api/vendors/${vendorId}/activity?limit=5`);
    assert.equal(activity.body.data[0].action, 'BANK_ACCOUNT_REVEALED');

    const bad = await api(app, owner).post(`/api/vendors/${vendorId}/bank-accounts`).send({ bankName: 'SBI', accountHolderName: 'X', accountNumber: 'abc', ifsc: 'SBIN1234' });
    assert.equal(bad.status, 422);
  });

  it('adds and lists notes', async () => {
    const note = await api(app, owner).post(`/api/vendors/${vendorId}/notes`).send({ body: 'Negotiated 2% early payment discount' });
    assert.equal(note.status, 201);
    const list = await api(app, owner).get(`/api/vendors/${vendorId}/notes`);
    assert.equal(list.body.data.length, 1);
    assert.equal(list.body.data[0].createdByName, 'Owner Alpha Traders');
    const empty = await api(app, owner).post(`/api/vendors/${vendorId}/notes`).send({ body: '   ' });
    assert.equal(empty.status, 422);
  });

  it('exposes a transactions summary: purchasing connected, billing modules marked unavailable', async () => {
    const res = await api(app, owner).get(`/api/vendors/${vendorId}/transactions`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.modules.purchaseOrders.available, true);
    assert.equal(res.body.data.modules.purchaseOrders.total, 0);
    assert.equal(res.body.data.modules.bills.available, false);
    assert.equal(res.body.data.summary.outstandingPayables, null);
  });
});

/* ------------------------------------------------------------------------- */
describe('custom fields & reporting tags', () => {
  let fieldId: string;
  let dropdownId: string;

  it('lets an admin define custom fields; viewers cannot', async () => {
    const denied = await api(app, viewer).post('/api/settings/custom-fields').send({ label: 'Nope', fieldType: 'TEXT' });
    assert.equal(denied.status, 403);
    const req = await api(app, owner).post('/api/settings/custom-fields').send({ label: 'Vendor Code', fieldType: 'TEXT', isRequired: true });
    assert.equal(req.status, 201);
    fieldId = req.body.data.id;
    assert.equal(req.body.data.key, 'vendor_code');
    const dd = await api(app, owner).post('/api/settings/custom-fields').send({ label: 'Tier', fieldType: 'DROPDOWN', options: ['Gold', 'Silver'] });
    dropdownId = dd.body.data.id;
    const badDd = await api(app, owner).post('/api/settings/custom-fields').send({ label: 'Empty', fieldType: 'DROPDOWN', options: [] });
    assert.equal(badDd.status, 422);
  });

  it('enforces required custom fields and dropdown options on vendor create', async () => {
    const missing = await api(app, owner).post('/api/vendors').send(vendorPayload(opts, { displayName: 'CF Missing', bankAccounts: [] }));
    assert.equal(missing.status, 422);
    assert.match(missing.body.error.details[0].message, /Vendor Code is required/);

    const badOption = await api(app, owner).post('/api/vendors').send(
      vendorPayload(opts, { displayName: 'CF Bad', bankAccounts: [], customFields: [{ fieldId, value: 'V-1' }, { fieldId: dropdownId, value: 'Bronze' }] }),
    );
    assert.equal(badOption.status, 422);
    assert.equal(badOption.body.error.details[0].path, 'customFields.1.value');

    const tag = opts.reportingTags.find((t) => t.name === 'Region')!;
    const ok = await api(app, owner).post('/api/vendors').send(
      vendorPayload(opts, {
        displayName: 'CF Good',
        bankAccounts: [],
        customFields: [{ fieldId, value: 'V-1' }, { fieldId: dropdownId, value: 'Gold' }],
        reportingTags: [{ tagId: tag.id, optionId: tag.options[0].id }],
      }),
    );
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const cf = Object.fromEntries(ok.body.data.customFields.map((c: { label: string; value: unknown }) => [c.label, c.value]));
    assert.equal(cf['Vendor Code'], 'V-1');
    assert.equal(cf.Tier, 'Gold');
    assert.equal(ok.body.data.reportingTags[0].tagName, 'Region');
    assert.equal(ok.body.data.reportingTags[0].optionName, tag.options[0].name);

    const filtered = await api(app, owner).get(`/api/vendors?tagOptionId=${tag.options[0].id}`);
    assert.equal(filtered.body.data.length, 1);
    assert.equal(filtered.body.data[0].displayName, 'CF Good');
  });

  it('rejects a reporting tag option from another organization', async () => {
    const optsB = await formOptions(app, otherOwner);
    const tagB = optsB.reportingTags[0];
    const res = await api(app, owner).post('/api/vendors').send(
      vendorPayload(opts, { displayName: 'Tag Foreign', bankAccounts: [], customFields: [{ fieldId, value: 'V-2' }], reportingTags: [{ tagId: tagB.id, optionId: tagB.options[0].id }] }),
    );
    assert.equal(res.status, 422);
    assert.equal(res.body.error.details[0].path, 'reportingTags.0.optionId');
  });

  after(async () => {
    // Make the required field optional again so later suites are unaffected.
    await api(app, owner).patch(`/api/settings/custom-fields/${fieldId}`).send({ isRequired: false });
  });
});

/* ------------------------------------------------------------------------- */
describe('RBAC enforcement on the API', () => {
  let vendorId: string;
  before(async () => {
    vendorId = (await api(app, owner).get('/api/vendors?search=Zenith')).body.data[0].id;
  });

  it('viewer can read but not create, edit, change status or delete', async () => {
    assert.equal((await api(app, viewer).get('/api/vendors')).status, 200);
    assert.equal((await api(app, viewer).get(`/api/vendors/${vendorId}`)).status, 200);
    assert.equal((await api(app, viewer).post('/api/vendors').send(vendorPayload(opts, { displayName: 'Viewer Vendor' }))).status, 403);
    assert.equal((await api(app, viewer).put(`/api/vendors/${vendorId}`).send(vendorPayload(opts))).status, 403);
    assert.equal((await api(app, viewer).patch(`/api/vendors/${vendorId}/status`).send({ status: 'INACTIVE' })).status, 403);
    assert.equal((await api(app, viewer).delete(`/api/vendors/${vendorId}`)).status, 403);
    assert.equal((await api(app, viewer).post(`/api/vendors/${vendorId}/notes`).send({ body: 'x' })).status, 403);
  });

  it('purchase executive can create and edit but not change status, delete or reveal bank numbers', async () => {
    const created = await api(app, executive).post('/api/vendors').send(vendorPayload(opts, { displayName: 'Exec Vendor', bankAccounts: [] }));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const edited = await api(app, executive).put(`/api/vendors/${created.body.data.id}`).send(vendorPayload(opts, { displayName: 'Exec Vendor 2', bankAccounts: [] }));
    assert.equal(edited.status, 200);
    assert.equal((await api(app, executive).patch(`/api/vendors/${vendorId}/status`).send({ status: 'INACTIVE' })).status, 403);
    assert.equal((await api(app, executive).delete(`/api/vendors/${vendorId}`)).status, 403);
    assert.equal((await api(app, executive).post('/api/settings/reporting-tags').send({ name: 'X' })).status, 403);
  });

  it('a suspended member loses access immediately', async () => {
    const members = await api(app, owner).get('/api/organizations/current/members');
    const viewerMember = members.body.data.find((m: { email: string }) => m.email === viewer.email);
    await api(app, owner).patch(`/api/organizations/current/members/${viewerMember.id}`).send({ status: 'SUSPENDED' });
    assert.equal((await api(app, viewer).get('/api/vendors')).status, 403);
    await api(app, owner).patch(`/api/organizations/current/members/${viewerMember.id}`).send({ status: 'ACTIVE' });
    assert.equal((await api(app, viewer).get('/api/vendors')).status, 200);
  });
});
