/**
 * Prepares one test database per service on the shared test Postgres (default :5433, superuser
 * `postgres`): creates `<key>_test` + a NOBYPASSRLS runtime role, applies the service's Prisma
 * migrations as admin, then grants DML to the runtime role. Idempotent.
 *
 *   npm run test:setup            # api + every service
 *   npx tsx scripts/test-db-setup.mts auth tenant
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ADMIN_URL, dropTestDatabase, ensureTestDatabase, grantRuntimeRole } from '@b2b/test-kit';

export const SERVICES: { key: string; dir: string }[] = [
  { key: 'auth', dir: 'apps/svc-auth' },
  { key: 'tenant', dir: 'apps/svc-tenant' },
  { key: 'audit', dir: 'apps/svc-audit' },
  { key: 'notification', dir: 'apps/svc-notification' },
  { key: 'iam', dir: 'apps/svc-iam' },
  { key: 'master', dir: 'apps/svc-master' },
  { key: 'party', dir: 'apps/svc-party' },
  { key: 'inventory', dir: 'apps/svc-inventory' },
  { key: 'procurement', dir: 'apps/svc-procurement' },
  { key: 'qc', dir: 'apps/svc-qc' },
];

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const only = args.filter((a) => !a.startsWith('--'));
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

for (const svc of SERVICES) {
  if (only.length && !only.includes(svc.key)) continue;
  const dir = path.join(root, svc.dir);
  try {
    execSync('node -e "process.exit(0)"', { cwd: dir, stdio: 'ignore' });
  } catch {
    console.log(`skip ${svc.key}: ${svc.dir} not present`);
    continue;
  }
  if (reset) {
    await dropTestDatabase(svc.key, DEFAULT_ADMIN_URL);
    console.log(`[${svc.key}] dropped`);
  }
  const urls = await ensureTestDatabase(svc.key, DEFAULT_ADMIN_URL);
  console.log(`[${svc.key}] database ready -> ${urls.migrateUrl.replace(/:[^:@/]+@/, ':***@')}`);
  execSync('npx prisma generate', { cwd: dir, stdio: 'inherit', env: { ...process.env, DATABASE_URL: urls.migrateUrl, MIGRATE_DATABASE_URL: urls.migrateUrl } });
  execSync('npx prisma migrate deploy', { cwd: dir, stdio: 'inherit', env: { ...process.env, DATABASE_URL: urls.migrateUrl, MIGRATE_DATABASE_URL: urls.migrateUrl } });
  await grantRuntimeRole(svc.key, DEFAULT_ADMIN_URL);
  console.log(`[${svc.key}] migrated and granted`);
}
