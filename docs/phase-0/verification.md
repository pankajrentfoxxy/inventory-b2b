# Phase 0 - Verification, regression and exit-gate status

Date: 2026-09-30. Branch: `phase-0-foundation`. Environment: Windows 11, Node 24.18, PostgreSQL 16
in the shared `laptop-erp-postgres` container (:5433).

## Baseline (entry criterion 0.2)

`npm test` on the untouched branch: **87 tests, 87 passed, 0 failed, 9.6 s** (vendors,
purchases, validation, GST).

## Tests written first, then the fixes

The new suite `apps/api/test/purchases.concurrency.test.ts` (33 tests) was run against the
pre-Phase-0 services by temporarily restoring `purchaseReceive.service.ts`,
`purchaseOrder.service.ts` and `documentNumber.service.ts` from `HEAD`:

- **13 failed, 20 passed** (`docs/phase-0/prefix-test-run.txt`). Failures: R1 (both), R2 (key stored
  on the GRN, error replay), R4 (all three), R5 (item swap, version bump), R6, R7 (both), outbox
  (no events were written).
- R3 passed on the old code: numbering was already gap-free under 50 concurrent creates. Recorded
  as "verified, no fix needed" (ADR-0009).
- Tests that pass on both versions are the ones exercising new plumbing shared by both runs
  (idempotency middleware, inbox helper, health, correlation, cross-tenant sweep) or guards that
  already existed (quantity below received, removal of received line).

## After the fixes

| Suite | Result |
|---|---|
| `npm run typecheck` (shared, api, gateway, web) | clean |
| `npm run test -w @b2b/api` | **120 tests, 120 passed** (87 baseline + 33 new), about 22 s |
| `npm run test -w @b2b/gateway` | **13 tests, 13 passed** (no database needed) |
| Regression (Step 11) | baseline 87 all still pass; 5 existing GRN tests gained the now-mandatory `Idempotency-Key` header, no other change |
| `npm run infra:up` (postgres, rabbitmq, redis, minio) | all four healthy on first boot; 16 `<svc>_db` databases and role pairs created; `procurement_role` connecting to `inventory_db` -> "User does not have CONNECT privilege"; broker queues from `definitions.json` present; buckets `tenants`, `platform` created |
| `npm run events:smoke -w @b2b/api` (live RabbitMQ) | outbox row relayed with publisher confirms (`attempts: 1`, `publishedAt` set); event consumed back from `audit.recorded` **and** `platform.event-archive` |

### Step 9 test matrix

| Area | Plan requirement | Test | Status |
|---|---|---|---|
| R1 | 10 concurrent GRNs -> exactly one succeeds, others 422 `OVER_RECEIPT`; ledger invariant | `R1 - over-receipt race` (2 tests) + DB CHECK test | pass |
| R2 | same key twice -> one GRN, identical response; different body -> 422 | `R2 - idempotent GRN creation` (6 tests, incl. 5 concurrent submits, tenant scoping, error replay) | pass |
| R3 | 50 concurrent PO creates -> unique sequential numbers, no gaps | `R3 - document numbering under load` (2 tests) | pass (pre-existing behaviour) |
| R4 | approve + edit in parallel -> one wins, other 409 | `R4 - optimistic concurrency` (3 tests) | pass |
| R5 | reduce below received -> 422; item swap on received line -> 422 | `R5 - received lines are protected` (5 tests incl. edit-vs-receive race) | pass |
| R6 | cancel vs receive -> never both succeed | `R6` (15 rounds) + close vs receive (5 rounds) | pass |
| R7 | status recomputed in the same transaction; double cancel | `R7` (2 tests) | pass |
| Gateway | inbound `x-tenant-id` stripped; other org's ids -> 404 | `gateway.test.ts` (stripping, 13 tests) + API `tenant isolation sweep` (12 routes -> 404) | pass |
| Outbox | broker down mid-test -> published after recovery, no duplicates | `outbox` (3 tests: same-tx envelope + correlation id, rollback leaves no row, relay outage/recovery) | pass |
| Inbox | same event 3x -> one effect | `inbox` (sequential + 5 concurrent) | pass |
| Health | `/health/ready` -> 503 when DB down | `correlation ids, health and error envelope` (4 tests) | pass |

### Step 10 checks

- [x] PO create / edit / issue / receive / cancel / close / reopen / delete flows covered by the
      existing suite plus the new one; through the gateway: routing and rewrite covered by the gateway
      suite against an echo upstream. *Manual click-through via `npm run dev:all` not performed in
      this session (no browser).* 
- [x] Tenant isolation sweep: tenant B against every purchasing route with tenant A ids -> all 404,
      and tenant A's data unchanged afterwards.
- [x] DB invariant query returns zero rows after every scenario (asserted per test, and CI runs it
      over the whole test database after the suite):
      ```sql
      SELECT l.id FROM purchase_order_lines l
      LEFT JOIN (SELECT gl.purchase_order_line_id, sum(gl.quantity) q FROM purchase_receive_lines gl
                 JOIN purchase_receives g ON g.id = gl.purchase_receive_id
                 WHERE g.status <> 'CANCELLED' GROUP BY gl.purchase_order_line_id) r
             ON r.purchase_order_line_id = l.id
      WHERE coalesce(r.q, 0) <> l.received_quantity OR l.received_quantity > l.quantity;
      ```
- [x] Audit envelopes exist for every PO / GRN action with the request's correlation id (asserted).
      *Rows in `audit_db` require `svc-audit` (Phase 1); today the envelopes sit in
      `outbox_events` and are published to `audit.recorded` when `AMQP_URL` is set.*
- [ ] Grafana request rate / latency and a gateway -> legacy trace: the observability stack is
      provisioned in `infra/` but the OpenTelemetry SDK is not yet wired into the processes. Carried
      to the platform-kit extraction (ADR-0011 item 4).

## Pre-check and data correction for the new constraints

Run on a production copy **before** `prisma migrate deploy`:

```sql
-- must return zero rows
SELECT id, quantity, received_quantity FROM purchase_order_lines
 WHERE received_quantity < 0 OR received_quantity > quantity;

-- must return zero rows (received_quantity must equal the sum of live GRN lines)
SELECT l.id, l.received_quantity, coalesce(r.q, 0) AS from_grns FROM purchase_order_lines l
LEFT JOIN (SELECT gl.purchase_order_line_id, sum(gl.quantity) q FROM purchase_receive_lines gl
           JOIN purchase_receives g ON g.id = gl.purchase_receive_id
           WHERE g.status <> 'CANCELLED' GROUP BY gl.purchase_order_line_id) r
       ON r.purchase_order_line_id = l.id
 WHERE coalesce(r.q, 0) <> l.received_quantity;
```

If rows come back, the documented correction is to trust the GRN documents (they are what the
warehouse signed for) and rewrite the derived column, then re-run the checks:

```sql
BEGIN;
UPDATE purchase_order_lines l
   SET received_quantity = coalesce(r.q, 0)
  FROM (SELECT gl.purchase_order_line_id, sum(gl.quantity) q FROM purchase_receive_lines gl
        JOIN purchase_receives g ON g.id = gl.purchase_receive_id
        WHERE g.status <> 'CANCELLED' GROUP BY gl.purchase_order_line_id) r
 WHERE r.purchase_order_line_id = l.id AND l.received_quantity <> r.q;
-- lines whose GRN total exceeds the ordered quantity are real over-receipts: review each one with
-- purchasing before either raising `quantity` or cancelling the excess GRN. Do not run the
-- migration until the first query above is empty.
COMMIT;
```

## Exit gate (0.14)

| Item | Status |
|---|---|
| `current-architecture.md` and mapping tables complete and reviewed | written (`docs/phase-0/current-architecture.md`); **review pending** |
| R1-R7 fixed with passing concurrency tests | done (R3 verified, no defect) |
| All infra services healthy via `docker compose up`; CI green | core stack booted and verified locally (table above); observability profile validated with `compose config` only; **CI not yet run** (needs the branch pushed) |
| Outbox / inbox proven end-to-end with failure injection | failure injection at the library level (in-memory broker outage and recovery, no duplicates); live path verified with `events:smoke` against RabbitMQ |
| ADRs 0001-0005, 0009, 0010 merged | written, plus 0011 (Proposed). Merge = user review |
| No user-visible behaviour change except clearer errors and duplicate-submit protection | holds; see the list in `current-architecture.md` section 5 |
| Approval recorded to start Phase 1 | **open** |

## Deliberately not done in Phase 0 (and why)

- `apps/api -> apps/legacy-api`, `apps/web -> apps/web-app` rename and pnpm / Turborepo: deferred
  as its own commit (ADR-0011).
- NestJS `platform-kit` / `contracts` / `test-kit` packages and `svc-audit` as a separate
  deployable: the functions exist in `apps/api/src/lib` and the consumer needs the framework
  decision first (ADR-0011). The RabbitMQ queues for `svc-audit` and the event archiver are
  declared in `infra/rabbitmq/definitions.json`.
- `number_series` table in the legacy database: not needed (ADR-0009).
- Row-Level Security on the legacy database (ADR-0005).
- Reference "hello" service / `platform.heartbeat.v1` smoke test: queue declared; the publisher
  side is trivial once the compose stack runs in CI.
