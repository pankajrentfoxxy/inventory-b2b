/** Legacy PO/GRN backfill: ids and numbers preserved, statuses mapped, receipts marked pre-system QC, opening manifest, idempotent. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { loadEnv } from '@b2b/platform-kit';
import { truncateAll } from '@b2b/test-kit';
import { procurementEnvSchema } from '../src/config.js';
import { migrateLegacyProcurement } from '../scripts/migrate-legacy.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const LEGACY_URL = process.env.LEGACY_TEST_DATABASE_URL ?? 'postgresql://postgres:password123@localhost:5433/b2b_inventory_test';
const orgId = randomUUID();
const vendorId = randomUUID();
const itemId = randomUUID();
const locationId = randomUUID();
const poId = randomUUID();
const poLineId = randomUUID();
const grnId = randomUUID();
let legacyAvailable = true;
let procUrl: string;

async function seedLegacy() {
  const c = new Client({ connectionString: LEGACY_URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query(`INSERT INTO organizations (id, name, slug, country_code, base_currency, created_at, updated_at) VALUES ($1, 'Proc Legacy Org', $2, 'IN', 'INR', now(), now())`, [orgId, `mig-proc-${orgId.slice(0, 8)}`]);
    await c.query(`INSERT INTO currencies (code, name, symbol) VALUES ('INR', 'Indian Rupee', 'Rs') ON CONFLICT DO NOTHING`);
    await c.query(`INSERT INTO vendors (id, organization_id, display_name, company_name, gstin, currency_code, status, created_at, updated_at) VALUES ($1, $2, 'Legacy Supplier', 'Legacy Supplier Pvt Ltd', '27AAPFU0939F1ZV', 'INR', 'ACTIVE', now(), now())`, [vendorId, orgId]);
    await c.query(`INSERT INTO locations (id, organization_id, name, type, address_line1, city, state, state_code, postal_code, country_code, is_primary, is_active, created_at, updated_at) VALUES ($1, $2, 'Main Store', 'WAREHOUSE', '1 Road', 'Pune', 'Maharashtra', '27', '411001', 'IN', true, true, now(), now())`, [locationId, orgId]);
    await c.query(`INSERT INTO items (id, organization_id, name, sku, type, unit, purchase_rate, track_inventory, is_active, created_at, updated_at) VALUES ($1, $2, 'Legacy Widget', 'LW-1', 'GOODS', 'pcs', 50, true, true, now(), now())`, [itemId, orgId]);
    await c.query(`INSERT INTO purchase_orders (id, organization_id, po_number, vendor_id, location_id, delivery_location_id, order_date, status, sub_total, tax_total, total, issued_at, created_at, updated_at) VALUES ($1, $2, 'PO-LEG-0001', $3, $4, $4, '2026-06-01', 'PARTIALLY_RECEIVED', 5000, 900, 5900, now(), now(), now())`, [poId, orgId, vendorId, locationId]);
    await c.query(`INSERT INTO purchase_order_lines (id, purchase_order_id, organization_id, line_number, item_id, name, sku, quantity, unit, rate, tax_rate, amount, taxable_amount, tax_amount, total, received_quantity, created_at, updated_at) VALUES ($1, $2, $3, 1, $4, 'Legacy Widget', 'LW-1', 100, 'pcs', 50, 18, 5000, 5000, 900, 5900, 40, now(), now())`, [poLineId, poId, orgId, itemId]);
    await c.query(`INSERT INTO purchase_receives (id, organization_id, purchase_order_id, vendor_id, location_id, receive_number, received_date, status, total_quantity, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, 'GRN-LEG-0001', '2026-06-10', 'RECEIVED', 40, now(), now())`, [grnId, orgId, poId, vendorId, locationId]);
    await c.query(`INSERT INTO purchase_receive_lines (id, purchase_receive_id, organization_id, purchase_order_line_id, item_id, quantity, created_at) VALUES ($1, $2, $3, $4, $5, 40, now())`, [randomUUID(), grnId, orgId, poLineId, itemId]);
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    await c.end();
  }
}

before(async () => {
  const env = loadEnv(procurementEnvSchema, { dir: path.resolve(here, '..') });
  procUrl = env.MIGRATE_DATABASE_URL!;
  await truncateAll(procUrl);
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

describe('legacy PO/GRN backfill', () => {
  it('migrates orders and receipts with preserved ids, marks pre-system QC, builds the opening manifest', async (t) => {
    if (!legacyAvailable) return t.skip('legacy test database not available');
    const report = await migrateLegacyProcurement({ legacy: LEGACY_URL, procurement: procUrl });
    assert.ok(report.purchaseOrders.migrated >= 1);
    assert.ok(report.grns.migrated >= 1);
    const row = report.openingManifest.find((m) => m.itemId === itemId);
    assert.deepEqual(row, { tenantId: orgId, warehouseId: locationId, itemId, qty: 40, unitCost: 50 });
    const p = new Client({ connectionString: procUrl.replace('?schema=public', '') });
    await p.connect();
    try {
      const po = (await p.query('SELECT number, status, supplier_id, ship_to_warehouse_id, total::float8 AS total, supplier_snapshot FROM purchase_orders WHERE id = $1', [poId])).rows[0];
      assert.equal(po.number, 'PO-LEG-0001');
      assert.equal(po.status, 'PARTIALLY_RECEIVED');
      assert.equal(po.supplier_id, vendorId);
      assert.equal(po.ship_to_warehouse_id, locationId);
      assert.equal(po.total, 5900);
      assert.equal(po.supplier_snapshot.gstin, '27AAPFU0939F1ZV');
      const line = (await p.query('SELECT ordered_qty::float8 AS o, received_qty::float8 AS r, item_snapshot FROM po_lines WHERE id = $1', [poLineId])).rows[0];
      assert.deepEqual([line.o, line.r], [100, 40]);
      assert.equal(line.item_snapshot.sku, 'LW-1');
      const grn = (await p.query('SELECT number, status, status_reason FROM grns WHERE id = $1', [grnId])).rows[0];
      assert.deepEqual([grn.number, grn.status, grn.status_reason], ['GRN-LEG-0001', 'QC_COMPLETED', 'LEGACY_PRE_SYSTEM_QC']);
      const gl = (await p.query('SELECT qty::float8 AS qty, unit_cost::float8 AS cost, qc_status FROM grn_lines WHERE grn_id = $1', [grnId])).rows[0];
      assert.deepEqual([gl.qty, gl.cost, gl.qc_status], [40, 50, 'DONE']);
    } finally {
      await p.end();
    }
    const again = await migrateLegacyProcurement({ legacy: LEGACY_URL, procurement: procUrl });
    assert.equal(again.purchaseOrders.migrated, 0);
    assert.equal(again.grns.migrated, 0);
  });
});
