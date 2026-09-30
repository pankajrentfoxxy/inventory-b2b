/**
 * Legacy supplier backfill (phase-03 3.5): vendors (+ addresses, contacts, bank accounts) ->
 * parties (SUPPLIER). UUIDs preserved; invalid GSTINs are flagged and dropped, not lost silently
 * (they stay in the report). Bank account numbers are re-encrypted from the legacy key to the party
 * key. Idempotent; `--dry-run` reports.
 */
import { Client } from 'pg';
import { validateGstin } from '@b2b/shared';
import { createSecretBox, uuidv7 } from '@b2b/platform-kit';

export interface PartyMigrationReport {
  dryRun: boolean;
  suppliers: { source: number; migrated: number; skipped: number };
  addresses: number;
  contacts: number;
  bankAccounts: number;
  warnings: string[];
}

const strip = (u: string) => u.replace('?schema=public', '');

const TREATMENT: Record<string, string> = {
  REGISTERED_BUSINESS_REGULAR: 'REGISTERED',
  REGISTERED_BUSINESS_COMPOSITION: 'COMPOSITION',
  UNREGISTERED_BUSINESS: 'UNREGISTERED',
  OVERSEAS: 'OVERSEAS',
  SPECIAL_ECONOMIC_ZONE: 'SEZ',
  SEZ_DEVELOPER: 'SEZ',
  DEEMED_EXPORT: 'REGISTERED',
  TAX_DEDUCTOR: 'REGISTERED',
};

export async function migrateLegacySuppliers(urls: { legacy: string; party: string }, keys: { legacyKey: string; partyKey: string }, opts: { dryRun?: boolean } = {}): Promise<PartyMigrationReport> {
  const dryRun = opts.dryRun ?? false;
  const legacy = new Client({ connectionString: strip(urls.legacy) });
  const party = new Client({ connectionString: strip(urls.party) });
  await Promise.all([legacy.connect(), party.connect()]);
  const legacyBox = createSecretBox(keys.legacyKey);
  const partyBox = createSecretBox(keys.partyKey);
  const r: PartyMigrationReport = { dryRun, suppliers: { source: 0, migrated: 0, skipped: 0 }, addresses: 0, contacts: 0, bankAccounts: 0, warnings: [] };
  try {
    await party.query(`SELECT set_config('app.platform', 'true', false)`);
    const vendors = (await legacy.query(`SELECT v.id, v.organization_id, v.display_name, v.company_name, v.email, v.work_phone, v.mobile, v.website, v.gstin, v.pan, v.payment_term_id, v.status, v.remarks, v.created_at, g.code AS treatment_code
      FROM vendors v LEFT JOIN gst_treatments g ON g.id = v.gst_treatment_id WHERE v.deleted_at IS NULL ORDER BY v.created_at`)).rows as Record<string, string | null>[];
    r.suppliers.source = vendors.length;
    if (!dryRun) await party.query('BEGIN');
    for (const v of vendors) {
      const exists = await party.query('SELECT 1 FROM parties WHERE id = $1', [v.id]);
      if (exists.rowCount) {
        r.suppliers.skipped += 1;
        continue;
      }
      const tenantId = v.organization_id!;
      let treatment = TREATMENT[v.treatment_code ?? ''] ?? 'UNREGISTERED';
      if (!TREATMENT[v.treatment_code ?? '']) r.warnings.push(`vendor ${v.id}: unknown GST treatment ${v.treatment_code}; mapped to UNREGISTERED`);
      let gstin: string | null = v.gstin ? v.gstin.toUpperCase() : null;
      if (gstin && validateGstin(gstin, true)) {
        r.warnings.push(`vendor ${v.id} (${v.display_name}): invalid GSTIN ${gstin}; dropped`);
        gstin = null;
      }
      if (gstin) {
        const dup = await party.query(`SELECT id FROM parties WHERE tenant_id = $1 AND party_type = 'SUPPLIER' AND gstin = $2`, [tenantId, gstin]);
        if (dup.rowCount) {
          r.warnings.push(`vendor ${v.id}: GSTIN ${gstin} already used by ${dup.rows[0].id}; dropped`);
          gstin = null;
        }
      }
      if (!gstin && ['REGISTERED', 'COMPOSITION', 'SEZ'].includes(treatment)) {
        r.warnings.push(`vendor ${v.id}: ${treatment} without a valid GSTIN; treatment set to UNREGISTERED`);
        treatment = 'UNREGISTERED';
      }
      const addresses = (await legacy.query(`SELECT id, type, attention, address_line1, address_line2, city, state, state_code, postal_code, country_code, phone, is_primary FROM vendor_addresses WHERE vendor_id = $1 ORDER BY created_at`, [v.id])).rows as Record<string, string | boolean | null>[];
      const billingDefault = addresses.find((a) => a.type === 'BILLING' && a.is_primary) ?? addresses.find((a) => a.type === 'BILLING');
      if (gstin && billingDefault && typeof billingDefault.state_code === 'string' && billingDefault.state_code !== gstin.slice(0, 2)) {
        r.warnings.push(`vendor ${v.id}: GSTIN state ${gstin.slice(0, 2)} differs from billing address state ${billingDefault.state_code}; kept both for review`);
      }
      const baseCode = String(v.display_name).toUpperCase().split('').filter((c) => (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === ' ').join('').split(' ').filter(Boolean).map((w) => w.slice(0, 4)).join('').slice(0, 12) || 'SUP';
      const taken = await party.query(`SELECT 1 FROM parties WHERE tenant_id = $1 AND party_type = 'SUPPLIER' AND lower(code) = lower($2)`, [tenantId, baseCode]);
      const code = taken.rowCount ? `${baseCode}${String(v.id).slice(0, 4).toUpperCase()}` : baseCode;
      if (!dryRun) {
        await party.query(
          `INSERT INTO parties (id, tenant_id, party_type, code, legal_name, display_name, gst_treatment, gstin, pan, payment_term_id, email, phone, website, status, remarks, created_at, updated_at, version)
           VALUES ($1, $2, 'SUPPLIER', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now(), 0)`,
          [v.id, tenantId, code, v.company_name ?? v.display_name, v.display_name, treatment, gstin, v.pan && v.pan.length === 10 ? v.pan.toUpperCase() : null, v.payment_term_id, v.email?.toLowerCase() ?? null, v.mobile ?? v.work_phone ?? null, v.website ?? null, v.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE', v.remarks ?? null, v.created_at],
        );
        const seenDefault = new Set<string>();
        for (const a of addresses) {
          const pincode = String(a.postal_code ?? '');
          if ((a.country_code ?? 'IN') === 'IN' && !/^[1-9][0-9]{5}$/.test(pincode)) {
            r.warnings.push(`vendor ${v.id}: address ${a.id} has an invalid pincode "${pincode}"; skipped`);
            continue;
          }
          const stateCode = typeof a.state_code === 'string' && a.state_code.length === 2 ? a.state_code : gstin ? gstin.slice(0, 2) : '27';
          const kind = a.type === 'SHIPPING' ? 'SHIPPING' : 'BILLING';
          const isDefault = !seenDefault.has(kind) && (Boolean(a.is_primary) || !addresses.some((x) => (x.type === 'SHIPPING' ? 'SHIPPING' : 'BILLING') === kind && x.is_primary));
          if (isDefault) seenDefault.add(kind);
          await party.query(`INSERT INTO party_addresses (id, tenant_id, party_id, kind, attention, line1, line2, city, state, state_code, pincode, country, phone, is_default) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`, [a.id, tenantId, v.id, kind, a.attention, a.address_line1 ?? '-', a.address_line2, a.city ?? '-', a.state, stateCode, pincode || '000000', a.country_code ?? 'IN', a.phone, isDefault]);
          r.addresses += 1;
        }
        const contacts = (await legacy.query(`SELECT id, first_name, last_name, email, mobile, work_phone, designation, is_primary FROM vendor_contacts WHERE vendor_id = $1 ORDER BY created_at`, [v.id])).rows as Record<string, string | boolean | null>[];
        let primarySeen = false;
        for (const c of contacts) {
          const isPrimary = Boolean(c.is_primary) && !primarySeen;
          if (isPrimary) primarySeen = true;
          await party.query(`INSERT INTO party_contacts (id, tenant_id, party_id, name, email, phone, designation, is_primary) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [c.id, tenantId, v.id, [c.first_name, c.last_name].filter(Boolean).join(' ').slice(0, 150), c.email?.toString().toLowerCase() ?? null, c.mobile ?? c.work_phone ?? null, c.designation, isPrimary]);
          r.contacts += 1;
        }
        const banks = (await legacy.query(`SELECT id, bank_name, account_holder_name, account_number_encrypted, ifsc, branch, account_type, is_primary FROM vendor_bank_accounts WHERE vendor_id = $1 ORDER BY created_at`, [v.id])).rows as Record<string, string | boolean | null>[];
        let bankPrimary = false;
        for (const b of banks) {
          let plain: string;
          try {
            plain = legacyBox.decrypt(String(b.account_number_encrypted));
          } catch {
            r.warnings.push(`vendor ${v.id}: bank account ${b.id} could not be decrypted with LEGACY_APP_ENCRYPTION_KEY; skipped`);
            continue;
          }
          const isPrimary = Boolean(b.is_primary) && !bankPrimary;
          if (isPrimary) bankPrimary = true;
          await party.query(`INSERT INTO party_bank_accounts (id, tenant_id, party_id, bank_name, account_holder, account_number_enc, account_last4, ifsc, branch, account_type, is_primary) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [b.id, tenantId, v.id, b.bank_name, b.account_holder_name, partyBox.encrypt(plain), plain.slice(-4), b.ifsc, b.branch, b.account_type ?? 'CURRENT', isPrimary]);
          r.bankAccounts += 1;
        }
      }
      r.suppliers.migrated += 1;
    }
    if (!dryRun) {
      const count = Number((await party.query(`SELECT count(*) FROM parties WHERE party_type = 'SUPPLIER' AND id = ANY($1::uuid[])`, [vendors.map((v) => v.id)])).rows[0].count);
      if (count !== vendors.length) {
        await party.query('ROLLBACK');
        throw new Error(`reconciliation failed: ${count}/${vendors.length} suppliers present`);
      }
      await party.query('COMMIT');
    }
    return r;
  } catch (err) {
    if (!dryRun) await party.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await Promise.all([legacy.end(), party.end()]);
  }
}

if (process.argv[1] && /migrate-legacy\.ts$/.test(process.argv[1])) {
  const legacyKey = process.env.LEGACY_APP_ENCRYPTION_KEY ?? process.env.APP_ENCRYPTION_KEY;
  const partyKey = process.env.APP_ENCRYPTION_KEY;
  if (!legacyKey || !partyKey) {
    console.error('APP_ENCRYPTION_KEY (party) and LEGACY_APP_ENCRYPTION_KEY are required');
    process.exit(2);
  }
  migrateLegacySuppliers(
    { legacy: process.env.LEGACY_DATABASE_URL ?? 'postgresql://postgres:password123@localhost:5433/b2b_inventory?schema=public', party: process.env.PARTY_DATABASE_URL ?? 'postgresql://party_migrator:b2b_dev@localhost:5435/party_db?schema=public' },
    { legacyKey, partyKey },
    { dryRun: process.argv.includes('--dry-run') },
  )
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
