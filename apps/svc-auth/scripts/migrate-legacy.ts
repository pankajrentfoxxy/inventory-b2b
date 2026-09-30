/**
 * Legacy identity migration (phase-01 1.5 "Legacy migration"):
 *   organizations       -> tenants (status ACTIVE, source LEGACY_MIGRATION, SAME id)
 *   users               -> auth users (user_type TENANT, bcrypt hash kept, SAME id; rehashed on login)
 *   organization_members -> tenant_memberships_bootstrap (role key mapped) + tenant_status_replica
 *
 * Idempotent (re-runs skip existing rows). `--dry-run` prints the reconciliation without writing.
 *
 *   npx tsx apps/svc-auth/scripts/migrate-legacy.ts --dry-run
 *   LEGACY_DATABASE_URL=... TENANT_DATABASE_URL=... AUTH_DATABASE_URL=... npx tsx apps/svc-auth/scripts/migrate-legacy.ts
 */
import { Client } from 'pg';
import { LEGACY_ROLE_MAP } from '@b2b/contracts';
import { uuidv7 } from '@b2b/platform-kit';

export interface MigrationUrls {
  legacy: string;
  tenant: string;
  auth: string;
}

export interface MigrationReport {
  dryRun: boolean;
  organizations: { legacy: number; migrated: number; skipped: number };
  users: { legacy: number; migrated: number; skipped: number };
  memberships: { legacy: number; migrated: number; skipped: number };
  warnings: string[];
}

const strip = (url: string) => url.replace('?schema=public', '');

function tenantCode(name: string, id: string): string {
  const base = name.toUpperCase().split('').filter((c) => (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === ' ').join('').split(' ').filter(Boolean).map((w) => w.slice(0, 4)).join('').slice(0, 12) || 'TEN';
  return `${base}${id.slice(0, 4).toUpperCase()}`;
}

export async function migrateLegacyIdentity(urls: MigrationUrls, opts: { dryRun?: boolean } = {}): Promise<MigrationReport> {
  const dryRun = opts.dryRun ?? false;
  const legacy = new Client({ connectionString: strip(urls.legacy) });
  const tenant = new Client({ connectionString: strip(urls.tenant) });
  const auth = new Client({ connectionString: strip(urls.auth) });
  await Promise.all([legacy.connect(), tenant.connect(), auth.connect()]);
  const report: MigrationReport = { dryRun, organizations: { legacy: 0, migrated: 0, skipped: 0 }, users: { legacy: 0, migrated: 0, skipped: 0 }, memberships: { legacy: 0, migrated: 0, skipped: 0 }, warnings: [] };
  try {
    const orgs = (await legacy.query(`SELECT o.id, o.name, o.slug, o.gstin, o.created_at,
        (SELECT u.name FROM organization_members m JOIN users u ON u.id = m.user_id WHERE m.organization_id = o.id AND m.is_owner ORDER BY m.created_at LIMIT 1) AS owner_name,
        (SELECT u.email FROM organization_members m JOIN users u ON u.id = m.user_id WHERE m.organization_id = o.id AND m.is_owner ORDER BY m.created_at LIMIT 1) AS owner_email
       FROM organizations o ORDER BY o.created_at`)).rows as { id: string; name: string; slug: string; gstin: string | null; created_at: Date; owner_name: string | null; owner_email: string | null }[];
    const users = (await legacy.query(`SELECT id, email, name, password_hash, is_active, created_at FROM users ORDER BY created_at`)).rows as { id: string; email: string; name: string; password_hash: string; is_active: boolean; created_at: Date }[];
    const members = (await legacy.query(`SELECT m.id, m.organization_id, m.user_id, m.status, m.is_owner, r.code AS role_code, m.created_at FROM organization_members m JOIN roles r ON r.id = m.role_id ORDER BY m.created_at`)).rows as { id: string; organization_id: string; user_id: string; status: string; is_owner: boolean; role_code: string; created_at: Date }[];
    report.organizations.legacy = orgs.length;
    report.users.legacy = users.length;
    report.memberships.legacy = members.length;

    if (!dryRun) await tenant.query('BEGIN');
    if (!dryRun) await auth.query('BEGIN');

    for (const o of orgs) {
      const exists = await tenant.query('SELECT 1 FROM tenants WHERE id = $1', [o.id]);
      if (exists.rowCount) {
        report.organizations.skipped += 1;
        continue;
      }
      if (!o.owner_email) report.warnings.push(`organization ${o.id} (${o.name}) has no owner member; owner fields left as placeholders`);
      const gstin = o.gstin && o.gstin.length === 15 ? o.gstin : null;
      if (o.gstin && !gstin) report.warnings.push(`organization ${o.id} has an invalid GSTIN "${o.gstin}"; dropped`);
      if (gstin) {
        const dup = await tenant.query(`SELECT id FROM tenants WHERE gstin = $1 AND status <> 'REJECTED'`, [gstin]);
        if (dup.rowCount) report.warnings.push(`organization ${o.id} GSTIN ${gstin} already used by tenant ${dup.rows[0].id}; migrated without GSTIN`);
      }
      const usableGstin = gstin && !(await tenant.query(`SELECT 1 FROM tenants WHERE gstin = $1 AND status <> 'REJECTED'`, [gstin])).rowCount ? gstin : null;
      if (!dryRun) {
        await tenant.query(
          `INSERT INTO tenants (id, code, legal_name, display_name, pan, gstin, registered_address, state_code, owner_name, owner_email, status, status_reason, source, created_at, updated_at, activated_at, version)
           VALUES ($1, $2, $3, $4, NULL, $5, $6::jsonb, $7, $8, $9, 'ACTIVE', 'grandfathered from legacy', 'LEGACY_MIGRATION', $10, now(), now(), 0)`,
          [o.id, tenantCode(o.name, o.id), o.name, o.name, usableGstin, JSON.stringify({ line1: 'unknown', city: 'unknown', state: 'unknown', stateCode: usableGstin ? usableGstin.slice(0, 2) : '00', pincode: '000000', country: 'IN', migrated: true }), usableGstin ? usableGstin.slice(0, 2) : null, o.owner_name ?? 'Owner', o.owner_email ?? `owner-${o.id}@migrated.invalid`, o.created_at],
        );
        await tenant.query(`INSERT INTO tenant_settings (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING`, [o.id]);
        await tenant.query(`INSERT INTO tenant_status_history (id, tenant_id, from_status, to_status, reason, actor_id, actor_name) VALUES ($1, $2, NULL, 'ACTIVE', 'legacy migration', NULL, 'migration')`, [uuidv7(), o.id]);
        await auth.query(`INSERT INTO tenant_status_replica (tenant_id, status, version) VALUES ($1, 'ACTIVE', 0) ON CONFLICT (tenant_id) DO NOTHING`, [o.id]);
      }
      report.organizations.migrated += 1;
    }

    for (const u of users) {
      const exists = await auth.query('SELECT 1 FROM users WHERE id = $1 OR email = $2', [u.id, u.email.toLowerCase()]);
      if (exists.rowCount) {
        report.users.skipped += 1;
        continue;
      }
      if (!dryRun) {
        await auth.query(
          `INSERT INTO users (id, email, full_name, user_type, password_hash, password_algo, status, created_at, updated_at, version)
           VALUES ($1, $2, $3, 'TENANT', $4, 'bcrypt', $5, $6, now(), 0)`,
          [u.id, u.email.toLowerCase(), u.name, u.password_hash, u.is_active ? 'ACTIVE' : 'DISABLED', u.created_at],
        );
      }
      report.users.migrated += 1;
    }

    for (const m of members) {
      const exists = await auth.query('SELECT 1 FROM tenant_memberships_bootstrap WHERE tenant_id = $1 AND user_id = $2', [m.organization_id, m.user_id]);
      if (exists.rowCount) {
        report.memberships.skipped += 1;
        continue;
      }
      const role = LEGACY_ROLE_MAP[m.role_code] ?? 'VIEWER';
      if (!LEGACY_ROLE_MAP[m.role_code]) report.warnings.push(`membership ${m.id}: unknown legacy role ${m.role_code}; mapped to VIEWER`);
      if (!dryRun) {
        await auth.query(`INSERT INTO tenant_memberships_bootstrap (id, tenant_id, user_id, role, status, created_at) VALUES ($1, $2, $3, $4, $5, $6)`, [m.id, m.organization_id, m.user_id, role, m.status === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED', m.created_at]);
      }
      report.memberships.migrated += 1;
    }

    if (!dryRun) {
      // Reconciliation before commit: every legacy org / user / membership must exist on the platform.
      const tenantCount = Number((await tenant.query('SELECT count(*) FROM tenants WHERE id = ANY($1::uuid[])', [orgs.map((o) => o.id)])).rows[0].count);
      const userCount = Number((await auth.query('SELECT count(*) FROM users WHERE id = ANY($1::uuid[])', [users.map((u) => u.id)])).rows[0].count);
      const memberCount = Number((await auth.query('SELECT count(*) FROM tenant_memberships_bootstrap WHERE id = ANY($1::uuid[])', [members.map((m) => m.id)])).rows[0].count);
      if (tenantCount !== orgs.length || userCount !== users.length || memberCount !== members.length) {
        await tenant.query('ROLLBACK');
        await auth.query('ROLLBACK');
        throw new Error(`reconciliation failed: tenants ${tenantCount}/${orgs.length}, users ${userCount}/${users.length}, memberships ${memberCount}/${members.length}`);
      }
      await tenant.query('COMMIT');
      await auth.query('COMMIT');
    }
    return report;
  } catch (err) {
    if (!dryRun) {
      await tenant.query('ROLLBACK').catch(() => undefined);
      await auth.query('ROLLBACK').catch(() => undefined);
    }
    throw err;
  } finally {
    await Promise.all([legacy.end(), tenant.end(), auth.end()]);
  }
}

if (process.argv[1] && /migrate-legacy\.ts$/.test(process.argv[1])) {
  const dryRun = process.argv.includes('--dry-run');
  const urls: MigrationUrls = {
    legacy: process.env.LEGACY_DATABASE_URL ?? 'postgresql://postgres:password123@localhost:5433/b2b_inventory?schema=public',
    tenant: process.env.TENANT_DATABASE_URL ?? 'postgresql://tenant_migrator:b2b_dev@localhost:5435/tenant_db?schema=public',
    auth: process.env.AUTH_DATABASE_URL ?? 'postgresql://auth_migrator:b2b_dev@localhost:5435/auth_db?schema=public',
  };
  migrateLegacyIdentity(urls, { dryRun })
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
