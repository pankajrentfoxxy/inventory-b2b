/**
 * Per-service test databases. A superuser admin URL creates `<svc>_test` databases and a
 * NOBYPASSRLS runtime role, so tests exercise Row-Level Security for real. Migrations run with the
 * admin URL (the migrator), the service under test connects as the runtime role.
 */
import { Client } from 'pg';

export interface TestDbSpec {
  service: string;
  /** e.g. 'auth' -> database auth_test, role auth_role. */
  key: string;
}

export interface TestDbUrls {
  databaseUrl: string;
  migrateUrl: string;
}

export const DEFAULT_ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? 'postgresql://postgres:password123@localhost:5433/postgres';
export const TEST_ROLE_PASSWORD = 'b2b_test';

function rewriteUrl(adminUrl: string, database: string, user?: string, password?: string): string {
  const u = new URL(adminUrl);
  u.pathname = `/${database}`;
  if (user) {
    u.username = user;
    u.password = password ?? '';
  }
  u.searchParams.set('schema', 'public');
  return u.toString();
}

export function testDbUrls(key: string, adminUrl = DEFAULT_ADMIN_URL): TestDbUrls {
  return {
    databaseUrl: rewriteUrl(adminUrl, `${key}_test`, `${key}_role`, TEST_ROLE_PASSWORD),
    migrateUrl: rewriteUrl(adminUrl, `${key}_test`),
  };
}

/** Creates the database and runtime role if missing (idempotent). Returns the urls. */
export async function ensureTestDatabase(key: string, adminUrl = DEFAULT_ADMIN_URL): Promise<TestDbUrls> {
  const admin = new Client({ connectionString: adminUrl.replace('?schema=public', '') });
  await admin.connect();
  const role = `${key}_role`;
  const db = `${key}_test`;
  try {
    const roleExists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
    if (roleExists.rowCount === 0) {
      await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${TEST_ROLE_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    } else {
      await admin.query(`ALTER ROLE "${role}" WITH PASSWORD '${TEST_ROLE_PASSWORD}' NOBYPASSRLS`);
    }
    const dbExists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [db]);
    if (dbExists.rowCount === 0) await admin.query(`CREATE DATABASE "${db}" ENCODING 'UTF8' TEMPLATE template0`);
    await admin.query(`GRANT CONNECT ON DATABASE "${db}" TO "${role}"`);
  } finally {
    await admin.end();
  }
  return testDbUrls(key, adminUrl);
}

/** Drops the test database (used with `--reset` when a migration file changed before release). */
export async function dropTestDatabase(key: string, adminUrl = DEFAULT_ADMIN_URL): Promise<void> {
  const admin = new Client({ connectionString: adminUrl.replace('?schema=public', '') });
  await admin.connect();
  try {
    await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [`${key}_test`]);
    await admin.query(`DROP DATABASE IF EXISTS "${key}_test"`);
  } finally {
    await admin.end();
  }
}

/** After migrations: DML grants for the runtime role on every table and sequence (idempotent). */
export async function grantRuntimeRole(key: string, adminUrl = DEFAULT_ADMIN_URL): Promise<void> {
  const urls = testDbUrls(key, adminUrl);
  const client = new Client({ connectionString: urls.migrateUrl.replace('?schema=public', '') });
  await client.connect();
  const role = `${key}_role`;
  try {
    await client.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${role}"`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}"`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${role}"`);
    // Append-only ledger tables (Phase 4): revoke UPDATE/DELETE where the migration marked them.
    const appendOnly = await client.query(`SELECT c.relname FROM pg_class c JOIN pg_description d ON d.objoid = c.oid WHERE d.description = 'append-only'`);
    for (const row of appendOnly.rows as { relname: string }[]) {
      await client.query(`REVOKE UPDATE, DELETE ON "${row.relname}" FROM "${role}"`);
    }
  } finally {
    await client.end();
  }
}

/** Truncates every public table except Prisma's migration table (fast reset between test files). */
export async function truncateAll(adminDbUrl: string, except: string[] = []): Promise<void> {
  const client = new Client({ connectionString: adminDbUrl.replace('?schema=public', '') });
  await client.connect();
  try {
    const tables = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
    const names = (tables.rows as { tablename: string }[]).map((r) => `"${r.tablename}"`).filter((n) => !except.includes(n.replace(/"/g, '')));
    if (names.length) await client.query(`TRUNCATE TABLE ${names.join(', ')} RESTART IDENTITY CASCADE`);
  } finally {
    await client.end();
  }
}

/** Runs raw SQL as admin (for asserting table contents without RLS in tests). */
export async function adminQuery<T = Record<string, unknown>>(adminDbUrl: string, sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: adminDbUrl.replace('?schema=public', '') });
  await client.connect();
  try {
    const res = await client.query(sql, params);
    return res.rows as T[];
  } finally {
    await client.end();
  }
}
