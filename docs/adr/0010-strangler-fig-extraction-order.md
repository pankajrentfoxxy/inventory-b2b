# ADR-0010: Strangler-fig extraction order for the legacy application

- Status: Accepted (Phase 0, 2026-09-30)
- Related: phase-plan/README.md section 8, docs/phase-0/current-architecture.md (mapping tables)

## Context

The existing application (`apps/api`, `apps/web`) works and is in use for suppliers, items,
purchase orders and goods receipts. A rewrite that stops feature delivery for months is not
acceptable; neither is running two systems of record for the same data.

## Decision

Extract one module at a time behind the gateway, in this order, and never add a new business
feature to the legacy code after Phase 0 (the race-condition fixes are the last legacy change):

| Order | Legacy module | Target service | Phase |
|---|---|---|---|
| 1 | Authentication | svc-auth | 1 |
| 2 | Organization (tenant) + memberships | svc-tenant + svc-iam | 1-2 |
| 3 | Items, settings / master data | svc-master | 3 |
| 4 | Suppliers (`Vendor` model) | svc-party | 3 |
| 5 | Purchase orders, purchase receives (GRN) | svc-procurement | 5 |

Each extraction follows the same five steps: (1) build the new service behind the gateway,
(2) one-time backfill from the legacy database with verification counts and checksums,
(3) switch the gateway route (one prefix in `apps/gateway/src/routes.ts`), (4) make the legacy
tables read-only by revoking write grants, (5) delete the legacy code one phase later.

Phase 0 puts the gateway in front with **zero behaviour change**: `/api/v1/*` and `/api/*` both
reach the legacy API, `/api/v1/platform/*` exists in the table but is disabled until Phase 1.

## Consequences

- During a transition window the gateway routes some prefixes to a new service and the rest to
  legacy; the frontend never needs to know.
- Backfills are the riskiest step; each one gets a rehearsal on a production copy and a documented
  rollback (switch the route back, legacy tables are still intact until step 5).
- Terminology: the platform tenant is `Organization` in the legacy code and `tenant` in the new
  services; the supplier is `Vendor` in legacy and `supplier` in `svc-party`. Mapping tables in
  docs/phase-0/current-architecture.md are the single source for these names.
