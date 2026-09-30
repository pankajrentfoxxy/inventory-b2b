# B2B Inventory - project rules

Multi-tenant B2B inventory app for Rentfoxxy. npm workspaces: `apps/api` (Express + Prisma +
PostgreSQL; the "legacy API" in the phase plan), `apps/gateway` (Express edge: correlation ids,
header stripping, token check, routing table), `apps/web` (Vite + React + Tailwind),
`packages/shared` (zod schemas, validators, permission catalogue, PO arithmetic). Module roadmap:
Vendors (done) -> Items (done, minimal) -> Purchase Orders (done) -> GRN / Purchase Receives (done)
-> QC -> Stock -> Transfers -> Sales Orders -> Dispatch -> Invoices/GST -> Payments -> Reports.
See `docs/VENDOR_MODULE.md` and `docs/PURCHASING_MODULE.md`.

**Platform migration:** `phase-plan/` is the 13-phase plan (README = architecture contract, one
phase per session, design first, approval before implementation). Phases 0-5 are implemented
(backend, tests and web UI; see `docs/phase-ui/verification.md`): `apps/svc-auth`, `svc-tenant`, `svc-audit`,
`svc-notification`, `svc-iam`, `svc-master`, `svc-party`, `svc-inventory`, `svc-procurement`,
`svc-qc`, each an Express service on `packages/platform-kit` (RLS tenant context, outbox/inbox,
idempotency, RS256 auth, consumers) with its own Prisma schema and database. Cross-service
contracts (events, permissions, error codes) live in `packages/contracts`. Status, ADRs and
verification: `docs/phase-N/verification.md`, `docs/adr/`. Terminology: the plan's "tenant" is
`Organization` in the legacy code and `tenantId` in services; the plan's "supplier" is `Vendor`
in legacy code and a `SUPPLIER` party in `svc-party`.

**Laptop-only catalogue (2026-09-30):** products are laptop configurations identified by exactly eight
spec masters (Brand, Model->Brand, Generation, Processor, RAM, SSD, GPU, Screen size) in svc-master
`laptop_spec_options`; `POST /master/laptops` generates the SKU, refuses duplicate configurations and
makes every laptop serialized + QC-required; specs travel on the product snapshot (`specs`) into PO,
GRN, QC lot and inventory `item_refs`. Laptop QC lots require a per-serial `laptop` check (8 spec
matches, powers on, missing parts, asset tag) with PASS / FAIL / HOLD; PASS only if everything matches,
HOLD blocks the decision. Rules for the client: `docs/BUSINESS_LOGIC.md`. Do not add generic product
categories back.

Service rules (in addition to the non-negotiables below): every tenant table has `tenant_id` +
RLS policy and every transaction starts with `setTenantContext`; stock moves only through
svc-inventory's posting engine (zero-sum postings, idempotency key per document); document numbers
via `nextDocumentNumber` in the owning service; snapshots (supplier / item / warehouse) are taken
at document time; consumers verify the envelope tenant; business failures inside consumers become
events (savepoint), infrastructure failures retry.

## Commands

```bash
npm run dev                # alias of dev:platform (the web app signs in through svc-auth); dev:legacy = api :4000 + web only
npm run dev:all            # api + gateway :4010 + web proxied through the gateway
npm run dev:platform       # api + every service (4101-4110) + gateway + web
npm run test:setup         # legacy test db + one <service>_test db per service (scripts/test-db-setup.mts, --reset after migration edits)
npm run test:services      # all service suites (serial); npm test = api + gateway + services
npm run typecheck          # shared, api, gateway, web
npm test                   # API integration tests (b2b_inventory_test; run test:setup once) + gateway tests
npm run db:migrate:dev -w @b2b/api -- --name <change>   # new migration
npm run db:seed            # demo orgs/users only, never vendors
npm run infra:up           # infra/docker-compose.yml: postgres, rabbitmq, redis, minio
```

## Non-negotiables

- **Tenant scoping at the data layer.** Every business table has `organization_id`. Every query
  filters on `ctx.organizationId`; lookups go through `findLiveVendorOrThrow`-style helpers.
  A record from another tenant returns 404, never 403 (do not confirm existence).
- **Backend authorization is the truth.** Routes: `requireAuth` -> `requireOrganization` ->
  `requirePermission(code)`. UI gating (`usePermission`, `PermissionGate`) is a convenience only.
  New permissions go in `packages/shared/src/permissions.ts`; the seed / register flow syncs them.
- **Validation lives in `packages/shared`** (zod). Schemas compose the builders in
  `packages/shared/src/validation/fields.ts` (`mobileField`, `gstinField`, `amountField`, ...);
  regexes live only in `validators.ts`, messages only in `validation/messages.ts`. API validates
  with `validateBody` / `validateQuery` / `validateParams`; the web form uses the same schema
  through `zodResolver`, gives inputs a `sanitize` kind, and maps API errors with
  `applyServerErrors`. Never write a regex or a validation message in app code. See `docs/VALIDATION.md`.
- **Error envelope is fixed**: `{ success: false, message, error: { code, message, details }, errors }`
  built by `errorBody` in `apps/api/src/lib/errors.ts`. Never `res.json({ error: ... })` by hand.
- **Soft delete.** Vendors get `deleted_at`; never hard-delete business records.
- **Audit every write** to a vendor through `recordActivity`. Never put full bank account numbers,
  passwords or tokens in audit rows (`bankAccountSnapshot` masks).
- **Masters over hardcoding.** GST treatment, source of supply, payment terms, custom fields and
  reporting tags are organization-scoped tables provisioned in `organization.service.ts`.
- **Transactions reference `vendor_id`**; never copy vendor fields into PO/GRN/bill rows. PO lines
  snapshot item name / HSN / tax rate at order time (documents must not change retroactively).
- **Money math lives in `packages/shared/src/purchase.math.ts`.** The API persists the result;
  the web form only previews with the same function. Never reimplement totals in a component.
- **Document numbers come from `documentNumber.service.ts`** (row lock inside the create
  transaction). Never accept a number from the client without `claimManualDocumentNumber`.
- **Status transitions go through the service functions** (`issue/cancel/close/reopen`,
  `recomputeReceiveStatus`). Never `update({ status })` from a route.
- **Lock, then check, then write.** Any write that depends on a PO's status or quantities starts
  with `lockPurchaseOrder` (and `lockPurchaseOrderLines`) inside `prisma.$transaction(..., LOCKING_TX_OPTIONS)`
  and re-checks inside the lock. Every PO write bumps `version`; transitions are conditional
  `updateMany({ where: { status, version } })` with `count !== 1` -> 409 `PO_VERSION_CONFLICT`.
- **Idempotency-Key on creating POSTs that must never double-apply** (`idempotent(scope)` after
  `validateBody`; GRN create today, SO confirm / dispatch / payments later). Store the key on the
  created row with a unique index as the natural guard.
- **Outbox, never direct publish.** Audited writes go through `recordPoActivity` /
  `recordAuditEvent`, which insert an `audit.recorded.v1` envelope into `outbox_events` in the same
  transaction. Only the relay (`lib/outbox.ts`) talks to the broker. Consumers dedupe with `processOnce`.
- **Identity never comes from headers.** `x-tenant-id` and friends are stripped at the gateway and
  the API; `req.correlationId` flows into `ctx.correlationId`, audit events and every error envelope.
- **Route params that are ids are UUIDs or 404** (`requireUuidParams(router, 'id')`).
- Test files reset the same database, so the runner is serial (`--test-concurrency=1`). Keep it.
- Use the primitives in `apps/web/src/components/ui`. Do not add a second table, modal or button.
- All UI states are required: loading (skeleton), empty, error (with retry), success (toast).
- ASCII only in source files (the Windows shell mangles heredocs with non-ASCII characters).

## Adding the next module

1. Prisma models with `organization_id` + indexes; migration via `prisma migrate dev`.
2. `apps/api/src/modules/<name>/` with `*.routes.ts`, `*.service.ts`, `*.repository.ts`; mount in `app.ts`.
3. Permissions in shared `PERMISSIONS` + `DEFAULT_ROLES`.
4. Web feature folder mirroring `features/vendors` (api.ts, hooks.ts, types.ts, pages/, components/).
5. Integration tests in `apps/api/test` covering RBAC and cross-tenant access.
