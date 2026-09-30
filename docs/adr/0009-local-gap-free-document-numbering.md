# ADR-0009: Document numbers are generated locally from a gap-free, row-locked series

- Status: Accepted (Phase 0, 2026-09-30); legacy implementation verified, target table arrives with svc-master
- Related: phase-plan/README.md 5.3, phase-00 R3, `apps/api/src/modules/purchases/documentNumber.service.ts`

## Context

Indian GST practice expects document numbers per financial year (April-March) that are unique and,
ideally, without gaps. A central "numbering service" would put a synchronous dependency on the
hot path of every document creation. `SELECT max()+1` patterns duplicate numbers under load.

## Decision

- Numbers are generated **inside the owning service**, in the same transaction that inserts the
  document, from a series row locked `FOR UPDATE`. The lock serialises creations for that series
  only; a rolled-back transaction releases the number, so the sequence has no gaps.
- **Target table** (`number_series (tenant_id, doc_type, fy, prefix, next_value, padding)`) is
  configured through `svc-master` and copied into each owning service's database as documents
  move (procurement: PO/GRN; sales: SO; billing: invoices; ...).
- **Legacy (verified in Phase 0, R3):** the existing `document_sequences` table (per organization,
  per document type, `FOR UPDATE`, manual numbers skipped) already satisfies the gap-free and
  uniqueness requirements. 50 concurrent PO creates on a fresh organization produced numbers
  1..50 with no duplicates and no gaps against the *pre-Phase-0* code
  (docs/phase-0/prefix-test-run.txt), so no `number_series` table was added to the legacy
  database: it would be dead code until the procurement extraction (Phase 5), which introduces the
  financial-year dimension together with the migration of existing numbers. The one change made
  is that the lazy creation of a sequence row now uses `INSERT ... ON CONFLICT DO NOTHING`.
- Manually typed numbers remain allowed (Zoho-style) and are validated for uniqueness inside the
  same transaction; a manual number matching the pattern moves the series past it.

## Consequences

- Throughput per series is bounded by the lock (one insert at a time per organization and document
  type). Measured cost is milliseconds; acceptable for B2B document volumes.
- The financial-year rollover and the migration of legacy numbers into `number_series` are
  designed in Phase 3 (svc-master) and executed in Phase 5.
