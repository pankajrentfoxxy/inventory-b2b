# Phase 0 - Current architecture and current-to-target mapping

Answers the Step 1 checklist and fills the Step 2 templates of
`phase-plan/phase-00-architecture-foundation.md`. Facts were taken from the code on branch
`phase-0-foundation` (2026-09-30), not assumed. The wider findings list is in
`docs/SYSTEM_AUDIT.md` (2026-09-29); this document only records what Phase 0 needs.

## 1. Code and runtime

| Item | Finding |
|---|---|
| Language / runtime | TypeScript 5.9, Node >= 22 (`engines`), Node 24.18 on the development machines |
| Backend framework | Express 4.21, `routes -> service -> repository` per module, `asyncHandler` wrappers |
| ORM / migrations | Prisma 6.16 with hand-edited SQL migrations (`apps/api/prisma/migrations`, 4 after Phase 0); 36 models |
| Database | PostgreSQL 16 (shared dev container `laptop-erp-postgres:5433`, databases `b2b_inventory`, `b2b_inventory_test`) |
| Package manager / build | npm 11 workspaces; `tsup` bundles the API, Vite 6 builds the web app, `tsx` for dev |
| Frontend | React 18, Vite, TanStack Query 5, react-hook-form + zod, Tailwind, react-router 6 |
| Shared code | `packages/shared`: zod schemas, validators, messages, permission catalogue, PO arithmetic (about 2,150 lines) |
| Tests | `node --test` + supertest against a real database, serial runner; **87 tests before Phase 0, 120 API + 13 gateway after** |
| File uploads | Local disk (`UPLOAD_DIR`, multer memory storage then `fs.writeFile`); PO documents only. Target: S3/MinIO pre-signed URLs (README 5.11) |
| Background jobs | None before Phase 0. Phase 0 adds the in-process outbox relay |
| Third-party | GST lookup through a Zoho browser session cookie held in the server environment (`GST_PROVIDER=zoho-session`); flagged in the audit, untouched in Phase 0 |

### Modules (lines of TypeScript, `apps/api/src/modules/*`)

| Module | Lines | Notes |
|---|---|---|
| auth | 109 | register (creates tenant + owner), login, `me`; bcryptjs cost 10; HS256 JWT, 12 h, no refresh / revocation |
| organizations | 302 | current org, members, roles, master provisioning, permission sync |
| vendors (suppliers) | 1,752 | complete aggregate: contacts, addresses, bank accounts (encrypted), notes, documents, custom fields, tags, activity |
| items | 184 | minimal item master |
| settings | 483 | locations, taxes, GST treatments, payment terms, custom fields, reporting tags, document sequences |
| purchases | 1,477 | PO, PO documents, GRN, numbering, activity; rewritten around row locks in Phase 0 |
| integrations | 250 | GST lookup |
| health | 61 | new in Phase 0 |
| lib + middleware + config | 1,154 | errors, http helpers, prisma, crypto, upload, logger, auth, correlation, idempotency, outbox, inbox, audit |

### Authentication and tenant resolution (today)

- `Authorization: Bearer <HS256 JWT>` signed with `JWT_SECRET`; subject = user id.
- Tenant is selected by the `X-Organization-Id` header. `requireOrganization` loads the membership,
  role and permissions **from the database on every request** and rejects non-members with 403
  `ORGANIZATION_ACCESS_DENIED` (same answer whether the organization exists or not).
- `requirePermission(code)` is a Set lookup on the loaded permissions. UI gating is convenience only.
- The header is a *selector*, not identity: a user can only select an organization they are an
  active member of. `tenant_id` / `user_id` / `permissions` are never read from bodies, queries or
  other headers (verified by grep; Phase 0 additionally strips `x-tenant-id`, `x-user-id`,
  `x-perms`, `x-membership-id`, `x-on-behalf-of-tenant` at the gateway and the API).

### Where `organization_id` is applied

Every business query filters on `organizationId` from the request context, either directly in the
`where` or through `find...OrThrow` helpers (`findLiveVendorOrThrow`, `findLivePoOrThrow`,
`findReceiveOrThrow`) that return 404 for a miss. A grep of every `findMany` / `findFirst` /
`findUnique` without an organization filter finds only: user / permission / currency / role
lookups (global tables), `organization.findUnique({ slug })` at registration, and queries already
inside a tenant-scoped transaction (`purchaseReceiveLine.findMany({ purchaseReceiveId })` after the
receive row was locked with its organization). No missing filter was found. Phase 0 adds an
automated cross-tenant sweep over every purchasing route (all 404).

## 2. Data

### Tables and target ownership

| Legacy table(s) | Tenant key | Target database | Notes |
|---|---|---|---|
| `users` | none (global identity) | `auth_db` (credentials) + `iam_db` (memberships) | password hashes are bcrypt and can be migrated as-is |
| `organizations` | is the tenant | `tenant_db` | gains lifecycle status / approval in Phase 1 |
| `organization_members`, `roles`, `role_permissions`, `permissions` | yes / global | `iam_db` | |
| `gst_treatments`, `sources_of_supply`, `payment_terms`, `custom_field_definitions`, `reporting_tags`, `reporting_tag_options`, `currencies` | yes (currencies global) | `master_db` | |
| `vendors`, `vendor_contacts`, `vendor_addresses`, `vendor_bank_accounts`, `vendor_notes`, `vendor_documents`, `vendor_custom_field_values`, `vendor_reporting_tags`, `vendor_activities` | yes | `party_db` (suppliers) | activity rows -> `audit_db` |
| `locations`, `taxes`, `items`, `document_sequences` | yes | `master_db` | `locations` become warehouses; `document_sequences` -> `number_series` |
| `purchase_orders`, `purchase_order_lines`, `purchase_order_custom_field_values`, `purchase_order_documents`, `purchase_order_activities` | yes | `procurement_db` | activity rows -> `audit_db` |
| `purchase_receives`, `purchase_receive_lines` | yes | `procurement_db` | |
| `idempotency_keys`, `outbox_events`, `processed_events` (new) | `tenant_id` (no FK) | every service database | standard platform tables |

All tenant-owned tables have `organization_id uuid NOT NULL` with an index whose first column is
`organization_id` (Prisma `@@index([organizationId, ...])`). Unique constraints are
organization-first (`(organization_id, name)`, `(organization_id, lower(po_number)) WHERE deleted_at IS NULL`,
`(organization_id, lower(receive_number))`, `(organization_id, idempotency_key)`).

### PO / GRN quantities and status

- `purchase_order_lines.quantity numeric(18,3)`, `received_quantity numeric(18,3)` maintained by
  increment / decrement on GRN create / cancel. Phase 0 adds
  `CHECK (received_quantity >= 0 AND received_quantity <= quantity)` and conditional updates.
- `purchase_orders.status` enum `DRAFT | ISSUED | PARTIALLY_RECEIVED | RECEIVED | CLOSED | CANCELLED`,
  re-derived from line quantities by `recomputeReceiveStatus` inside the same transaction.
  Phase 0 adds `version int` (optimistic concurrency).
- `purchase_receives.status` enum `RECEIVED | CANCELLED`; cancelled receives are kept.

### Number generation

`document_sequences (organization_id, doc_type, prefix, next_number, padding)` locked `FOR UPDATE`
inside the create transaction; manually typed numbers are checked for uniqueness in the same
transaction and move the sequence past them. Verified gap-free under 50 concurrent creates
(ADR-0009).

### Foreign keys that will cross service boundaries

`purchase_orders.vendor_id -> vendors`, `purchase_orders.location_id / delivery_location_id -> locations`,
`purchase_orders.payment_term_id -> payment_terms`, `purchase_order_lines.item_id -> items`,
`purchase_order_lines.tax_id -> taxes`, `purchase_receives.vendor_id / location_id`,
`purchase_receive_lines.item_id`, `*_custom_field_values.field_id -> custom_field_definitions`.
The PO already snapshots item name / SKU / HSN / tax rate and the delivery address; the supplier
name, GSTIN and billing address are still joined live and become snapshots at extraction (README 5.4).

## 3. Procurement race-condition audit (Step 1 table, completed)

| # | Race | Reproduction (automated in `purchases.concurrency.test.ts`) | Pre-fix result | Fix |
|---|---|---|---|---|
| R1 | Two GRNs for the same line exceed ordered | 10 parallel `POST /purchase-receives` for the remaining qty | all 10 accepted (200 received of 10 ordered) | PO row + line rows locked `FOR UPDATE`; remaining re-checked inside; conditional `UPDATE ... WHERE received + qty <= quantity`; CHECK constraint |
| R2 | Retry / double-click duplicates a GRN | same request twice, and 5x in parallel | two GRNs | mandatory `Idempotency-Key`; `idempotency_keys` claim before the handler, stored response replayed; key stored on the GRN with a unique index |
| R3 | Duplicate PO / GRN numbers | 50 parallel PO creates on a fresh organization | **no defect** (1..50, no gaps) | none needed; lazy sequence creation now `ON CONFLICT DO NOTHING` |
| R4 | Edit overwrites a concurrent transition / edit | issue + edit in parallel; two edits with the same version | both applied silently | `version` column, echoed by clients; conditional `updateMany` on `(status, version)`; 409 `PO_VERSION_CONFLICT` |
| R5 | Line reduced below received / item swapped after receipt | edit after partial GRN | item swap accepted; qty guard raced with GRN | guards run inside the lock; item frozen on received lines; qty >= received; CHECK constraint |
| R6 | Receive against a PO being cancelled | cancel + receive in parallel, 15 rounds | cancelled PO with a live GRN | both take the PO lock; cancel counts live receives inside the lock; GRN checks status inside the lock |
| R7 | Status / quantities recomputed outside the transaction; double cancel | 5 parallel partial GRNs; 3 parallel cancels of one GRN | double cancel drove `received_quantity` negative | GRN row locked and status re-checked; conditional decrement `>= 0`; recompute + `version + 1` in the same transaction |

Evidence: `docs/phase-0/prefix-test-run.txt` (new tests against the pre-fix services: 13 failures),
`npm test` after the fixes: 120 API tests green.

## 4. Current-to-target mapping (Step 2)

### Module mapping

| Current module | Target service | Reuse | Refactor needed | Stays in legacy until |
|---|---|---|---|---|
| Auth (`modules/auth`) | svc-auth | bcrypt hashes, `users` rows | RS256 JWT with new claims, sessions, refresh rotation, JWKS (ADR-0003) | Phase 1 |
| Organization + members (`modules/organizations`) | svc-tenant + svc-iam | organizations -> tenants (ACTIVE), members -> memberships, roles / permissions | lifecycle + approval; invitations instead of `addMember` by e-mail; permission version | Phase 1 / 2 |
| Suppliers (`modules/vendors`, model `Vendor`) | svc-party | whole aggregate incl. encrypted bank accounts | rename to supplier; activity table -> audit events; GST lookup provider | Phase 3 |
| Items (`modules/items`) | svc-master | item rows | `trackInventory`, `isSerialized`, HSN link, categories / brands / units | Phase 3 |
| Settings / masters (`modules/settings`) | svc-master | locations, taxes, payment terms, custom fields, tags, sequences | warehouses / bins, `number_series` with FY, condition grades, warranty defaults | Phase 3 |
| Purchase orders (`modules/purchases`) | svc-procurement | header / lines / documents, business rules after the race fixes | approval workflow, revisions, supplier snapshot, `purchase.po.*` events | Phase 5 |
| Purchase receives / GRN | svc-procurement | header / lines | warehouse on GRN, serial capture, `QC_PENDING`, `procurement.grn.received.v1` -> inventory / QC | Phase 5 |

### API dependencies (target)

As in phase-00 section 0.4. Phase 0 adds today: `gateway -> legacy-api` (proxy, health probe);
`legacy-api -> RabbitMQ` (outbox relay, optional).

### Event boundaries created by Phase 0

`legacy-api` emits `audit.recorded.v1` for every PO / GRN action (routing key `audit.recorded.v1`,
queue `audit.recorded`, archive queue `platform.event-archive` bound to `#`). `svc-audit` consumes
it from Phase 1 using the inbox pattern.

### Temporarily remains in legacy-api

Items, suppliers, settings (until Phase 3), PO and GRN (until Phase 5), auth and organizations
(until Phase 1-2). No new business feature is added to `apps/api` after Phase 0; only bug fixes.

## 5. What Phase 0 changed in the legacy application

- `purchase_orders.version`, `purchase_order_lines` CHECK, `purchase_receives.idempotency_key`
  (+ unique), tables `idempotency_keys`, `outbox_events`, `processed_events`
  (`20260930090000_phase0_race_fixes`).
- Purchasing services rewritten around `lockPurchaseOrder` / `lockPurchaseOrderLines`; transitions
  are conditional updates; GRN create requires `Idempotency-Key`.
- `recordPoActivity` also emits `audit.recorded.v1` through the outbox; relay + AMQP publisher.
- Correlation id middleware, identity-header stripping, `error.correlationId` / `error.retryable`
  in the envelope, Prisma P2023 / P2034 mapped, UUID route params -> 404.
- `/health/live`, `/health/ready`.
- Web: `Idempotency-Key` per GRN submission (reused on network / 5xx retry), PO edits send the
  loaded `version`, error toasts show "Reference: <correlation id>" for 5xx / network errors, Vite
  proxy can target the gateway.
- New workspace `apps/gateway`; `infra/` compose stack; CI workflow; ADRs 0001-0005, 0009, 0010, 0011.

Behaviour visible to users: GRN submits that would previously have double-recorded now replay the
first result; edits based on stale data get a clear conflict message; malformed ids return 404
instead of 500. Nothing else changed.
