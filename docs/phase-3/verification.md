# Phase 3 - Master data and parties: verification and exit-gate status

Date: 2026-09-30. Backend + tests pass (UI follows in the UI pass).

## What was built

| Piece | Location | Notes |
|---|---|---|
| svc-master | `apps/svc-master` | `master_db` under RLS: units, tax rates (GST slab CHECK + zod refine), HSN/SAC, categories (path), brands, condition grades, warranty policies, products (SKU unique case-insensitively, rules: services never track stock, serialized implies tracked, IMEI implies serialized), warehouses (one default) -> locations -> bins, payment terms, numbering configuration, custom fields. Defaults seeded on `tenant.tenant.activated` (idempotent on redelivery) |
| Product lifecycle + locks | `master.service.ts` | DRAFT -> ACTIVE -> INACTIVE -> ARCHIVED; archived products are frozen; `isSerialized`, `trackInventory`, `unitId`, `type` locked once svc-inventory reports movements (`INVENTORY_URL`, seam `MovementSource`); delete guarded by `entity_references` fed from PO / inventory / sales events |
| Snapshots + events | `master.product.*`, `master.warehouse.*`, `master.bin.*`, `master.grade.updated` | Full snapshot + version so consumers never call back |
| Internal API | `/internal/v1/products:batch`, `/warehouses:batch`, `/numbering/:docType` | Service tokens on behalf of a tenant |
| svc-party | `apps/svc-party` | `party_db` under RLS: suppliers and customers in one `parties` table (`party_type`), addresses (default billing/shipping), contacts (one primary), bank accounts (AES-256-GCM encrypted, last-4 shown, reveal audited without the number), GST validation (format, checksum, PAN match, state code vs default billing address, registered treatments need a GSTIN), duplicate GSTIN per party type, block/unblock with reason, delete guard via references, generated codes |
| Backfills | `apps/svc-master/scripts/migrate-legacy.ts`, `apps/svc-party/scripts/migrate-legacy.ts` | Legacy items/taxes/locations/payment terms/custom fields -> master (ids preserved, non-slab taxes and missing state codes reported); vendors + addresses/contacts/bank accounts -> suppliers (ids preserved, invalid GSTIN/pincode reported not silently dropped, bank accounts re-encrypted from `LEGACY_APP_ENCRYPTION_KEY` to the party key); idempotent; reconciliation before commit |
| Gateway | `apps/gateway/src/routes.ts` | `/api/v1/master` and `/api/v1/party` routed |
| Kit | `packages/platform-kit/src/app.ts` | ORM constraint failures (`23514`, `23505`, deadlocks) mapped to the error envelope |

## Test results

| Suite | Tests | Result |
|---|---|---|
| `npm run test -w @b2b/svc-master` (incl. legacy backfill) | 10 | pass |
| `npm run test -w @b2b/svc-party` (incl. legacy backfill) | 5 | pass |
| `npm run test -w @b2b/gateway` | 11 | pass |

Step 9 requirements:

| Requirement | Test |
|---|---|
| Duplicate SKU (sequential and concurrent) -> one wins | master `rejects duplicate SKUs sequentially and under concurrency` |
| Field locks after movements | master `locks serialization ... once the item has movements` |
| Lifecycle + archived frozen + delete guard with references | master `walks the lifecycle and applies the delete guard` |
| GST slab constraint, duplicate names, numbering template validation | master `rejects duplicate names, guards archives of used records, and validates numbering templates` |
| Warehouse scope filtering | master `warehouses, locations and bins` |
| Tenant isolation (API + raw RLS) and events with versions | master `tenant isolation and events` |
| GSTIN format / checksum / state mismatch / registered without GSTIN / duplicate per type | party `validates GSTIN format, checksum, state match and registration requirements` |
| If-Match, block/unblock, blocked suppliers hidden from lookups, delete guard | party `patches with If-Match, blocks with a reason, unblocks, and guards deletes with references` |
| Bank account masking, reveal audited without the full number, encrypted at rest | party `manages addresses, contacts and bank accounts...` |
| Tenant isolation + internal snapshot on behalf of a tenant | party `hides tenant A parties from tenant B...` |
| Backfill preserves ids, flags bad data, idempotent | master `legacy master backfill`, party `legacy supplier backfill` (skip when the legacy test database is absent) |

## Exit gate (3.12)

| Item | Status |
|---|---|
| Products, warehouses, suppliers, customers managed in the new services | done (backend) |
| GST rules enforced at the API | done |
| Legacy tables backfilled with ids preserved and reconciled | scripts + tests done; production run is an operations step |
| Events with snapshots for downstream services | done |
| Approval recorded to start Phase 4 | per the user's instruction of 2026-09-30, Phase 4 proceeds |

## Follow-ups

- Customers: same lookup/blocking semantics as suppliers are in place; sales-specific fields (credit terms) arrive with Phase 6.
- Legacy-sync consumers (writing back to legacy tables) were not needed: the legacy API keeps serving reads from its own tables until Phase 5 cut-over.
- Attachments for parties (KYC documents) with the S3 presign pattern from Phase 5.
