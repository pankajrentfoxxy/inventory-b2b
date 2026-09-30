# ADR-0001: Microservices with database-per-service on a shared PostgreSQL cluster

- Status: Accepted (Phase 0, 2026-09-30)
- Deciders: Rentfoxxy engineering
- Related: phase-plan/README.md sections 2-4, ADR-0005, ADR-0010

## Context

The current application is one Express + Prisma process on one PostgreSQL database with
`organization_id` on every business table (see docs/phase-0/current-architecture.md). The target
platform (phase-plan/README.md section 3) is a set of services, each the single owner of its data.
The team is small and runs on one VPS, so every extra database server or cluster is real operating
cost.

## Decision

- One PostgreSQL 16 cluster, **one database and one pair of roles per service**: `<svc>_db`,
  `<svc>_migrator` (owns the schema, runs migrations) and `<svc>_role` (runtime, DML only, not a
  superuser, `NOBYPASSRLS`). `infra/postgres/init/00-create-dbs.sh` provisions them and revokes
  every role's access to every other service's database.
- Services never read another service's tables. Cross-service data is obtained through the owning
  service's API (sync) or its events (async), and business documents snapshot what they need
  (README 5.4).
- The legacy application keeps its own database (`legacy_db` in the new cluster, or the existing
  `b2b_inventory` database until it is moved) and shrinks one module at a time (ADR-0010).
- Co-hosting two services in one Node process is the approved fallback for operational load. It
  keeps separate modules, roles and databases; schemas are never merged.

## Consequences

- No cross-service joins and no cross-service foreign keys. Referential integrity across services
  becomes an application concern (id + snapshot).
- Backfills during extraction copy data between databases with verification counts (ADR-0010).
- Operating one cluster keeps backups, monitoring and upgrades simple; a noisy service can still
  starve the others of connections, so per-service connection limits are set at the role level
  before production (Phase 12).
