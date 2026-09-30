/**
 * Database access contract for the kit. The kit never imports a service's generated Prisma client;
 * it only needs raw SQL on a client or a transaction. Any Prisma client satisfies these interfaces.
 */
export interface SqlClient {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

export interface TransactionOptions {
  maxWait?: number;
  timeout?: number;
}

export interface TransactionalClient extends SqlClient {
  $transaction<R>(fn: (tx: SqlClient) => Promise<R>, options?: TransactionOptions): Promise<R>;
}

/**
 * Interactive transactions that take row locks (state machines, ledger postings). Under contention
 * many requests queue on the same lock; Prisma's defaults (2 s to start, 5 s to run) fail spuriously.
 */
export const LOCKING_TX_OPTIONS: TransactionOptions = { maxWait: 15_000, timeout: 30_000 };

/** Casts any Prisma client to the kit's transactional contract (structural, no runtime effect). */
export function asKitClient(client: unknown): TransactionalClient {
  return client as TransactionalClient;
}

/**
 * Row-Level Security context (ADR-0005). Every tenant transaction starts with
 * `SET LOCAL app.tenant_id`, so the policies `tenant_id = current_setting('app.tenant_id')::uuid`
 * see the caller's tenant. Platform code paths set `app.platform = 'true'` instead.
 * Both settings are transaction-local and vanish at COMMIT/ROLLBACK.
 */
export async function setTenantContext(tx: SqlClient, tenantId: string | null): Promise<void> {
  if (tenantId) {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true), set_config('app.platform', 'false', true)`;
  } else {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', '', true), set_config('app.platform', 'true', true)`;
  }
}

export interface TenantTxOptions extends TransactionOptions {}

/** Runs `fn` in a transaction scoped to one tenant (RLS context set first). */
export function withTenantTx<T, C extends SqlClient>(
  client: TransactionalClient & { $transaction<R>(fn: (tx: C) => Promise<R>, options?: TransactionOptions): Promise<R> },
  tenantId: string,
  fn: (tx: C) => Promise<T>,
  options: TenantTxOptions = LOCKING_TX_OPTIONS,
): Promise<T> {
  return client.$transaction(async (tx: C) => {
    await setTenantContext(tx, tenantId);
    return fn(tx);
  }, options);
}

/** Runs `fn` in a transaction with the platform (cross-tenant) RLS context. */
export function withPlatformTx<T, C extends SqlClient>(
  client: TransactionalClient & { $transaction<R>(fn: (tx: C) => Promise<R>, options?: TransactionOptions): Promise<R> },
  fn: (tx: C) => Promise<T>,
  options: TenantTxOptions = LOCKING_TX_OPTIONS,
): Promise<T> {
  return client.$transaction(async (tx: C) => {
    await setTenantContext(tx, null);
    return fn(tx);
  }, options);
}

/**
 * SQL that enables RLS for a tenant-owned table. Used by hand-written migrations so every service
 * applies the identical policy. `FORCE` makes the policy apply to the table owner too.
 */
export function rlsPolicySql(table: string, column = 'tenant_id'): string {
  return [
    `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`,
    `DROP POLICY IF EXISTS tenant_isolation ON "${table}";`,
    // nullif(...)::uuid: an unset or empty setting becomes NULL (never a cast error), and
    // "col = NULL" is false, so a request without tenant context sees nothing.
    `CREATE POLICY tenant_isolation ON "${table}"`,
    `  USING (`,
    `    current_setting('app.platform', true) = 'true'`,
    `    OR "${column}" = nullif(current_setting('app.tenant_id', true), '')::uuid`,
    `  )`,
    `  WITH CHECK (`,
    `    current_setting('app.platform', true) = 'true'`,
    `    OR "${column}" = nullif(current_setting('app.tenant_id', true), '')::uuid`,
    `  );`,
  ].join('\n');
}
