/**
 * Legacy PO/GRN backfill (phase-05 step 5). Legacy purchase_orders / lines / purchase_receives /
 * receive lines -> procurement tables with ids and numbers preserved. Snapshots are rebuilt from the
 * legacy vendor / item / location rows (documents keep what was true at the time). Received but
 * never QC'd stock becomes an opening-stock manifest (item x warehouse x qty x cost) that
 * operations load through `POST /api/v1/inventory/opening-stock/import` at go-live (decision 5.2:
 * pre-system stock is AVAILABLE). Idempotent; `--dry-run` reports; `--manifest <file>` writes JSON.
 */
import { writeFileSync } from 'node:fs';
import { Client } from 'pg';
import { uuidv7 } from '@b2b/platform-kit';

export interface ProcurementMigrationReport {
  dryRun: boolean;
  purchaseOrders: { source: number; migrated: number; skipped: number };
  grns: { source: number; migrated: number; skipped: number };
  openingManifest: { tenantId: string; warehouseId: string; itemId: string; qty: number; unitCost: number }[];
  warnings: string[];
}

const strip = (u: string) => u.replace('?schema=public', '');
const STATUS_MAP: Record<string, string> = { DRAFT: 'DRAFT', ISSUED: 'ISSUED', PARTIALLY_RECEIVED: 'PARTIALLY_RECEIVED', RECEIVED: 'RECEIVED', CLOSED: 'CLOSED', CANCELLED: 'CANCELLED' };
const num = (v: unknown) => Number(v ?? 0);

export async function migrateLegacyProcurement(urls: { legacy: string; procurement: string }, opts: { dryRun?: boolean } = {}): Promise<ProcurementMigrationReport> {
  const dryRun = opts.dryRun ?? false;
  const legacy = new Client({ connectionString: strip(urls.legacy) });
  const proc = new Client({ connectionString: strip(urls.procurement) });
  await Promise.all([legacy.connect(), proc.connect()]);
  const r: ProcurementMigrationReport = { dryRun, purchaseOrders: { source: 0, migrated: 0, skipped: 0 }, grns: { source: 0, migrated: 0, skipped: 0 }, openingManifest: [], warnings: [] };
  const manifest = new Map<string, { tenantId: string; warehouseId: string; itemId: string; qty: number; value: number }>();
  try {
    await proc.query(`SELECT set_config('app.platform', 'true', false)`);
    const orders = (await legacy.query(`SELECT po.*, v.display_name, v.company_name, v.gstin, v.pan, l.name AS location_name, l.state_code AS location_state
      FROM purchase_orders po JOIN vendors v ON v.id = po.vendor_id LEFT JOIN locations l ON l.id = coalesce(po.delivery_location_id, po.location_id)
      WHERE po.deleted_at IS NULL ORDER BY po.created_at`)).rows as Record<string, unknown>[];
    r.purchaseOrders.source = orders.length;
    if (!dryRun) await proc.query('BEGIN');
    for (const po of orders) {
      const exists = await proc.query('SELECT 1 FROM purchase_orders WHERE id = $1', [po.id]);
      if (exists.rowCount) {
        r.purchaseOrders.skipped += 1;
        continue;
      }
      const tenantId = String(po.organization_id);
      const warehouseId = (po.delivery_location_id ?? po.location_id) as string | null;
      if (!warehouseId) {
        r.warnings.push(`PO ${po.po_number}: no delivery location; skipped (assign a warehouse in legacy first)`);
        r.purchaseOrders.skipped += 1;
        continue;
      }
      const status = STATUS_MAP[String(po.status)] ?? 'CLOSED';
      const lines = (await legacy.query('SELECT * FROM purchase_order_lines WHERE purchase_order_id = $1 ORDER BY line_number', [po.id])).rows as Record<string, unknown>[];
      const usable = lines.filter((l) => l.item_id);
      if (usable.length !== lines.length) r.warnings.push(`PO ${po.po_number}: ${lines.length - usable.length} free-text line(s) without an item were dropped`);
      if (!usable.length) {
        r.warnings.push(`PO ${po.po_number}: no item lines; skipped`);
        r.purchaseOrders.skipped += 1;
        continue;
      }
      const supplierSnapshot = { id: po.vendor_id, tenantId, partyType: 'SUPPLIER', displayName: po.display_name, legalName: po.company_name ?? po.display_name, gstin: po.gstin ?? null, pan: po.pan ?? null, stateCode: po.source_of_supply_code ?? null, status: 'ACTIVE', migrated: true };
      const shipTo = { id: warehouseId, tenantId, code: String(po.location_name ?? 'WH').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12), name: po.location_name ?? 'Warehouse', stateCode: po.place_of_supply_code ?? po.location_state ?? '27', status: 'ACTIVE', migrated: true };
      if (!dryRun) {
        await proc.query(
          `INSERT INTO purchase_orders (id, tenant_id, number, revision, supplier_id, supplier_snapshot, ship_to_warehouse_id, ship_to_snapshot, order_date, expected_date, payment_term_id, currency, discount_type, discount_value, intra_state, subtotal, discount_amount, tax_total, tax_breakup, total, status, status_reason, notes, terms, created_by, issued_at, cancelled_at, closed_at, created_at, updated_at, version)
           VALUES ($1, $2, $3, 0, $4, $5::jsonb, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19, $20, 'LEGACY_MIGRATION', $21, $22, $23, $24, $25, $26, $27, now(), 0)`,
          [po.id, tenantId, po.po_number, po.vendor_id, JSON.stringify(supplierSnapshot), warehouseId, JSON.stringify(shipTo), po.order_date, po.expected_delivery_date, po.payment_term_id, po.currency_code ?? 'INR', po.discount_type ?? 'PERCENT', num(po.discount_value), Boolean(po.is_intra_state), num(po.sub_total), num(po.discount_amount), num(po.tax_total), JSON.stringify(po.tax_breakup ?? []), num(po.total), status, po.notes, po.terms, po.created_by ?? '00000000-0000-0000-0000-000000000000', po.issued_at, po.cancelled_at, po.closed_at, po.created_at],
        );
        for (const [i, l] of usable.entries()) {
          const item = (await legacy.query('SELECT id, name, sku, type, unit, hsn_code, track_inventory FROM items WHERE id = $1', [l.item_id])).rows[0] as Record<string, unknown> | undefined;
          const itemSnapshot = { id: l.item_id, tenantId, sku: l.sku ?? item?.sku ?? `LEG-${String(l.item_id).slice(0, 8)}`, name: l.name, type: item?.type ?? 'GOODS', trackInventory: item?.track_inventory ?? true, isSerialized: false, requiresImei: false, serialPattern: null, qcRequired: false, unitCode: String(l.unit ?? item?.unit ?? 'PCS').toUpperCase().slice(0, 10), hsnCode: l.hsn_code ?? item?.hsn_code ?? null, taxRate: num(l.tax_rate), status: 'ACTIVE', version: 0, migrated: true };
          const received = Math.min(num(l.received_quantity), num(l.quantity));
          const cancelled = status === 'CLOSED' || status === 'CANCELLED' ? Math.max(0, num(l.quantity) - received) : 0;
          await proc.query(
            `INSERT INTO po_lines (id, tenant_id, po_id, line_no, item_id, item_snapshot, ordered_qty, received_qty, cancelled_qty, unit_price, discount_pct, tax_rate, taxable_amount, tax_amount, line_total)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, 0, $11, $12, $13, $14)`,
            [l.id, tenantId, po.id, i + 1, l.item_id, JSON.stringify(itemSnapshot), num(l.quantity), received, cancelled, num(l.rate), num(l.tax_rate), num(l.taxable_amount), num(l.tax_amount), num(l.total)],
          );
        }
      }
      r.purchaseOrders.migrated += 1;
    }

    const receives = (await legacy.query(`SELECT pr.*, l.name AS location_name, l.state_code AS location_state FROM purchase_receives pr LEFT JOIN locations l ON l.id = pr.location_id ORDER BY pr.created_at`)).rows as Record<string, unknown>[];
    r.grns.source = receives.length;
    for (const g of receives) {
      const exists = await proc.query('SELECT 1 FROM grns WHERE id = $1', [g.id]);
      if (exists.rowCount) {
        r.grns.skipped += 1;
        continue;
      }
      const po = await proc.query('SELECT id, tenant_id, supplier_snapshot, ship_to_warehouse_id, ship_to_snapshot FROM purchase_orders WHERE id = $1', [g.purchase_order_id]);
      if (!po.rowCount) {
        r.warnings.push(`GRN ${g.receive_number}: its purchase order was not migrated; skipped`);
        r.grns.skipped += 1;
        continue;
      }
      const tenantId = String(g.organization_id);
      const warehouseId = (g.location_id as string | null) ?? (po.rows[0].ship_to_warehouse_id as string);
      const warehouseSnapshot = g.location_id ? { id: warehouseId, tenantId, code: String(g.location_name ?? 'WH').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12), name: g.location_name ?? 'Warehouse', stateCode: g.location_state ?? '27', status: 'ACTIVE', migrated: true } : po.rows[0].ship_to_snapshot;
      const cancelled = String(g.status) === 'CANCELLED';
      const lines = (await legacy.query('SELECT rl.*, pl.rate, pl.item_snapshot FROM purchase_receive_lines rl LEFT JOIN (SELECT id, rate, NULL::jsonb AS item_snapshot FROM purchase_order_lines) pl ON pl.id = rl.purchase_order_line_id WHERE rl.purchase_receive_id = $1 ORDER BY rl.created_at', [g.id])).rows as Record<string, unknown>[];
      if (!dryRun) {
        await proc.query(
          `INSERT INTO grns (id, tenant_id, number, po_id, supplier_id, supplier_snapshot, warehouse_id, warehouse_snapshot, received_date, status, status_reason, remarks, idempotency_key, created_by, received_at, cancelled_at, created_at, updated_at, version)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16, $17, now(), 0)`,
          [g.id, tenantId, g.receive_number, g.purchase_order_id, g.vendor_id, JSON.stringify(po.rows[0].supplier_snapshot), warehouseId, JSON.stringify(warehouseSnapshot), g.received_date, cancelled ? 'CANCELLED' : 'QC_COMPLETED', cancelled ? g.cancel_reason ?? 'Cancelled in legacy' : 'LEGACY_PRE_SYSTEM_QC', g.notes, g.idempotency_key, g.created_by ?? '00000000-0000-0000-0000-000000000000', g.created_at, g.cancelled_at, g.created_at],
        );
      }
      for (const [i, l] of lines.entries()) {
        const poLine = await proc.query('SELECT id, item_id, item_snapshot, unit_price FROM po_lines WHERE id = $1', [l.purchase_order_line_id]);
        if (!poLine.rowCount) {
          r.warnings.push(`GRN ${g.receive_number}: line for PO line ${l.purchase_order_line_id} has no migrated PO line; dropped`);
          continue;
        }
        const pl = poLine.rows[0];
        if (!dryRun) {
          await proc.query(
            `INSERT INTO grn_lines (id, tenant_id, grn_id, po_line_id, line_no, item_id, item_snapshot, qty, unit_cost, qc_status, qc_pass_qty, qc_fail_qty)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, 0)`,
            [l.id, tenantId, g.id, l.purchase_order_line_id, i + 1, pl.item_id, JSON.stringify(pl.item_snapshot), num(l.quantity), num(pl.unit_price), cancelled ? 'REVERSED' : 'DONE', cancelled ? 0 : num(l.quantity)],
          );
        }
        if (!cancelled) {
          const key = `${tenantId}|${warehouseId}|${pl.item_id}`;
          const m = manifest.get(key) ?? { tenantId, warehouseId, itemId: pl.item_id, qty: 0, value: 0 };
          m.qty += num(l.quantity);
          m.value += num(l.quantity) * num(pl.unit_price);
          manifest.set(key, m);
        }
      }
      r.grns.migrated += 1;
    }
    if (!dryRun) {
      const count = Number((await proc.query('SELECT count(*) FROM purchase_orders WHERE status_reason = $1', ['LEGACY_MIGRATION'])).rows[0].count);
      if (count < r.purchaseOrders.migrated) {
        await proc.query('ROLLBACK');
        throw new Error(`reconciliation failed: ${count}/${r.purchaseOrders.migrated} purchase orders present`);
      }
      await proc.query('COMMIT');
    }
    r.openingManifest = [...manifest.values()].map((m) => ({ tenantId: m.tenantId, warehouseId: m.warehouseId, itemId: m.itemId, qty: Math.round(m.qty * 1000) / 1000, unitCost: m.qty ? Math.round((m.value / m.qty) * 10000) / 10000 : 0 }));
    return r;
  } catch (err) {
    if (!dryRun) await proc.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await Promise.all([legacy.end(), proc.end()]);
  }
}

if (process.argv[1] && /migrate-legacy\.ts$/.test(process.argv[1])) {
  const manifestArg = process.argv.indexOf('--manifest');
  migrateLegacyProcurement(
    { legacy: process.env.LEGACY_DATABASE_URL ?? 'postgresql://postgres:password123@localhost:5433/b2b_inventory?schema=public', procurement: process.env.PROCUREMENT_DATABASE_URL ?? 'postgresql://procurement_migrator:b2b_dev@localhost:5435/procurement_db?schema=public' },
    { dryRun: process.argv.includes('--dry-run') },
  )
    .then((report) => {
      if (manifestArg > 0 && process.argv[manifestArg + 1]) {
        writeFileSync(process.argv[manifestArg + 1], JSON.stringify({ rows: report.openingManifest.map((m) => ({ warehouseId: m.warehouseId, itemId: m.itemId, qty: m.qty, unitCost: m.unitCost, tenantId: m.tenantId })) }, null, 2));
      }
      console.log(JSON.stringify(report, null, 2));
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
