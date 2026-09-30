# Phase 4 - Inventory core: verification and exit-gate status

Date: 2026-09-30. Backend + tests pass (UI follows in the UI pass).

## What was built

| Piece | Location | Notes |
|---|---|---|
| svc-inventory | `apps/svc-inventory` | `inventory_db` under RLS: `item_refs` / `warehouse_refs` / `bin_refs` (from master events), `stock_postings` + `stock_movements` + `serial_events` (append-only: runtime role has no UPDATE/DELETE), `stock_balances` (CHECK qty >= 0), `customer_stock_balances` (DELIVERED per customer), `serial_units` (unique per tenant + item, case-insensitive; IMEI unique per tenant), `inventory_adjustments` (+ lines), `item_cost`, `inventory_settings`, `document_sequences` |
| Posting engine | `src/modules/posting.engine.ts`, `buckets.ts` | Zero-sum per item, fixed transition table narrowed per posting type, cost required on inbound, serialized integer quantities, serial count per line, pattern / IMEI on new serials, re-entry of serials from DELIVERED / EXT_* buckets, deterministic key order with conditional updates (no negative stock, no deadlocks), idempotent by key with payload hash, weighted average cost, `inventory.posting.recorded.v1` |
| Documents | `inventory.service.ts` | Opening stock (only before the item has movements in that warehouse; advisory lock closes the race), JSON/CSV-style import with per-row results, adjustments DRAFT -> POSTED or PENDING_APPROVAL (threshold per tenant, default 25,000) -> approve (four eyes) / cancel, bin moves inside a warehouse |
| Reads | `/api/v1/inventory/stock`, `/stock/:itemId`, `/ledger` (running on-hand), `/serials`, `/serials/:id/history`, `/adjustments`, `/reconciliation`, `/settings` | Warehouse scope from the token applies everywhere |
| Internal API | `/internal/v1/postings` (allow-list per posting type), `/items/:id/has-movements` (master field locks), `/serials:check` (procurement pre-check), `/availability` (sales), `/reconciliation/report` | Service tokens on behalf of a tenant |
| Kit | `packages/platform-kit/src/document-numbers.ts` | Document numbers: format from svc-master, sequence claimed atomically in the owning service's database |
| Gateway | `/api/v1/inventory` routed | |
| ADRs | `docs/adr/0006-double-entry-stock-ledger.md`, `docs/adr/0008-inventory-valuation.md` | |

## Test results

| Suite | Tests | Result |
|---|---|---|
| `npm run test -w @b2b/svc-inventory` (`inventory.test.ts` + `concurrency.test.ts`) | 15 | pass |
| `npm run test -w @b2b/gateway` | 11 | pass |

Step 9 requirements (4.10):

| Test | Where |
|---|---|
| Ledger = balance for random postings (400 by default, `INVENTORY_SOAK_POSTINGS` scales it) | concurrency `soak` |
| Every posting sums to zero | soak (`unbalancedPostings` empty) + engine test |
| 50 parallel takes from AVAILABLE=20 -> exactly 20 succeed, balance 0, never negative | concurrency `50 parallel postings...` |
| Deadlock: (A,B) and (B,A) in parallel | concurrency `postings touching (A,B) and (B,A)...` |
| Idempotency: same key twice -> one posting; same key different payload -> 422; same key in parallel -> one | engine test + concurrency `the same idempotency key in parallel` |
| Serial uniqueness: parallel opening with the same serial -> one succeeds | concurrency `parallel opening stock with the same serial` |
| Serial state: adjusting out a serial not in the bucket -> 422 | adjustments test (`SERIAL_NOT_IN_EXPECTED_STATE`) |
| Serial count invariant | soak (`serialMismatches` empty) |
| Illegal transitions: every non-allowed pair rejected | `rejects every bucket pair outside the transition table` (121 pairs) |
| Tenant isolation: by id, by serial search, raw SQL under tenant B | `searches serials ... hides everything from other tenants` |
| Append-only: runtime role UPDATE/DELETE on ledger -> permission denied | `keeps the ledger append-only for the runtime role` |
| Service allow-list: sales token trying QC_PASS -> 403 | engine test |
| Warehouse scope: scoped user cannot post into another warehouse; stock filtered | `limits scoped users to their warehouses` |
| Audit entries for adjustments with approver | adjustments test |

## Exit gate (4.12)

| Item | Status |
|---|---|
| Ledger balances match stock; concurrent operations safe; duplicate movement impossible | done |
| Serial uniqueness; tenant isolation; no negative stock | done |
| ADR-0006 and ADR-0008 | written |
| Approval recorded to start Phase 5 | per the user's instruction of 2026-09-30, Phase 5 proceeds |

## Notes and follow-ups

- Opening stock import is synchronous with per-row results (the plan allows an async job; rows are
  capped at 2000 per call). A queued job with a downloadable error report is a UI-pass item.
- `inventory.stock.low.v1` is not emitted yet: the product snapshot does not carry the reorder
  level. Add `reorderLevel` to `productSnapshot` when Phase 11 dashboards need it.
- Nightly reconciliation: `npm run reconcile -w @b2b/svc-inventory` exits 1 on any mismatch.
- Numbering format is read from svc-master when `MASTER_URL` is set; otherwise the default
  `ADJ/{FY}/0001` format applies.
