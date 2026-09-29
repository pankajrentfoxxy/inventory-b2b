import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '../src/lib/prisma.js';

const GSTIN_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Appends the mod-36 check character so tests always use a structurally valid GSTIN. */
export function gstinWithChecksum(prefix14: string) {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const value = GSTIN_ALPHABET.indexOf(prefix14[i]);
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return prefix14 + GSTIN_ALPHABET[(36 - (sum % 36)) % 36];
}

export const VALID_GSTIN = gstinWithChecksum('27AAPFU0939F1Z'); // Maharashtra, PAN AAPFU0939F
export const VALID_GSTIN_2 = gstinWithChecksum('29ABCDE1234F1Z'); // Karnataka, PAN ABCDE1234F

export async function resetDatabase() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "organizations", "users", "permissions", "currencies" RESTART IDENTITY CASCADE',
  );
}

export interface Session {
  token: string;
  orgId: string;
  userId: string;
  email: string;
}

export async function registerOrg(app: Express, orgName: string, email: string): Promise<Session> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Owner ' + orgName, email, password: 'Password123!', organizationName: orgName });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.token, orgId: res.body.organizations[0].id, userId: res.body.user.id, email };
}

export async function addMemberWithRole(app: Express, owner: Session, roleCode: string, email: string): Promise<Session> {
  const roles = await api(app, owner).get('/api/organizations/current/roles');
  const role = roles.body.data.find((r: { code: string }) => r.code === roleCode);
  if (!role) throw new Error(`role ${roleCode} missing`);
  const created = await api(app, owner)
    .post('/api/organizations/current/members')
    .send({ name: `Member ${roleCode.replace(/_/g, ' ').toLowerCase()}`, email, password: 'Password123!', roleId: role.id });
  if (created.status !== 201) throw new Error(`addMember failed: ${created.status} ${JSON.stringify(created.body)}`);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Password123!' });
  return { token: login.body.token, orgId: owner.orgId, userId: login.body.user.id, email };
}

/** supertest agent pre-configured with bearer token + tenant header. */
export function api(app: Express, s: Session, orgId = s.orgId) {
  const agent = request.agent(app);
  agent.set('Authorization', `Bearer ${s.token}`);
  if (orgId) agent.set('X-Organization-Id', orgId);
  return agent;
}

export async function formOptions(app: Express, s: Session) {
  const res = await api(app, s).get('/api/settings/vendor-form-options');
  return res.body.data as {
    gstTreatments: { id: string; code: string; requiresGstin: boolean }[];
    sourcesOfSupply: { id: string; code: string; name: string }[];
    paymentTerms: { id: string; name: string; isDefault: boolean }[];
    reportingTags: { id: string; name: string; options: { id: string; name: string }[] }[];
    customFields: { id: string; label: string; fieldType: string }[];
  };
}

export function byCode<T extends { code: string }>(list: T[], code: string): T {
  const found = list.find((x) => x.code === code);
  if (!found) throw new Error(`missing code ${code}`);
  return found;
}

export function vendorPayload(
  opts: ReturnType<typeof formOptions> extends Promise<infer O> ? O : never,
  overrides: Record<string, unknown> = {},
) {
  return {
    salutation: 'Mr.',
    firstName: 'Ravi',
    lastName: 'Kumar',
    companyName: 'Acme Components Pvt Ltd',
    displayName: 'Acme Components',
    email: 'Accounts@Acme.example',
    workPhoneCountryCode: '+91',
    workPhone: '022-4000 1234',
    mobileCountryCode: '+91',
    mobile: '98765 43210',
    language: 'en',
    gstTreatmentId: byCode(opts.gstTreatments, 'REGISTERED_BUSINESS_REGULAR').id,
    sourceOfSupplyId: byCode(opts.sourcesOfSupply, '27').id,
    gstin: VALID_GSTIN,
    pan: 'AAPFU0939F',
    paymentTermId: opts.paymentTerms.find((p) => p.isDefault)?.id ?? null,
    currencyCode: 'INR',
    vendorType: 'SUPPLIER',
    remarks: 'Preferred supplier for SSDs',
    addresses: [
      {
        type: 'BILLING',
        attention: 'Accounts',
        countryCode: 'IN',
        addressLine1: '12 MIDC Road',
        city: 'Pune',
        state: 'Maharashtra',
        stateCode: '27',
        postalCode: '411001',
        phone: '020 2222 3333',
        isPrimary: true,
      },
      {
        type: 'SHIPPING',
        attention: 'Warehouse',
        countryCode: 'IN',
        addressLine1: 'Plot 7, Chakan',
        city: 'Pune',
        state: 'Maharashtra',
        stateCode: '27',
        postalCode: '410501',
        isPrimary: true,
      },
    ],
    contacts: [
      { salutation: 'Ms.', firstName: 'Anita', lastName: 'Desai', email: 'anita@acme.example', mobile: '9000000001', designation: 'Sales Head', isPrimary: true },
      { firstName: 'Bharat', lastName: 'Shah', email: 'bharat@acme.example', workPhone: '02240001235', department: 'Accounts', isPrimary: false },
    ],
    bankAccounts: [
      { bankName: 'HDFC Bank', accountHolderName: 'Acme Components Pvt Ltd', accountNumber: '50100123456789', ifsc: 'HDFC0001234', branch: 'Pune MIDC', accountType: 'CURRENT', isPrimary: true },
    ],
    customFields: [],
    reportingTags: [],
    ...overrides,
  };
}
