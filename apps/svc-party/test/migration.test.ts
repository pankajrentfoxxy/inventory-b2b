/** Legacy supplier backfill: ids preserved, treatments mapped, invalid GSTIN flagged, bank accounts re-encrypted. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { createSecretBox, loadEnv } from '@b2b/platform-kit';
import { truncateAll } from '@b2b/test-kit';
import { partyEnvSchema } from '../src/config.js';
import { migrateLegacySuppliers } from '../scripts/migrate-legacy.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const LEGACY_URL = process.env.LEGACY_TEST_DATABASE_URL ?? 'postgresql://postgres:password123@localhost:5433/b2b_inventory_test';
const LEGACY_KEY = 'k1acWUZaeQmRzwxwVc2hTZB9iqAlCkBHvgTQ/svJ7+I=';
const orgId = randomUUID();
const vendorOk = randomUUID();
const vendorBad = randomUUID();
let legacyAvailable = true;
let partyUrl: string;
let partyKey: string;

async function seedLegacy() {
  const c = new Client({ connectionString: LEGACY_URL });
  await c.connect();
  const treat = randomUUID();
  try {
    await c.query('BEGIN');
    await c.query(`INSERT INTO organizations (id, name, slug, country_code, base_currency, created_at, updated_at) VALUES ($1, 'Party Legacy Org', $2, 'IN', 'INR', now(), now())`, [orgId, `mig-party-${orgId.slice(0, 8)}`]);
    await c.query(`INSERT INTO gst_treatments (id, organization_id, code, name, description, requires_gstin, sort_order, is_active, created_at, updated_at) VALUES ($1, $2, 'REGISTERED_BUSINESS_REGULAR', 'Registered', '', true, 1, true, now(), now())`, [treat, orgId]);
    await c.query(`INSERT INTO currencies (code, name, symbol) VALUES ('INR', 'Indian Rupee', 'Rs') ON CONFLICT DO NOTHING`);
    await c.query(`INSERT INTO vendors (id, organization_id, display_name, company_name, email, gst_treatment_id, gstin, pan, currency_code, status, created_at, updated_at) VALUES ($1, $2, 'Acme Components', 'Acme Components Pvt Ltd', 'Accounts@Acme.test', $3, '27AAPFU0939F1ZV', 'AAPFU0939F', 'INR', 'ACTIVE', now(), now()), ($4, $2, 'Broken GST Co', NULL, NULL, $3, '27INVALID000000', NULL, 'INR', 'ACTIVE', now(), now())`, [vendorOk, orgId, treat, vendorBad]);
    await c.query(`INSERT INTO vendor_addresses (id, vendor_id, organization_id, type, attention, address_line1, city, state, state_code, postal_code, country_code, is_primary, created_at, updated_at) VALUES ($1, $2, $3, 'BILLING', 'Accounts', '12 MIDC Road', 'Pune', 'Maharashtra', '27', '411001', 'IN', true, now(), now()), ($4, $2, $3, 'SHIPPING', NULL, 'Plot 7', 'Pune', 'Maharashtra', '27', 'BAD', 'IN', true, now(), now())`, [randomUUID(), vendorOk, orgId, randomUUID()]);
    await c.query(`INSERT INTO vendor_contacts (id, vendor_id, organization_id, first_name, last_name, email, mobile, is_primary, created_at, updated_at) VALUES ($1, $2, $3, 'Anita', 'Desai', 'anita@acme.test', '9000000001', true, now(), now())`, [randomUUID(), vendorOk, orgId]);
    await c.query(`INSERT INTO vendor_bank_accounts (id, vendor_id, organization_id, bank_name, account_holder_name, account_number_encrypted, account_number_last4, ifsc, account_type, is_primary, created_at, updated_at) VALUES ($1, $2, $3, 'HDFC Bank', 'Acme', $4, '6789', 'HDFC0001234', 'CURRENT', true, now(), now())`, [randomUUID(), vendorOk, orgId, createSecretBox(LEGACY_KEY).encrypt('50100123456789')]);
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    await c.end();
  }
}

before(async () => {
  const env = loadEnv(partyEnvSchema, { dir: path.resolve(here, '..') });
  partyUrl = env.MIGRATE_DATABASE_URL!;
  partyKey = env.APP_ENCRYPTION_KEY;
  await truncateAll(partyUrl);
  try {
    await seedLegacy();
  } catch (err) {
    legacyAvailable = false;
    console.warn(`legacy test database not available, skipping: ${(err as Error).message}`);
  }
});
after(async () => {
  if (!legacyAvailable) return;
  const c = new Client({ connectionString: LEGACY_URL });
  await c.connect();
  await c.query('DELETE FROM organizations WHERE id = $1', [orgId]).catch(() => undefined);
  await c.end();
});

describe('legacy supplier backfill', () => {
  it('migrates suppliers with sub-resources, flags invalid data and re-encrypts bank accounts', async (t) => {
    if (!legacyAvailable) return t.skip('legacy test database not available');
    const report = await migrateLegacySuppliers({ legacy: LEGACY_URL, party: partyUrl }, { legacyKey: LEGACY_KEY, partyKey });
    assert.ok(report.suppliers.migrated >= 2, 'the legacy test database may hold vendors from other suites');
    assert.ok(report.warnings.some((w) => w.includes('invalid GSTIN')));
    assert.ok(report.warnings.some((w) => w.includes('invalid pincode')));
    const p = new Client({ connectionString: partyUrl.replace('?schema=public', '') });
    await p.connect();
    try {
      const ok = (await p.query('SELECT gstin, gst_treatment, email, status FROM parties WHERE id = $1', [vendorOk])).rows[0];
      assert.equal(ok.gstin, '27AAPFU0939F1ZV');
      assert.equal(ok.gst_treatment, 'REGISTERED');
      assert.equal(ok.email, 'accounts@acme.test');
      const bad = (await p.query('SELECT gstin, gst_treatment FROM parties WHERE id = $1', [vendorBad])).rows[0];
      assert.equal(bad.gstin, null);
      assert.equal(bad.gst_treatment, 'UNREGISTERED', 'registered without a valid GSTIN is downgraded and reported');
      const addresses = (await p.query('SELECT kind, is_default FROM party_addresses WHERE party_id = $1', [vendorOk])).rows;
      assert.equal(addresses.length, 1, 'the address with an invalid pincode was skipped');
      assert.equal(addresses[0].kind, 'BILLING');
      const contact = (await p.query('SELECT name, is_primary FROM party_contacts WHERE party_id = $1', [vendorOk])).rows[0];
      assert.equal(contact.name, 'Anita Desai');
      const bank = (await p.query('SELECT account_number_enc, account_last4 FROM party_bank_accounts WHERE party_id = $1', [vendorOk])).rows[0];
      assert.equal(bank.account_last4, '6789');
      assert.equal(createSecretBox(partyKey).decrypt(bank.account_number_enc), '50100123456789');
    } finally {
      await p.end();
    }
    const again = await migrateLegacySuppliers({ legacy: LEGACY_URL, party: partyUrl }, { legacyKey: LEGACY_KEY, partyKey });
    assert.equal(again.suppliers.migrated, 0);
    assert.equal(again.suppliers.skipped, again.suppliers.source);
  });
});
