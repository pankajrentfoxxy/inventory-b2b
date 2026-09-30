/**
 * Phase 2 migration of the Phase 1 bootstrap tables from auth_db into iam_db:
 *   tenant_memberships_bootstrap -> memberships (+ system roles per tenant, role by key)
 *   platform_role_assignments    -> platform memberships (tenant_id NULL) with platform roles
 * Identity snapshots (email, full name) are read from auth_db users. Idempotent; `--dry-run` reports.
 */
import { Client } from 'pg';
import { LEGACY_ROLE_MAP, PLATFORM_ROLES, SYSTEM_ROLES, resolvePlatformRolePermissions, resolveRolePermissions } from '@b2b/contracts';
import { uuidv7 } from '@b2b/platform-kit';

export interface BootstrapMigrationReport {
  dryRun: boolean;
  tenantMemberships: { source: number; migrated: number; skipped: number };
  platformStaff: { source: number; migrated: number; skipped: number };
  warnings: string[];
}

const strip = (u: string) => u.replace('?schema=public', '');

async function ensureRole(iam: Client, tenantId: string | null, key: string, name: string, rank: number, description: string, codes: string[]): Promise<string> {
  const existing = tenantId ? await iam.query('SELECT id FROM roles WHERE tenant_id = $1 AND key = $2', [tenantId, key]) : await iam.query('SELECT id FROM roles WHERE tenant_id IS NULL AND key = $1', [key]);
  let id = existing.rows[0]?.id as string | undefined;
  if (!id) {
    id = uuidv7();
    await iam.query('INSERT INTO roles (id, tenant_id, key, name, description, is_system, rank, created_at, updated_at, version) VALUES ($1, $2, $3, $4, $5, true, $6, now(), now(), 0)', [id, tenantId, key, name, description, rank]);
  }
  for (const code of codes) await iam.query('INSERT INTO role_permissions (role_id, permission_code, tenant_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [id, code, tenantId]);
  return id;
}

export async function migrateBootstrapToIam(urls: { auth: string; iam: string }, opts: { dryRun?: boolean } = {}): Promise<BootstrapMigrationReport> {
  const dryRun = opts.dryRun ?? false;
  const auth = new Client({ connectionString: strip(urls.auth) });
  const iam = new Client({ connectionString: strip(urls.iam) });
  await Promise.all([auth.connect(), iam.connect()]);
  const report: BootstrapMigrationReport = { dryRun, tenantMemberships: { source: 0, migrated: 0, skipped: 0 }, platformStaff: { source: 0, migrated: 0, skipped: 0 }, warnings: [] };
  try {
    await iam.query(`SELECT set_config('app.platform', 'true', false)`);
    const memberships = (await auth.query(`SELECT b.id, b.tenant_id, b.user_id, b.role, b.status, b.created_at, u.email, u.full_name FROM tenant_memberships_bootstrap b JOIN users u ON u.id = b.user_id ORDER BY b.created_at`)).rows as { id: string; tenant_id: string; user_id: string; role: string; status: string; created_at: Date; email: string; full_name: string }[];
    const staff = (await auth.query(`SELECT a.user_id, a.role, u.email, u.full_name FROM platform_role_assignments a JOIN users u ON u.id = a.user_id ORDER BY u.created_at`)).rows as { user_id: string; role: string; email: string; full_name: string }[];
    report.tenantMemberships.source = memberships.length;
    report.platformStaff.source = staff.length;
    if (dryRun) return report;

    await iam.query('BEGIN');
    const roleCache = new Map<string, Map<string, string>>();
    for (const m of memberships) {
      if (!roleCache.has(m.tenant_id)) {
        const ids = new Map<string, string>();
        for (const def of SYSTEM_ROLES) ids.set(def.key, await ensureRole(iam, m.tenant_id, def.key, def.name, def.rank, def.description, resolveRolePermissions(def)));
        roleCache.set(m.tenant_id, ids);
      }
      const exists = await iam.query('SELECT id FROM memberships WHERE tenant_id = $1 AND user_id = $2', [m.tenant_id, m.user_id]);
      if (exists.rowCount) {
        report.tenantMemberships.skipped += 1;
        continue;
      }
      const roleKey = LEGACY_ROLE_MAP[m.role] ?? m.role;
      const roleId = roleCache.get(m.tenant_id)!.get(roleKey);
      if (!roleId) {
        report.warnings.push(`membership ${m.id}: unknown role ${m.role}; assigned VIEWER`);
      }
      await iam.query(`INSERT INTO memberships (id, tenant_id, user_id, email, full_name, status, permission_version, all_warehouses, joined_at, created_at, updated_at, version) VALUES ($1, $2, $3, $4, $5, $6, 1, true, $7, $7, now(), 0)`, [m.id, m.tenant_id, m.user_id, m.email.toLowerCase(), m.full_name, m.status === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED', m.created_at]);
      await iam.query(`INSERT INTO membership_roles (membership_id, role_id, tenant_id, assigned_by) VALUES ($1, $2, $3, NULL)`, [m.id, roleId ?? roleCache.get(m.tenant_id)!.get('VIEWER'), m.tenant_id]);
      report.tenantMemberships.migrated += 1;
    }

    const platformRoleIds = new Map<string, string>();
    for (const def of PLATFORM_ROLES) platformRoleIds.set(def.key, await ensureRole(iam, null, def.key, def.name, def.rank, def.description, resolvePlatformRolePermissions(def)));
    const byUser = new Map<string, typeof staff>();
    for (const s of staff) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);
    for (const [userId, rows] of byUser) {
      const exists = await iam.query('SELECT id FROM memberships WHERE tenant_id IS NULL AND user_id = $1', [userId]);
      if (exists.rowCount) {
        report.platformStaff.skipped += rows.length;
        continue;
      }
      const id = uuidv7();
      await iam.query(`INSERT INTO memberships (id, tenant_id, user_id, email, full_name, status, permission_version, all_warehouses, joined_at, created_at, updated_at, version) VALUES ($1, NULL, $2, $3, $4, 'ACTIVE', 1, true, now(), now(), now(), 0)`, [id, userId, rows[0].email.toLowerCase(), rows[0].full_name]);
      for (const r of rows) {
        const roleId = platformRoleIds.get(r.role);
        if (!roleId) {
          report.warnings.push(`platform assignment ${userId}/${r.role}: unknown role`);
          continue;
        }
        await iam.query(`INSERT INTO membership_roles (membership_id, role_id, tenant_id, assigned_by) VALUES ($1, $2, NULL, NULL) ON CONFLICT DO NOTHING`, [id, roleId]);
      }
      report.platformStaff.migrated += rows.length;
    }

    const migratedCount = Number((await iam.query('SELECT count(*) FROM memberships WHERE id = ANY($1::uuid[])', [memberships.map((m) => m.id)])).rows[0].count);
    if (migratedCount !== memberships.length) {
      await iam.query('ROLLBACK');
      throw new Error(`reconciliation failed: ${migratedCount}/${memberships.length} tenant memberships present`);
    }
    await iam.query('COMMIT');
    return report;
  } catch (err) {
    await iam.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await Promise.all([auth.end(), iam.end()]);
  }
}

if (process.argv[1] && /migrate-bootstrap\.ts$/.test(process.argv[1])) {
  migrateBootstrapToIam(
    {
      auth: process.env.AUTH_DATABASE_URL ?? 'postgresql://auth_migrator:b2b_dev@localhost:5435/auth_db?schema=public',
      iam: process.env.IAM_DATABASE_URL ?? 'postgresql://iam_migrator:b2b_dev@localhost:5435/iam_db?schema=public',
    },
    { dryRun: process.argv.includes('--dry-run') },
  )
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
