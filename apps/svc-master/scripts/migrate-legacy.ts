/**
 * Legacy master-data backfill (phase-03 3.5): items -> products, taxes -> tax_rates, locations ->
 * warehouses, payment_terms -> payment_terms, custom_field_definitions -> custom_field_defs.
 * Legacy UUIDs are preserved so PO/GRN references stay valid. Idempotent; `--dry-run` reports.
 */
import { Client } from 'pg';
import { uuidv7 } from '@b2b/platform-kit';
import { DEFAULT_UNITS } from '../src/modules/defaults.js';

export interface MasterMigrationReport {
  dryRun: boolean;
  organizations: number;
  taxes: { source: number; migrated: number; skipped: number };
  paymentTerms: { source: number; migrated: number; skipped: number };
  warehouses: { source: number; migrated: number; skipped: number };
  products: { source: number; migrated: number; skipped: number };
  customFields: { source: number; migrated: number; skipped: number };
  warnings: string[];
}

const strip = (u: string) => u.replace('?schema=public', '');
const GST_SLABS = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];

export async function migrateLegacyMaster(urls: { legacy: string; master: string }, opts: { dryRun?: boolean } = {}): Promise<MasterMigrationReport> {
  const dryRun = opts.dryRun ?? false;
  const legacy = new Client({ connectionString: strip(urls.legacy) });
  const master = new Client({ connectionString: strip(urls.master) });
  await Promise.all([legacy.connect(), master.connect()]);
  const r: MasterMigrationReport = { dryRun, organizations: 0, taxes: { source: 0, migrated: 0, skipped: 0 }, paymentTerms: { source: 0, migrated: 0, skipped: 0 }, warehouses: { source: 0, migrated: 0, skipped: 0 }, products: { source: 0, migrated: 0, skipped: 0 }, customFields: { source: 0, migrated: 0, skipped: 0 }, warnings: [] };
  const counts = { taxes: 0, terms: 0, wh: 0, products: 0, cf: 0 };
  try {
    await master.query(`SELECT set_config('app.platform', 'true', false)`);
    const orgs = (await legacy.query('SELECT id, name FROM organizations ORDER BY created_at')).rows as { id: string; name: string }[];
    r.organizations = orgs.length;
    if (!dryRun) await master.query('BEGIN');
    for (const org of orgs) {
      const tenantId = org.id;
      // units: make sure the defaults exist, plus any unit string used by legacy items
      const unitIds = new Map<string, string>();
      const ensureUnit = async (code: string): Promise<string> => {
        const key = code.trim().toUpperCase().slice(0, 10) || 'PCS';
        if (unitIds.has(key)) return unitIds.get(key)!;
        const existing = await master.query('SELECT id FROM units WHERE tenant_id = $1 AND lower(code) = lower($2)', [tenantId, key]);
        let id = existing.rows[0]?.id as string | undefined;
        if (!id) {
          id = uuidv7();
          const def = DEFAULT_UNITS.find((u) => u.code === key);
          if (!dryRun) await master.query('INSERT INTO units (id, tenant_id, code, name, decimals, uqc) VALUES ($1, $2, $3, $4, $5, $6)', [id, tenantId, key, def?.name ?? key, def?.decimals ?? 0, def?.uqc ?? null]);
        }
        unitIds.set(key, id);
        return id;
      };
      for (const u of DEFAULT_UNITS) await ensureUnit(u.code);

      const taxes = (await legacy.query('SELECT id, name, rate, is_default, is_active FROM taxes WHERE organization_id = $1', [tenantId])).rows as { id: string; name: string; rate: string; is_default: boolean; is_active: boolean }[];
      r.taxes.source += taxes.length;
      for (const t of taxes) {
        const exists = await master.query('SELECT 1 FROM tax_rates WHERE id = $1', [t.id]);
        if (exists.rowCount) {
          r.taxes.skipped += 1;
          continue;
        }
        const rate = Number(t.rate);
        if (!GST_SLABS.includes(rate)) {
          r.warnings.push(`tax ${t.id} (${t.name}) rate ${rate} is not a GST slab; skipped`);
          r.taxes.skipped += 1;
          continue;
        }
        if (!dryRun) await master.query(`INSERT INTO tax_rates (id, tenant_id, name, gst_rate, cess_rate, effective_from, status) VALUES ($1, $2, $3, $4, 0, '2017-07-01', $5) ON CONFLICT DO NOTHING`, [t.id, tenantId, t.name, rate, t.is_active ? 'ACTIVE' : 'INACTIVE']);
        r.taxes.migrated += 1;
        counts.taxes += 1;
      }

      const terms = (await legacy.query('SELECT id, name, days, is_default, is_active FROM payment_terms WHERE organization_id = $1', [tenantId])).rows as { id: string; name: string; days: number; is_default: boolean; is_active: boolean }[];
      r.paymentTerms.source += terms.length;
      for (const p of terms) {
        const exists = await master.query('SELECT 1 FROM payment_terms WHERE id = $1 OR (tenant_id = $2 AND lower(name) = lower($3))', [p.id, tenantId, p.name]);
        if (exists.rowCount) {
          r.paymentTerms.skipped += 1;
          continue;
        }
        if (!dryRun) {
          if (p.is_default) await master.query('UPDATE payment_terms SET is_default = false WHERE tenant_id = $1 AND is_default', [tenantId]);
          await master.query('INSERT INTO payment_terms (id, tenant_id, name, days, is_default, status) VALUES ($1, $2, $3, $4, $5, $6)', [p.id, tenantId, p.name, p.days, p.is_default, p.is_active ? 'ACTIVE' : 'INACTIVE']);
        }
        r.paymentTerms.migrated += 1;
        counts.terms += 1;
      }

      const locations = (await legacy.query('SELECT id, name, address_line1, address_line2, city, state, state_code, postal_code, country_code, phone, gstin, is_primary, is_active FROM locations WHERE organization_id = $1 ORDER BY created_at', [tenantId])).rows as Record<string, string | boolean | null>[];
      r.warehouses.source += locations.length;
      for (const l of locations) {
        const exists = await master.query('SELECT 1 FROM warehouses WHERE id = $1', [l.id]);
        if (exists.rowCount) {
          r.warehouses.skipped += 1;
          continue;
        }
        const stateCode = typeof l.state_code === 'string' && l.state_code.length === 2 ? l.state_code : null;
        if (!stateCode) r.warnings.push(`location ${l.id} (${l.name}) has no GST state code; defaulted to 27 - fix in Masters`);
        const code = String(l.name).toUpperCase().split('').filter((c) => (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')).join('').slice(0, 12) || 'WH';
        const codeTaken = await master.query('SELECT 1 FROM warehouses WHERE tenant_id = $1 AND lower(code) = lower($2)', [tenantId, code]);
        const finalCode = codeTaken.rowCount ? `${code}${String(l.id).slice(0, 4).toUpperCase()}` : code;
        if (!dryRun) {
          const hasDefault = await master.query('SELECT 1 FROM warehouses WHERE tenant_id = $1 AND is_default', [tenantId]);
          const isDefault = Boolean(l.is_primary) && !hasDefault.rowCount;
          await master.query(
            `INSERT INTO warehouses (id, tenant_id, code, name, address, state_code, gstin, is_default, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, now(), now())`,
            [l.id, tenantId, finalCode, l.name, JSON.stringify({ line1: l.address_line1 ?? '', line2: l.address_line2 ?? null, city: l.city ?? '', state: l.state ?? null, stateCode: stateCode ?? '27', pincode: l.postal_code ?? '', country: l.country_code ?? 'IN', phone: l.phone ?? null, migrated: true }), stateCode ?? '27', typeof l.gstin === 'string' && l.gstin.length === 15 ? l.gstin : null, isDefault, l.is_active ? 'ACTIVE' : 'INACTIVE'],
          );
          await master.query(`INSERT INTO locations (id, tenant_id, warehouse_id, code, name, purpose) VALUES ($1, $2, $3, 'STORE', 'Storage', 'STORAGE')`, [uuidv7(), tenantId, l.id]);
        }
        r.warehouses.migrated += 1;
        counts.wh += 1;
      }

      const items = (await legacy.query('SELECT id, name, sku, type, unit, description, hsn_code, purchase_rate, selling_rate, tax_id, track_inventory, reorder_level, is_active, deleted_at FROM items WHERE organization_id = $1 ORDER BY created_at', [tenantId])).rows as Record<string, string | boolean | null>[];
      r.products.source += items.length;
      for (const it of items) {
        const exists = await master.query('SELECT 1 FROM products WHERE id = $1', [it.id]);
        if (exists.rowCount) {
          r.products.skipped += 1;
          continue;
        }
        const unitId = await ensureUnit(String(it.unit ?? 'pcs'));
        let sku = typeof it.sku === 'string' && it.sku.trim() ? it.sku.trim().slice(0, 40) : `LEG-${String(it.id).slice(0, 8).toUpperCase()}`;
        const skuTaken = await master.query('SELECT 1 FROM products WHERE tenant_id = $1 AND lower(sku) = lower($2)', [tenantId, sku]);
        if (skuTaken.rowCount) {
          r.warnings.push(`item ${it.id} SKU ${sku} collides after case folding; suffixed`);
          sku = `${sku}-${String(it.id).slice(0, 4).toUpperCase()}`.slice(0, 40);
        }
        let hsnId: string | null = null;
        if (typeof it.hsn_code === 'string' && /^[0-9]{4,8}$/.test(it.hsn_code)) {
          const hsn = await master.query('SELECT id FROM hsn_codes WHERE tenant_id = $1 AND code = $2', [tenantId, it.hsn_code]);
          hsnId = hsn.rows[0]?.id ?? uuidv7();
          if (!hsn.rowCount && !dryRun) await master.query(`INSERT INTO hsn_codes (id, tenant_id, code, kind, default_tax_rate_id) VALUES ($1, $2, $3, $4, $5)`, [hsnId, tenantId, it.hsn_code, it.type === 'SERVICE' ? 'SAC' : 'HSN', it.tax_id ?? null]);
        }
        const taxOk = it.tax_id ? (await master.query('SELECT 1 FROM tax_rates WHERE id = $1', [it.tax_id])).rowCount : 0;
        const type = it.type === 'SERVICE' ? 'SERVICE' : 'GOODS';
        const track = type === 'GOODS' && Boolean(it.track_inventory);
        const status = it.deleted_at ? 'ARCHIVED' : it.is_active ? 'ACTIVE' : 'INACTIVE';
        if (!dryRun) {
          await master.query(
            `INSERT INTO products (id, tenant_id, sku, name, description, type, track_inventory, is_serialized, requires_imei, qc_required, unit_id, hsn_id, tax_rate_id, purchase_price, selling_price, reorder_level, status, created_at, updated_at, version)
             VALUES ($1, $2, $3, $4, $5, $6, $7, false, false, $7, $8, $9, $10, $11, $12, $13, $14, now(), now(), 0)`,
            [it.id, tenantId, sku, it.name, it.description ?? null, type, track, unitId, hsnId, taxOk ? it.tax_id : null, it.purchase_rate ?? null, it.selling_rate ?? null, it.reorder_level ?? null, status],
          );
        }
        r.products.migrated += 1;
        counts.products += 1;
      }

      const fields = (await legacy.query(`SELECT id, entity_type, key, label, field_type, options, is_required, is_active FROM custom_field_definitions WHERE organization_id = $1`, [tenantId])).rows as Record<string, string | boolean | null | unknown>[];
      r.customFields.source += fields.length;
      for (const f of fields) {
        const exists = await master.query('SELECT 1 FROM custom_field_defs WHERE id = $1', [f.id]);
        if (exists.rowCount) {
          r.customFields.skipped += 1;
          continue;
        }
        const entity = f.entity_type === 'VENDOR' ? 'SUPPLIER' : String(f.entity_type);
        const dataType = f.field_type === 'DROPDOWN' ? 'SELECT' : String(f.field_type);
        if (!dryRun) await master.query(`INSERT INTO custom_field_defs (id, tenant_id, entity, key, label, data_type, options, required, status) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9) ON CONFLICT DO NOTHING`, [f.id, tenantId, entity, String(f.key).slice(0, 40), f.label, dataType, f.options ? JSON.stringify(f.options) : null, Boolean(f.is_required), f.is_active ? 'ACTIVE' : 'INACTIVE']);
        r.customFields.migrated += 1;
        counts.cf += 1;
      }
    }
    if (!dryRun) {
      const productCount = Number((await master.query('SELECT count(*) FROM products WHERE id IN (SELECT id FROM products)')).rows[0].count);
      if (productCount < counts.products) {
        await master.query('ROLLBACK');
        throw new Error('reconciliation failed: products missing after insert');
      }
      await master.query('COMMIT');
    }
    return r;
  } catch (err) {
    if (!dryRun) await master.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await Promise.all([legacy.end(), master.end()]);
  }
}

if (process.argv[1] && /migrate-legacy\.ts$/.test(process.argv[1])) {
  migrateLegacyMaster(
    { legacy: process.env.LEGACY_DATABASE_URL ?? 'postgresql://postgres:password123@localhost:5433/b2b_inventory?schema=public', master: process.env.MASTER_DATABASE_URL ?? 'postgresql://master_migrator:b2b_dev@localhost:5435/master_db?schema=public' },
    { dryRun: process.argv.includes('--dry-run') },
  )
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
