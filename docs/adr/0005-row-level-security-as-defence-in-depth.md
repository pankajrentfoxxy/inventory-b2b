# ADR-0005: PostgreSQL Row-Level Security as a second net for tenant isolation

- Status: Accepted for every new service database (Phase 1 onward); not applied to the legacy database in Phase 0
- Related: phase-plan/README.md 5.2, ADR-0001

## Context

Tenant scoping is enforced in application code today: every repository query filters on
`organizationId` and lookups go through `find...OrThrow` helpers that return 404 for another
tenant's ids. One forgotten `where` clause is a data leak. The audit found none, but the guarantee
should not depend on review alone.

## Decision

- Every tenant-owned table in a service database has `tenant_id uuid NOT NULL` as the first column
  of every index and unique constraint, `ENABLE ROW LEVEL SECURITY`, and a policy
  `USING (tenant_id = current_setting('app.tenant_id')::uuid)`.
- The platform kit's database module runs `SET LOCAL app.tenant_id = $1` at the start of every
  transaction from the request's `TenantContext`. The runtime role is `NOBYPASSRLS` (ADR-0001), so
  a query without the setting returns nothing rather than everything.
- Application-level scoping stays: repository methods always take `tenantId`; RLS is the net under
  the net, not a replacement. Misses still return 404, never 403.
- **Legacy database, Phase 0:** RLS is *not* enabled. Doing so requires every legacy transaction
  to set `app.tenant_id`, which touches every module in a phase whose rule is "no change except
  the race fixes". The legacy database is protected by the existing application scoping plus the
  new cross-tenant test sweep (`purchases.concurrency.test.ts`, "tenant isolation sweep"). Legacy
  tables gain RLS as they are extracted into service databases.

## Consequences

- Platform (cross-tenant) operations need a separate role or an explicit `BYPASSRLS` path that
  is never used by tenant request handlers.
- Migrations must add the policy for every new tenant-owned table; a test in `test-kit` fails
  when a table with `tenant_id` has no policy.
- Slight per-query overhead from the policy predicate; the `tenant_id`-first indexes keep it cheap.
