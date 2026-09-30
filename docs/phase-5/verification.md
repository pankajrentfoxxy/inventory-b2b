# Phase 5 - Procurement, GRN and QC: verification and exit-gate status

Date: 2026-09-30. Backend + tests pass (UI follows in the UI pass).

## What was built

| Piece | Location | Notes |
|---|---|---|
| svc-procurement | `apps/svc-procurement` | `procurement_db` under RLS: `purchase_orders` (+ `po_lines`, `po_revisions`, `po_approvals`), `grns` (+ `grn_lines`, `grn_line_serials`), `document_attachments`, `procurement_settings`, `document_sequences`. Snapshots of supplier (svc-party), items and warehouse (svc-master) at document time; totals from `@b2b/shared` `computePurchaseOrderTotals` (CGST/SGST vs IGST from supplier vs warehouse state) |
| PO state machine | `procurement.service.ts` (`PO_TRANSITIONS`) | DRAFT -> submit -> PENDING_APPROVAL -> approve/reject -> APPROVED -> issue -> ISSUED -> (receipts) PARTIALLY_RECEIVED -> RECEIVED -> close/auto-close -> CLOSED; revise from ISSUED/PARTIALLY_RECEIVED creates revision n+1 and re-approves; cancel only without live receipts; short-close cancels the remaining quantity. Guards: supplier ACTIVE (fresh snapshot on submit), items ACTIVE, four-eyes (`approverMustDiffer`), approval limit (`approvalLimit`, administrators exempt), received lines immutable (item, price, qty >= received), If-Match on draft edits |
| GRN | `createGrn` / `receiveIn` | Idempotency-Key mandatory (+ unique per tenant); receive locks PO and lines, checks status, warehouse scope, `received + qty <= ordered - cancelled (+ tolerance %)`, serialized rules (integer qty, one serial per unit, no duplicates in request, pattern, IMEI), synchronous serial pre-check in svc-inventory, then updates received quantities, PO status and emits `procurement.grn.received.v1` |
| Choreography | `apps/svc-inventory/src/modules/consumers.ts`, `apps/svc-qc/src/modules/consumers.ts`, `apps/svc-procurement/src/modules/consumers.ts` | grn.received -> inventory RECEIPT (`GRN:<id>:RECEIPT`, EXT_SUPPLIER -> QC_HOLD) -> receipt.posted (GRN QC_PENDING, qc lots) or receipt.rejected (GRN POSTING_FAILED, retry with corrected serials); qc.lot.decided -> QC_PASS / QC_FAIL (`QC_LOT:<id>:PASS|FAIL`) -> qc_posting.recorded (lot CLOSED, GRN line done -> GRN QC_COMPLETED -> PO auto-CLOSED). Business failures inside inventory postings roll back to a savepoint and become events, so redelivery never loops |
| GRN cancellation saga | same consumers | cancel (QC_PENDING) -> CANCELLATION_PENDING -> grn.cancellation_requested -> qc refuses if any lot has results / decisions (GRN back to QC_PENDING with reason) or cancels every lot -> inventory RECEIPT_REVERSAL per line (`GRN:<id>:REVERSAL:<line>`) -> receipt.reversed (all lines -> GRN CANCELLED, PO quantities restored) or reversal_refused. DRAFT and POSTING_FAILED receipts cancel directly; QC_COMPLETED receipts cannot be cancelled (supplier return, Phase 8) |
| svc-qc | `apps/svc-qc` | `qc_db` under RLS: checklists (+ items, critical flags), lots (unique per source line), unit results, defect codes. Lots from `inventory.receipt.posted.v1` (QUANTITY or SERIAL mode; `qcRequired=false` auto-passes as system); start / results (serials must belong to the lot, FAIL needs a defect code, critical checklist FAIL forces FAIL) / decide (serial mode derives counts from results and needs every serial; quantity mode needs pass + fail = qty) / reopen (until inventory posted) |
| Backfill | `apps/svc-procurement/scripts/migrate-legacy.ts` | Legacy POs / lines / receives -> procurement with ids and numbers preserved, statuses mapped, receipts marked `LEGACY_PRE_SYSTEM_QC` (QC_COMPLETED), snapshots rebuilt from legacy vendor / item / location rows; produces the opening-stock manifest (item x warehouse x qty x average cost) for `POST /api/v1/inventory/opening-stock/import` at go-live; idempotent |
| Gateway | `/api/v1/procurement`, `/api/v1/qc` routed | |

## Test results

| Suite | Tests | Result |
|---|---|---|
| `npm run test -w @b2b/svc-procurement` (`procurement.test.ts` with fake sources, `e2e.test.ts` with real master + party + inventory + qc runtimes, `migration.test.ts`) | 8 | pass |
| `npm run test -w @b2b/svc-qc` | 4 | pass |
| `npm run test -w @b2b/svc-inventory` (incl. Phase 5 consumers via e2e) | 15 | pass |
| `npm run test -w @b2b/gateway` | 11 | pass |

Step 9 requirements (5.10):

| Area | Test |
|---|---|
| Over-receipt: concurrent GRNs never exceed ordered; tolerance respected | procurement `guards over-receipt...` (10 parallel x 3 against 10 -> exactly 3; 10 % tolerance accepts 11) |
| Duplicate GRN: same Idempotency-Key -> one GRN; double event delivery -> one RECEIPT posting | procurement (replay header, same id); inventory posting key `GRN:<id>:RECEIPT` + inbox (qc `ignores redelivery`) |
| Cancellation before QC -> stock back to EXT_SUPPLIER, PO qty restored; after inspection -> refused, GRN back to QC_PENDING | e2e `GRN cancellation reverses stock...`; procurement saga test; qc `cancels untouched lots and refuses...` |
| QC validity: decide twice -> 409; reopen after posting -> 409; decide needs results | qc `quantity mode...`, `serial mode...` |
| Failed items not sellable | e2e: REJECTED 4 and AVAILABLE 96; inventory transition table forbids REJECTED -> RESERVED |
| Serials: duplicates in request / in inventory -> 422; POSTING_FAILED path; history PO -> GRN -> QC | procurement GRN test; `follows inventory and QC events...`; e2e serial history `[RECEIPT, QC_PASS]` with poId / grnId / qcLotId on the unit |
| Ledger: zero mismatches after the full flow; QC_HOLD equals undecided lot qty | e2e reconciliation `ok`, `qcHold` assertions |
| PO transitions: full matrix; revise below received -> 422; item swap on received line -> 422 | procurement `rejects every command...`, `revises issued orders...` |
| Authorization: executive cannot approve / issue / cancel receipts; approval limit; scoped warehouse user cannot receive elsewhere | procurement tests (403s, `PO_APPROVAL_LIMIT`, `GRN_WAREHOUSE_SCOPE`) |
| Tenant isolation: cross-tenant PO / GRN / lot -> 404; wrong-tenant events ignored | procurement + qc tests |
| Failure recovery: inventory rejection -> POSTING_FAILED -> retry re-emits and reaches QC_PENDING | procurement `follows inventory and QC events...` |

## Verification (5.11)

- End-to-end PO 100 -> GRN 100 -> QC 96 / 4 -> AVAILABLE 96, REJECTED 4, QC_HOLD 0; serial states PASSED / grade A: `e2e.test.ts`.
- Audit trail PO_CREATED ... GRN_QC_COMPLETED / PO_CLOSED with actors (procurement), QC_DECIDED with the approver (qc): asserted in `e2e.test.ts`.
- Event tracing in Tempo: the correlation id travels in every envelope; the observability stack is in `infra/` (Phase 0). Not asserted by tests.

## Exit gate (5.12)

| Item | Status |
|---|---|
| Over-receiving impossible; duplicate GRN impossible; GRN cancellation reversible when legal | done |
| QC cannot happen without a valid GRN (lots only from posted receipts); QC-failed items cannot be sold | done |
| Serial numbers captured correctly; inventory ledger correct | done |
| Legacy PO/GRN write-disabled; backfill reconciled | backfill script + test done. Write-revoking the legacy tables and switching `/api/v1/purchase-orders` off the legacy API are the cut-over steps for operations once the UI pass targets the new endpoints (the legacy API keeps serving the current web-app until then) |
| Approval recorded to start Phase 6 | pending the user's review of Phases 1-5 |

## Notes and follow-ups

- PO PDF generation and e-mailing the supplier on issue are UI-pass / notification items; `procurement.po.issued.v1` is emitted for svc-notification.
- Attachments: `POST /attachments:presign` records metadata and returns a `local://` upload URL until S3/MinIO credentials are configured (`StorageSource` seam).
- Receipts in `RECEIVED` (posting in flight) cannot be cancelled; wait for `QC_PENDING` or `POSTING_FAILED`. A stuck saga (> 10 min in CANCELLATION_PENDING) should alert; no auto-resolution.
- The Phase 0 legacy receive transaction remains in `apps/api` until cut-over; both paths share the same guards.
