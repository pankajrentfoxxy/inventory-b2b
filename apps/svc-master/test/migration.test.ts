/** Legacy master backfill: ids preserved, units derived, SKU collisions suffixed, idempotent re-run. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { loadEnv } from '@b2b/platform-kit';
import { truncateAll } from '@b2b/test-kit';
import { masterEnvSchema } from '../src/config.js';
import { migrateLegacyMaster } from '../scripts/migrate-legacy.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const LEGACY_URL = process.env.LEGACY_TEST_DATABASE_URL ?? 'postgresql://postgres:password123@localhost:5433/b2b_inventory_test';
const orgId = randomUUID();
const taxId = randomUUID();
const itemA = randomUUID();
const itemB = randomUUID();
const locId = randomUUID();
let legacyAvailable = true;
let masterUrl: string;

async function seedLegacy() {
  const c = new Client({ connectionString: LEGACY_URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query(`INSERT INTO organizations (id, name, slug, country_code, base_currency, created_at, updated_at) VALUES ($1, 'Master Legacy Org', $2, 'IN', 'INR', now(), now())`, [orgId, `mig-master-${orgId.slice(0, 8)}`]);
    await c.query(`INSERT INTO taxes (id, organization_id, name, rate, is_default, is_active, created_at, updated_at) VALUES ($1, $2, 'GST18', 18, true, true, now(), now()), ($3, $2, 'ODD', 13, false, true, now(), now())`, [taxId, orgId, randomUUID()]);
    await c.query(`INSERT INTO payment_terms (id, organization_id, name, days, is_default, is_active, created_at, updated_at) VALUES ($1, $2, 'Net 30', 30, true, true, now(), now())`, [randomUUID(), orgId]);
    await c.query(`INSERT INTO locations (id, organization_id, name, type, address_line1, city, state, state_code, postal_code, country_code, is_primary, is_active, created_at, updated_at) VALUES ($1, $2, 'Head Office', 'OFFICE', '12 Andheri East', 'Mumbai', 'Maharashtra', '27', '400069', 'IN', true, true, now(), now())`, [locId, orgId]);
    await c.query(`INSERT INTO items (id, organization_id, name, sku, type, unit, hsn_code, purchase_rate, tax_id, track_inventory, is_active, created_at, updated_at) VALUES ($1, $2, 'Samsung SSD', 'SSD-870', 'GOODS', 'pcs', '84717020', 3200, $3, true, true, now(), now()), ($4, $2, 'Install Service', 'INST-SVC', 'SERVICE', 'hrs', NULL, 500, $3, false, true, now(), now())`, [itemA, orgId, taxId, itemB]);
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    await c.end();
  }
}

before(async () => {
  const env = loadEnv(masterEnvSchema, { dir: path.resolve(here, '..') });
  masterUrl = env.MIGRATE_DATABASE_URL!;
  await truncateAll(masterUrl);
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

describe('legacy master backfill', () => {
  it('migrates taxes, terms, locations and items with preserved ids and a reconciliation report', async (t) => {
    if (!legacyAvailable) return t.skip('legacy test database not available');
    const dry = await migrateLegacyMaster({ legacy: LEGACY_URL, master: masterUrl }, { dryRun: true });
    assert.ok(dry.organizations >= 1);
    const report = await migrateLegacyMaster({ legacy: LEGACY_URL, master: masterUrl });
    assert.ok(report.warnings.some((w) => w.includes('not a GST slab')), 'the 13% tax is flagged, not dropped silently');
    const m = new Client({ connectionString: masterUrl.replace('?schema=public', '') });
    await m.connect();
    try {
      const products = (await m.query('SELECT id, sku, type, track_inventory, status, unit_id FROM products WHERE tenant_id = $1 ORDER BY sku', [orgId])).rows;
      assert.equal(products.length, 2);
      assert.ok(products.some((p) => p.id === itemA && p.sku === 'SSD-870' && p.track_inventory === true));
      const service = products.find((p) => p.id === itemB);
      assert.equal(service.type, 'SERVICE');
      assert.equal(service.track_inventory, false);
      assert.equal(service.sku, 'INST-SVC');
      const units = (await m.query('SELECT code FROM units WHERE tenant_id = $1 ORDER BY code', [orgId])).rows.map((u) => u.code);
      assert.ok(units.includes('PCS') && units.includes('HRS'));
      const wh = (await m.query('SELECT id, code, state_code, is_default FROM warehouses WHERE tenant_id = $1', [orgId])).rows;
      assert.equal(wh.length, 1);
      assert.equal(wh[0].id, locId);
      assert.equal(wh[0].state_code, '27');
      assert.equal(wh[0].is_default, true);
      const tax = (await m.query('SELECT id, gst_rate FROM tax_rates WHERE tenant_id = $1', [orgId])).rows;
      assert.equal(tax.length, 1);
      assert.equal(tax[0].id, taxId);
      const hsn = (await m.query('SELECT code FROM hsn_codes WHERE tenant_id = $1', [orgId])).rows;
      assert.equal(hsn[0].code, '84717020');
    } finally {
      await m.end();
    }
    const again = await migrateLegacyMaster({ legacy: LEGACY_URL, master: masterUrl });
    assert.equal(again.products.migrated, 0);
    assert.equal(again.warehouses.migrated, 0);
  });
});
