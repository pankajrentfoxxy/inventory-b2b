# ADR-0006: Double-entry stock ledger with materialised balances

- Status: Accepted (Phase 4)
- Related: phase-plan/phase-04-inventory-core.md 4.3-4.5, ADR-0008

## Context

The legacy application kept no stock ledger; quantities were implied by received purchase lines.
Every later module (QC, sales reservations, dispatch, transfers, returns) moves stock, and each
would otherwise reinvent quantity bookkeeping with its own race conditions. Auditors need to answer
"where did these 4 units go" without reconstructing history from documents.

## Decision

- Stock changes only through `svc-inventory`'s posting engine. A posting is a set of signed lines
  (`stock_movements`) that **sum to zero per item**; the counterparty of every real movement is a
  bucket (`QC_HOLD`, `AVAILABLE`, `RESERVED`, `REJECTED`, `IN_TRANSIT`, `DELIVERED`) or a virtual
  bucket (`EXT_SUPPLIER`, `EXT_CUSTOMER`, `EXT_OPENING`, `EXT_ADJUSTMENT`, `EXT_SCRAP`). Stock
  never appears or vanishes; an unbalanced posting is rejected (`INV_UNBALANCED_POSTING`).
- `stock_postings`, `stock_movements` and `serial_events` are append-only: the runtime database
  role has no `UPDATE`/`DELETE` on them (tables are commented `append-only`; the grant script
  revokes). Corrections are new postings (`reversal_of` links them).
- `stock_balances` (item x warehouse x bin x bucket) is updated in the same transaction as the
  ledger lines with `UPDATE ... SET qty = qty + delta WHERE ... AND qty + delta >= 0`, processed in
  a deterministic key order. The database `CHECK (qty >= 0)` is the last line of defence against
  negative stock; the conditional update turns contention into `INSUFFICIENT_STOCK` (422), never a
  deadlock or a negative balance.
- Bucket transitions are a fixed table (`buckets.ts`), narrowed further per posting type. Nothing
  moves `QC_HOLD -> RESERVED` or `REJECTED -> RESERVED`; QC-failed stock cannot be sold.
- Every posting carries an idempotency key unique per tenant. The same key with the same payload
  replays the original result; the same key with a different payload is `INV_POSTING_KEY_CONFLICT`.
  Other services derive keys from their document (`GRN:<id>:RECEIPT`, `QC_LOT:<id>:PASS`), so
  redelivered events cannot post twice.
- Posting types owned by other domains are callable only by that domain's service token
  (`POSTING_RULES[type].callers`); RECEIPT and QC postings run inside inventory's own consumers.
- A reconciliation query (ledger sums vs balances, per-posting balance, serial counts vs
  balances, negative balances) is exposed internally and to tenant approvers; the test suite ends
  with it and a randomized soak must keep it empty.

## Consequences

- Reads are cheap (balances are materialised); writes pay for the extra rows, bounded by short
  transactions with no network calls inside.
- Every consumer of stock must learn to express its business fact as a posting; that is the point.
- DELIVERED stock is keyed to the customer in `customer_stock_balances` for traceability and is not
  counted as on-hand.
