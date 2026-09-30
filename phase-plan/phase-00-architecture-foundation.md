# Phase 0 — Architecture Foundation

> Read `README.md` first. This phase builds the chassis every later service runs on, puts the existing app behind a gateway without changing its behaviour, and fixes the known procurement race conditions **before** anything is extracted.

---

## 0.1 Goal & scope

**In scope**
- Current-architecture audit and current → target mapping (Section 43 of the brief)
- Monorepo restructure: existing backend moves to `apps/legacy-api` unchanged
- `gateway` service with routing, JWT verification (legacy tokens via adapter), correlation IDs, rate-limit skeleton
- `packages/platform-kit`, `packages/contracts`, `packages/test-kit`
- Infra: Postgres (DB-per-service bootstrap), RabbitMQ, Redis, MinIO, observability stack, Docker Compose
- Common error format, logging, config validation, health checks
- Outbox/inbox library + a reference "hello" service proving the event pipeline end-to-end
- `svc-audit` skeleton (consumes `audit.recorded.v1`, stores rows)
- CI pipeline
- **Fix PO/GRN race conditions in the legacy code**
- ADRs 0001–0005, 0009, 0010

**Out of scope**
- Any new business feature
- Extracting any legacy module (starts Phase 1)
- UI changes other than pointing the frontend at the gateway URL

---

## 0.2 Entry criteria

- Access to the existing repo, DB schema/migrations, `.env` examples, and a staging DB copy
- Existing test suite runs (even if thin) — record the baseline pass/fail count

---

## 0.3 Step 1 — Understand (audit checklist)

Produce `docs/phase-0/current-architecture.md` answering every item. Do not assume.

**Code & runtime**
- [ ] Framework, language, ORM, Node version, package manager, build tooling
- [ ] Module list with LOC and folder paths
- [ ] How auth works: token type, where issued, expiry, refresh, password hashing algorithm, where the organization/tenant is resolved from on each request
- [ ] Where `organization_id` is applied: middleware? each query? Is any query missing it? (grep every `findMany`/`findUnique`/raw SQL)
- [ ] Is `organization_id` ever read from request body/query/headers?
- [ ] Permission model: roles? permission checks on backend or only UI?
- [ ] File uploads: where stored?
- [ ] Background jobs / cron / queues
- [ ] Existing tests: count, type, runtime

**Data**
- [ ] ER diagram of current tables; mark each table with its target service
- [ ] Every table: has tenant key? nullable? indexed? part of unique constraints?
- [ ] PO/GRN tables: quantity columns, status columns, how `received_qty` is maintained
- [ ] Number generation for PO/GRN numbers (max+1? sequence?)
- [ ] Foreign keys that will cross service boundaries (these become id + snapshot)

**Procurement race-condition audit** — for each, write the reproduction and the fix:
| # | Suspected race | How to reproduce | Expected fix |
|---|---|---|---|
| R1 | Two GRNs for the same PO line concurrently → total received > ordered | Fire 2 parallel `POST /grn` for remaining qty | Lock PO lines `FOR UPDATE` or conditional update in one tx |
| R2 | Double-click / retry creates duplicate GRN | Same request twice | `Idempotency-Key` + unique `(tenant_id, idempotency_key)` |
| R3 | PO/GRN number duplicates (`SELECT max()+1`) | 20 parallel creates | Gap-free `number_series` row lock or unique constraint + retry |
| R4 | PO status overwritten (edit while approving) | Parallel approve + edit | `version` column + conditional update |
| R5 | PO edited below received qty / item swapped after receipt | Edit after partial GRN | Guard: `new_qty >= received_qty`; lines with receipts immutable |
| R6 | Receive against cancelled PO | Cancel and receive in parallel | Status check inside the same locked tx |
| R7 | PO status (PARTIALLY_RECEIVED/RECEIVED) recalculated outside tx | Parallel GRNs | Recompute status in the same tx as quantity update |

---

## 0.4 Step 2 — Current → target mapping (deliverable template)

Fill this in during the audit (starting values shown; confirm against code).

### Module mapping
| Current module | Target service | Reuse | Refactor needed | Stays in legacy until |
|---|---|---|---|---|
| Auth | svc-auth | Password hashes (if bcrypt/argon2), user table | Issue RS256 JWT with new claims; sessions table; refresh rotation | Phase 1 |
| Organization | svc-tenant + svc-iam | Org rows → tenants; user-org links → memberships | Lifecycle status; approval flow; stop self-serve activation | Phase 1 / 2 |
| Supplier | svc-party | Supplier rows, addresses, GST fields | Split contacts/addresses; GSTIN validation | Phase 3 |
| Items | svc-master | Item rows | Add type GOODS/SERVICE, `trackInventory`, `isSerialized`, HSN link | Phase 3 |
| Settings/master data | svc-master | Units, tax, payment terms | Numbering config; condition grades; warranty defaults | Phase 3 |
| Purchase Orders | svc-procurement | PO header/lines, business logic after race fixes | State machine, approval, revisions, snapshots | Phase 5 |
| Purchase Receives/GRN | svc-procurement | GRN header/lines | Warehouse on GRN, serial capture, QC_PENDING status, outbox event | Phase 5 |

### Database ownership (target)
| Legacy table (example) | Target DB | Notes |
|---|---|---|
| users | auth_db (identity) + iam_db (membership) | Split credentials vs membership |
| organizations | tenant_db | Add lifecycle columns |
| suppliers, supplier_addresses | party_db | |
| items, units, taxes, payment_terms | master_db | |
| purchase_orders, po_lines, grns, grn_lines | procurement_db | |

### API dependencies (target)
| Caller | Callee | Call | Sync/Async |
|---|---|---|---|
| gateway | svc-auth | JWKS fetch (cached) | Sync, cached 10 min |
| gateway | svc-tenant | Tenant status (cache miss) | Sync, Redis-first |
| svc-procurement | svc-party | Supplier snapshot on PO create | Sync |
| svc-procurement | svc-master | Item/warehouse snapshot | Sync |
| svc-procurement | svc-inventory | Serial duplicate pre-check at GRN | Sync |
| svc-sales | svc-inventory | Reserve / release | Sync |
| svc-fulfillment | svc-inventory | Consume reservation / move stock | Sync |
| all | svc-audit | via `audit.recorded.v1` | Async |

### Event boundaries
See README §7. The boundaries created by the first extractions: tenant lifecycle → gateway/auth; GRN received → inventory/QC; QC decided → inventory.

### Temporarily remains in legacy-api
Items, Suppliers, Settings (until Phase 3), PO & GRN (until Phase 5). Legacy continues to use its own DB. **No new feature is added to legacy-api** except the race-condition fixes in this phase.

---

## 0.5 Step 3 — Architecture for this phase

```text
Browser (web-app)          Browser (web-admin, Phase 1)
        │                             │
        └──────────── Nginx/Traefik (TLS) ────────────┘
                          │
                    gateway (NestJS)
         ┌────────────────┼──────────────────────┐
   /api/v1/* (all)   /api/v1/platform/* (P1)   /health
         │
    legacy-api  (unchanged behaviour)
         │
     legacy DB

  platform infra:  Postgres cluster │ RabbitMQ │ Redis │ MinIO │ OTel collector │ Loki │ Prometheus │ Grafana
  svc-audit  ◀── audit.recorded.v1 ── (legacy-api emits for PO/GRN actions via outbox)
```

Gateway routing table (config-driven, per-path, so later phases switch one route at a time):
```yaml
routes:
  - prefix: /api/v1/platform   target: svc-tenant      enabled: false   # Phase 1
  - prefix: /api/v1/auth       target: legacy-api                        # → svc-auth in Phase 1
  - prefix: /api/v1            target: legacy-api                        # default catch-all
```

---

## 0.6 Step 4 — Database

**Bootstrap script** `infra/postgres/init/00-create-dbs.sh` creates, for each service: database `<svc>_db`, role `<svc>_role` with `CONNECT` on its own DB only, `REVOKE ALL ON DATABASE <other> FROM <svc>_role`. Migration role separate from runtime role (runtime role: DML only, no DDL).

**Standard tables in every service DB** (provided by `platform-kit` migrations):
```sql
CREATE TABLE outbox_events (
  id             uuid PRIMARY KEY,
  tenant_id      uuid,
  event_type     text NOT NULL,
  event_version  int  NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id   uuid NOT NULL,
  envelope       jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz,
  attempts       int NOT NULL DEFAULT 0,
  last_error     text
);
CREATE INDEX outbox_unpublished ON outbox_events (created_at) WHERE published_at IS NULL;

CREATE TABLE processed_events (
  consumer     text NOT NULL,
  event_id     uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);

-- idempotency_keys: see README §5.6
-- number_series:
CREATE TABLE number_series (
  tenant_id   uuid NOT NULL,
  doc_type    text NOT NULL,       -- 'PO','GRN',...
  fy          text NOT NULL,       -- '2026-27'
  prefix      text NOT NULL,
  next_value  bigint NOT NULL DEFAULT 1,
  padding     int NOT NULL DEFAULT 4,
  PRIMARY KEY (tenant_id, doc_type, fy)
);
```

**Legacy DB changes (race fixes only)**
- `purchase_orders.version int NOT NULL DEFAULT 0`
- `po_lines`: `CHECK (received_qty >= 0 AND received_qty <= ordered_qty)` (after verifying existing data complies — write a pre-check query; fix bad rows via documented data correction first)
- `grns`: `idempotency_key uuid`, `UNIQUE (organization_id, idempotency_key)`
- `UNIQUE (organization_id, po_number)`, `UNIQUE (organization_id, grn_number)`
- `number_series` table in legacy DB for PO/GRN numbers
- Legacy `outbox_events` table (so PO/GRN actions emit `audit.recorded.v1` now, and domain events in Phase 5 prep)

---

## 0.7 Step 5 — API (this phase)

| Endpoint | Owner | Auth | Notes |
|---|---|---|---|
| `GET /health/live` | every service | none | Process up |
| `GET /health/ready` | every service | none | DB, broker, Redis reachable |
| `GET /metrics` | every service | internal network only | Prometheus |
| `*/api/v1/*` | gateway → legacy-api | legacy token | Pass-through; gateway adds `x-correlation-id`, strips identity headers |
| `POST /api/v1/grns` (legacy) | legacy-api | existing | Now requires `Idempotency-Key`; returns 409/422 per README §5.5 |

**Legacy GRN create — corrected algorithm (single transaction):**
```text
BEGIN
  check idempotency key → replay if completed
  SELECT po FOR UPDATE WHERE id=:po AND org=:org          -- serialises receipts on this PO
  assert po.status IN (ISSUED, PARTIALLY_RECEIVED)        -- else 409 PO_NOT_RECEIVABLE
  SELECT po_lines FOR UPDATE WHERE po_id=:po ORDER BY id  -- deterministic lock order
  for each grn line: assert line.received_qty + qty <= line.ordered_qty  -- else 422 OVER_RECEIPT
  next number from number_series FOR UPDATE
  INSERT grn, grn_lines
  UPDATE po_lines SET received_qty = received_qty + qty
  recompute po.status (PARTIALLY_RECEIVED | RECEIVED); version+1
  INSERT outbox (audit.recorded GRN_CREATED)
  store idempotency response
COMMIT
```

**Gateway error normalisation:** legacy errors are wrapped into the README error format at the gateway so the frontend handles one shape from day one.

---

## 0.8 Step 6 — Events (this phase)

| Event | Producer | Consumer | Purpose |
|---|---|---|---|
| `audit.recorded.v1` | legacy-api (PO/GRN actions) | svc-audit | Prove outbox → broker → inbox pipeline on real actions |
| `platform.heartbeat.v1` | reference service | reference consumer | Smoke test in CI |

RabbitMQ topology (`infra/rabbitmq/definitions.json`): exchange `domain.events` (topic, durable); per-consumer queue `<svc>.<purpose>`; retry queues `<queue>.retry.10s|60s|10m` with TTL + dead-letter back to main; `<queue>.dlq`. Alert when any DLQ depth > 0.

---

## 0.9 Step 7 — Frontend

- `web-app` API base URL → gateway. No visual change.
- Add a single API client wrapper that: sends `Idempotency-Key` for mutations (generated per form submission, reused on retry), reads the unified error format, surfaces `correlationId` in error toasts ("Reference: c0f1…") for support.
- Disable submit buttons while a mutation is in flight (UX only; server enforces).

---

## 0.10 Step 8 — Implementation order

1. Restructure repo into monorepo; move backend to `apps/legacy-api`, frontend to `apps/web-app`. CI green with zero behaviour change.
2. `infra/docker-compose.yml` with Postgres, RabbitMQ, Redis, MinIO, OTel collector, Loki, Prometheus, Grafana.
3. `packages/platform-kit`: config (zod-validated env, fail-fast), logger (Pino, redaction of `authorization`, `password`, `token`), correlation-id middleware, error filter, health module, OTel bootstrap, outbox + relay, inbox decorator, idempotency interceptor, tenant-context + auth-guard (pluggable verifier), db-tenant (`SET LOCAL app.tenant_id`).
4. `packages/contracts`: envelope schema, error codes, event registry.
5. `gateway`: routing table, legacy-token verifier adapter, header stripping, correlation id, request logging, Redis rate-limit skeleton (per IP + per tenant, generous limits), body size limits.
6. `svc-audit` skeleton + migrations + consumer. Also add the **event archiver** here: a consumer bound to `#` on `domain.events` that appends every envelope to daily JSONL objects in MinIO (`platform/event-archive/YYYY/MM/DD/<hour>.jsonl`). Reporting (Phase 11) rebuilds projections from this archive, so it must run from day one.
7. Legacy race-condition fixes R1–R7 with tests written **first** (they must fail before the fix).
8. Legacy outbox → emits `audit.recorded.v1` for PO/GRN actions.
9. CI: lint, typecheck, unit, integration (testcontainers), build images, `docker compose up` smoke test hitting `/health/ready` on all services.
10. ADRs committed.

---

## 0.11 Step 9 — Tests

| Area | Test |
|---|---|
| R1 | 10 concurrent GRNs each receiving remaining qty → exactly one succeeds, others 422 `OVER_RECEIPT`; `sum(grn_lines.qty) == po_lines.received_qty <= ordered_qty` |
| R2 | Same `Idempotency-Key` twice → one GRN, identical responses; same key different body → 422 |
| R3 | 50 concurrent PO creates → 50 unique sequential numbers, no gaps |
| R4 | Approve + edit in parallel → one wins, the other 409 |
| R5 | Reduce qty below received → 422; replace item on received line → 422 |
| R6 | Cancel vs receive race → never both succeed |
| Gateway | Inbound `x-tenant-id` header is stripped; request for another org's PO id returns 404 |
| Outbox | Kill broker mid-test → events published after broker returns; no duplicates in svc-audit |
| Inbox | Deliver same event 3× → one audit row |
| Health | `/health/ready` returns 503 when DB down |

---

## 0.12 Step 10 — Verification

- [ ] Existing PO create/edit/approve/issue/receive flows work through the gateway (manual script + automated)
- [ ] Tenant isolation: automated test logs in as Org A, iterates every legacy GET/PUT/DELETE route with Org B ids → all 404
- [ ] DB invariants query returns zero rows:
  ```sql
  SELECT l.id FROM po_lines l
  LEFT JOIN (SELECT po_line_id, sum(qty) q FROM grn_lines gl JOIN grns g ON g.id=gl.grn_id
             WHERE g.status <> 'CANCELLED' GROUP BY po_line_id) r ON r.po_line_id=l.id
  WHERE coalesce(r.q,0) <> l.received_qty OR l.received_qty > l.ordered_qty;
  ```
- [ ] Audit rows appear in `audit_db` for every PO/GRN action, with correlation ids matching gateway logs
- [ ] Grafana shows request rate/latency per route; a trace spans gateway → legacy-api

## 0.13 Step 11 — Regression
Run the recorded baseline suite. Pass count must be ≥ baseline; any newly failing test is a blocker.

---

## 0.14 Exit gate

- [ ] `current-architecture.md` and mapping tables complete and reviewed
- [ ] R1–R7 fixed with passing concurrency tests
- [ ] All infra services healthy via `docker compose up`; CI green
- [ ] Outbox/inbox proven end-to-end with failure injection
- [ ] ADR 0001–0005, 0009, 0010 merged
- [ ] No user-visible behaviour change except clearer errors and duplicate-submit protection
- [ ] **Approval recorded to start Phase 1**

## 0.15 Risks & open decisions
| Item | Decision needed |
|---|---|
| Legacy data violating new CHECK/UNIQUE constraints | Run pre-check queries on prod copy; data-fix scripts reviewed before constraints apply |
| Legacy token format incompatible with gateway verification | Adapter verifies legacy tokens until Phase 1 cut-over; set a removal date |
| VPS capacity for full stack | Measure baseline RAM; observability stack can run on the second server |
| RabbitMQ vs NATS | Default RabbitMQ; change only via ADR-0002 before any service consumes events |
