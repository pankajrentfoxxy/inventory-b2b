# Multi-Tenant B2B Inventory Platform — Phase Plan

Master index and **shared architecture contract**. Every phase document refers back to this file. If a phase doc and this file disagree, this file wins until an ADR changes it.

---

## 1. How to use these documents

| File | Phase | One-line goal |
|---|---|---|
| `phase-00-architecture-foundation.md` | 0 | Monorepo, gateway, platform-kit, infra, legacy race-condition fixes, current→target mapping |
| `phase-01-platform-super-admin.md` | 1 | Auth service, Tenant service, Super Admin portal, tenant lifecycle |
| `phase-02-iam-rbac.md` | 2 | Memberships, invitations, roles, permissions, backend enforcement |
| `phase-03-master-data.md` | 3 | Master Data service + Party service (products, warehouses, suppliers, customers) |
| `phase-04-inventory-core.md` | 4 | Double-entry stock ledger, balances, buckets, serial units, adjustments |
| `phase-05-procurement-grn-qc.md` | 5 | Procurement + QC services; PO → GRN → QC → stock |
| `phase-06-sales-order-reservation.md` | 6 | Sales service; SO confirmation with atomic reservation |
| `phase-07-fulfillment-delivery.md` | 7 | Fulfillment service; DC → pack → dispatch → deliver |
| `phase-08-transfers-returns.md` | 8 | Warehouse transfers, customer returns, supplier returns |
| `phase-09-billing-gst.md` | 9 | Billing service; supplier bills, invoices, GST, credit/debit notes |
| `phase-10-payments.md` | 10 | Payment service; collection, allocation, reconciliation |
| `phase-11-reporting.md` | 11 | Reporting service; event-fed read models |
| `phase-12-production-hardening.md` | 12 | Security, resilience, observability, DR, performance |

**Execution rule:** one phase at a time. Each phase follows the 12-step contract (Understand → Business Flow → Architecture → Database → API → Events → Frontend → Implementation → Tests → Verification → Regression → Completion). Every phase doc ends with an **Exit Gate** — nothing in the next phase starts until every box is ticked and the phase is approved.

**Working with Claude Code:** give it this README + exactly one phase file per session. Tell it: *"Complete Step 1 (Understand) and Steps 2–7 as a written design first; wait for approval before Step 8."*

---

## 2. Assumed stack (verify in Phase 0, Step 1)

These assumptions keep the plan concrete. Phase 0 confirms or replaces them via ADRs.

| Concern | Choice | Why |
|---|---|---|
| Language/runtime | TypeScript, Node 20 LTS | Team already works in Node/React/Postgres |
| Service framework | NestJS (Fastify adapter) | Modules, guards, interceptors map cleanly to tenant/permission/idempotency concerns |
| ORM / migrations | Prisma per service (own `schema.prisma`, own migrations) | Already used across team projects; raw SQL for ledger hot paths |
| Database | PostgreSQL 16 — one cluster, **one database + one DB role per service** | Ownership enforced by grants, cheap to operate on a VPS |
| Messaging | RabbitMQ (topic exchange `domain.events`) + transactional outbox/inbox | Durable, simple ops, DLQ support; NATS JetStream is an acceptable alternative |
| Cache / rate limit / token state | Redis 7 | Tenant-status cache, permission-version, rate limits, idempotency fast path |
| Object storage | MinIO (S3-compatible) in dev/VPS, S3/R2 later | Section 37 requirement |
| Gateway | Nginx/Traefik (TLS) → `gateway` NestJS service (auth, tenant context, routing) | Business-aware edge; keeps services free of edge concerns |
| Frontend | React + Vite, TanStack Query, React Router; two apps: `web-admin` (/admin), `web-app` (/app) | Matches existing UI |
| Monorepo | pnpm workspaces + Turborepo | Same pattern as the team's other monorepos |
| Observability | OpenTelemetry → Tempo/Jaeger, Pino JSON logs → Loki, Prometheus + Grafana | Correlation across services |
| Deployment | Docker Compose on VPS first; images are Kubernetes-ready | Match current infra; no premature K8s |

---

## 3. Target service catalog

| # | Service (deployable) | Owns (source of truth) | Database | Introduced |
|---|---|---|---|---|
| 1 | `gateway` | Routing, edge auth verification, tenant-context injection, rate limits | none (Redis) | Phase 0 |
| 2 | `svc-auth` | Identities, credentials, sessions, refresh tokens, MFA, password reset, JWKS | `auth_db` | Phase 1 |
| 3 | `svc-tenant` | Platform vendors/tenants, lifecycle, tenant config, platform admins' platform ops | `tenant_db` | Phase 1 |
| 4 | `svc-iam` | Memberships, invitations, roles, permissions, permission versions | `iam_db` | Phase 2 |
| 5 | `svc-audit` | Centralized append-only `audit_events` | `audit_db` | Phase 1 (skeleton in 0) |
| 6 | `svc-notification` | Email/SMS/WhatsApp templates, delivery log | `notification_db` | Phase 1 (minimal) |
| 7 | `svc-master` | Products, categories, brands, units, HSN/tax, warehouses/locations/bins, payment terms, numbering config, custom fields, condition grades, warranty defaults | `master_db` | Phase 3 |
| 8 | `svc-party` | Suppliers, customers, contacts, addresses, GSTIN/tax identities | `party_db` | Phase 3 |
| 9 | `svc-inventory` | Stock ledger, balances, buckets, serial units, reservations, transfers, adjustments | `inventory_db` | Phase 4 |
| 10 | `svc-procurement` | POs, PO approvals/revisions, GRNs | `procurement_db` | Phase 5 (extracted from legacy) |
| 11 | `svc-qc` | Inspection lots, checklists, decisions, defects, attachments | `qc_db` | Phase 5 |
| 12 | `svc-sales` | Sales orders, SO lines, SO lifecycle | `sales_db` | Phase 6 |
| 13 | `svc-fulfillment` | Delivery challans, packing, shipments, tracking, POD | `fulfillment_db` | Phase 7 |
| 14 | `svc-returns` | Customer returns (RMA), supplier returns | `returns_db` | Phase 8 |
| 15 | `svc-billing` | Supplier bills, customer invoices, credit/debit notes, GST computation | `billing_db` | Phase 9 |
| 16 | `svc-payment` | Payments, allocations, gateway webhooks, reconciliation | `payment_db` | Phase 10 |
| 17 | `svc-reporting` | Read models / projections only (never source of truth) | `reporting_db` | Phase 11 (projections start earlier as needed) |
| — | `legacy-api` | Existing app — shrinks phase by phase (strangler fig) | existing DB | Phase 0 → retired after Phase 5 |

**Right-sizing note.** 16 services is a lot for a small team. The mitigations are deliberate: one shared `platform-kit` so each service is mostly domain code; one Postgres cluster; one broker; Docker Compose. Do **not** split further (no separate "reservation service", "serial service", "GRN service"). If ops load becomes a problem, the approved fallback is to co-host two services in one Node process **while keeping separate modules, DB roles and databases** — never by merging schemas.

---

## 4. Monorepo layout

```text
/apps
  gateway/
  svc-auth/  svc-tenant/  svc-iam/  svc-audit/  svc-notification/
  svc-master/  svc-party/
  svc-inventory/  svc-procurement/  svc-qc/
  svc-sales/  svc-fulfillment/  svc-returns/
  svc-billing/  svc-payment/  svc-reporting/
  legacy-api/            # existing backend, moved as-is in Phase 0
  web-admin/             # Super Admin portal  (/admin)
  web-app/               # Vendor portal       (/app)
/packages
  contracts/             # event schemas (zod + JSON Schema), OpenAPI specs, generated TS clients
  platform-kit/          # NestJS modules: tenant-context, auth-guard, permission-guard,
                         # idempotency, outbox, inbox, errors, logger, health, config, db-tenant
  ui-kit/                # shared React components, PermissionGate, data table, form primitives
  test-kit/              # tenant fixtures, JWT minting for tests, testcontainers helpers
  eslint-config/  tsconfig/
/infra
  docker-compose.yml  docker-compose.override.yml
  postgres/init/        # creates <svc>_db + <svc>_role with grants to own DB only
  rabbitmq/definitions.json
  observability/
/docs
  adr/                  # ADR-0001 ... one per architectural decision
  phases/               # these files
```

**Shared-code rule:** `packages/*` may contain infrastructure and contracts only. **No domain logic in shared packages.** If two services need the same business rule, one service owns it and the other calls it.

---

## 5. Cross-cutting contracts (apply to every phase)

### 5.1 Identity & tenant context

Access token: JWT, RS256, 10-minute expiry, signed by `svc-auth`, public keys at `/.well-known/jwks.json`.

```json
{
  "sub": "usr_01J...",          // global user id
  "typ": "tenant",              // "tenant" | "platform"
  "tid": "ten_01J...",          // tenant id (absent for platform tokens)
  "mid": "mem_01J...",          // membership id
  "perms": ["purchase.view", "purchase.create"],
  "pv": 7,                      // permission version for this membership
  "sid": "ses_01J...",          // session id (revocation)
  "iat": 0, "exp": 0, "aud": "b2b-inventory", "iss": "svc-auth"
}
```

Rules:
1. `tenant_id`, `user_id`, `role`, `permissions` are **never** read from request bodies, query strings or client headers. The gateway strips any inbound `x-tenant-id`, `x-user-id`, `x-perms`.
2. Gateway verifies the JWT, checks `tenant-status:{tid}` in Redis (must be `ACTIVE`), checks `permver:{mid}` equals `pv`, checks `session-revoked:{sid}` absent, then forwards the original bearer token plus `x-correlation-id`.
3. **Every service re-verifies the JWT** (defence in depth) via `platform-kit/auth-guard` and builds a request-scoped `TenantContext { tenantId, userId, membershipId, permissions, correlationId }`.
4. Platform tokens (`typ=platform`) can only call `/platform/*` routes; tenant tokens can never call `/platform/*`.
5. Service-to-service calls use a short-lived **service token** (client-credentials from `svc-auth`, `typ=service`, `aud=<target>`) **plus** an explicit `x-on-behalf-of-tenant` header that the target accepts only from service tokens.

### 5.2 Tenant isolation at the database

- Every tenant-owned table has `tenant_id uuid NOT NULL` as the **first column of every index and unique constraint**.
- Every repository method takes `tenantId` from `TenantContext` — there is no repository method without it (lint rule in `platform-kit`).
- **Postgres Row-Level Security** is enabled on tenant-owned tables as a second net:
  ```sql
  ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON purchase_orders
    USING (tenant_id = current_setting('app.tenant_id')::uuid);
  ```
  `platform-kit/db-tenant` runs `SET LOCAL app.tenant_id = $1` at the start of every transaction. The service DB role is not a superuser and not `BYPASSRLS`.
- Loading any entity by id is always `WHERE id = $1 AND tenant_id = $2`. A miss returns **404, not 403** (do not reveal existence).

### 5.3 IDs, numbers, time, money, quantity

| Concern | Rule |
|---|---|
| Primary keys | UUIDv7 (sortable). Public prefixes in APIs are optional (`po_…`) |
| Document numbers | Per tenant, per document type, per financial year (Apr–Mar). Series config in `svc-master`; **generation is local to the owning service** using a `number_series` row locked `FOR UPDATE` (gap-free) |
| Timestamps | `timestamptz`, stored UTC, rendered IST in UI |
| Money | `numeric(18,2)` + `currency char(3)` default `INR`; rates `numeric(9,4)`; never floats |
| Quantity | `numeric(18,3)`; serialized items must be whole numbers (CHECK + service validation) |
| Optimistic concurrency | Every aggregate root has `version int NOT NULL DEFAULT 0` |
| Soft delete | Master data: `status` (ACTIVE/INACTIVE/ARCHIVED). Business documents: never deleted, only CANCELLED |

### 5.4 Snapshot rule (critical for microservices)

Business documents **snapshot** the reference data they depend on at creation time: supplier/customer name, GSTIN, billing/shipping address, item name, SKU, HSN, tax rate, UOM. They store the reference id **and** the snapshot. They never join live to another service's data to render a historical document.

### 5.5 Error format

```json
{
  "error": {
    "code": "PO_INVALID_TRANSITION",
    "message": "Purchase order PO-2026-0042 cannot be approved from status DRAFT.",
    "details": [{ "field": "status", "issue": "expected PENDING_APPROVAL" }],
    "correlationId": "c0f1…",
    "retryable": false
  }
}
```

| HTTP | Used for |
|---|---|
| 400 | Malformed request / schema validation (`VALIDATION_FAILED`) |
| 401 | Missing/invalid/expired token (`UNAUTHENTICATED`) |
| 403 | Authenticated but lacks permission (`FORBIDDEN`), tenant not active (`TENANT_NOT_ACTIVE`) |
| 404 | Not found **or belongs to another tenant** |
| 409 | State conflict: invalid transition, version mismatch, idempotency in progress |
| 422 | Business rule violation (`INSUFFICIENT_STOCK`, `OVER_RECEIPT`, `IDEMPOTENCY_KEY_REUSED`) |
| 429 | Rate limited |
| 503 | Dependency unavailable (`retryable: true`) |

Error codes are `UPPER_SNAKE`, prefixed by domain, and listed in `packages/contracts/errors.ts`.

### 5.6 Idempotency

- All creating/transitioning `POST` endpoints accept `Idempotency-Key` (UUID). Mandatory on: GRN create, QC decision, SO create/confirm, reservation, dispatch, delivery, return receipt, invoice, payment.
- Table in each service DB:
  ```sql
  CREATE TABLE idempotency_keys (
    tenant_id     uuid        NOT NULL,
    scope         text        NOT NULL,          -- e.g. 'POST /grns'
    key           uuid        NOT NULL,
    request_hash  char(64)    NOT NULL,          -- sha256 of canonical body
    status        text        NOT NULL,          -- IN_PROGRESS | COMPLETED
    response_code int,
    response_body jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,          -- +24h
    PRIMARY KEY (tenant_id, scope, key)
  );
  ```
- Same key + same hash + COMPLETED → replay stored response. Same key + different hash → `422 IDEMPOTENCY_KEY_REUSED`. Same key + IN_PROGRESS → `409`.
- **Natural idempotency beats keys:** where a business key exists (e.g. one reservation per SO line), enforce it with a unique constraint as well.

### 5.7 State machines

- No endpoint accepts `status` in a body. Transitions are commands: `POST /purchase-orders/{id}/approve`.
- Each aggregate declares its transition table in code (`from`, `command`, `to`, `permission`, `guards[]`, `emits`).
- Transition SQL is a conditional update:
  ```sql
  UPDATE purchase_orders
     SET status = 'APPROVED', version = version + 1, approved_by = $4, approved_at = now()
   WHERE id = $1 AND tenant_id = $2 AND status = 'PENDING_APPROVAL' AND version = $3;
  -- 0 rows → 409 (stale version or invalid transition)
  ```
- Every transition in one DB transaction: guard checks → state change → audit event → outbox event.

### 5.8 Events — envelope, outbox, inbox

```json
{
  "eventId": "01J…",                        // UUIDv7, globally unique
  "eventType": "procurement.grn.received",  // domain.aggregate.pastTenseVerb
  "eventVersion": 1,
  "occurredAt": "2026-10-01T09:30:00Z",
  "tenantId": "ten_…",
  "producer": "svc-procurement",
  "correlationId": "…",
  "causationId": "…",                       // eventId or request id that caused this
  "actor": { "type": "user", "id": "usr_…" },
  "aggregate": { "type": "grn", "id": "…", "version": 3 },
  "payload": { }
}
```

- **Outbox (producer):** event row inserted into `outbox_events` in the **same transaction** as the state change. A relay (in-process worker, `FOR UPDATE SKIP LOCKED`, 200 ms poll) publishes to exchange `domain.events` with routing key = `eventType.v{eventVersion}`, then marks `published_at`.
- **Inbox (consumer):** `processed_events (consumer text, event_id uuid, PRIMARY KEY(consumer, event_id))` inserted in the same transaction as the consumer's side effects → exactly-once *effect* on top of at-least-once delivery.
- **Ordering:** do not rely on broker ordering. Consumers check `aggregate.version` where order matters and park out-of-order events for retry.
- **Retry:** 3 delayed retries (10 s, 60 s, 10 min) via retry queues, then `…dlq`. DLQ replay tool arrives in Phase 12; DLQ alerting from Phase 0.
- **Schema evolution:** additive changes keep the version; breaking changes publish `v2` alongside `v1` until all consumers migrate.
- The business names in the brief (`GRN_CREATED`, `QC_PASSED`, …) map to routing keys as listed in each phase doc.

### 5.9 Sync vs async

| Use a **synchronous** API call when | Use an **event** when |
|---|---|
| The caller cannot proceed without the answer (reserve stock before confirming an SO; consume reservation at dispatch) | Downstream reactions (notify, audit, project into reports, create a QC lot) |
| A validation must be authoritative right now (serial duplicate check) | Cross-service state that can lag by seconds |

Sync calls: 3 s timeout, retries only on idempotent calls (with the same `Idempotency-Key`), circuit breaker (`opossum`), typed clients generated from OpenAPI in `packages/contracts`.

### 5.10 Audit

Every service emits `audit.recorded` events through its outbox for important actions; `svc-audit` stores them append-only.

```text
audit_events(id, tenant_id NULL for platform, actor_type, actor_id, action, entity_type, entity_id,
             old_value jsonb, new_value jsonb, reason, ip, user_agent, correlation_id, occurred_at)
```

Action names: `PO_CREATED`, `PO_APPROVED`, `GRN_CREATED`, `QC_APPROVED`, `STOCK_RESERVED`, `USER_ROLE_CHANGED`, `TENANT_SUSPENDED`, … No per-module activity tables. `old_value/new_value` store only changed fields.

### 5.11 Files

All attachments go to S3-compatible storage under `tenants/{tenantId}/{service}/{entity}/{uuid}`. Uploads use pre-signed PUT URLs issued by the owning service after permission checks; downloads use pre-signed GET URLs (5-minute expiry) issued only after object-level authorization. No local filesystem storage.

### 5.12 API conventions

- Base paths: `/api/v1/<resource>` for tenant APIs, `/api/v1/platform/<resource>` for platform APIs, `/internal/v1/<resource>` for service-to-service (not routed by the gateway).
- Lists: cursor pagination `?limit=50&cursor=…`, `?sort=-createdAt`, filters as query params, max limit 200.
- Every request validated by zod/class-validator; route params validated as UUIDs.
- OpenAPI spec per service is the contract; frontend clients are generated.

---

## 6. Inventory buckets (canonical)

| Bucket | Physical in our warehouse? | Sellable? | Meaning |
|---|---|---|---|
| `QC_HOLD` | Yes | No | Received (GRN, return, transfer-in with inspection), awaiting QC |
| `AVAILABLE` | Yes | Yes | Passed QC |
| `RESERVED` | Yes | No (allocated) | Held for a confirmed SO |
| `REJECTED` | Yes | No | Failed QC; awaiting supplier return / scrap / refurb |
| `IN_TRANSIT` | No (on the road) | No | Dispatched to customer, transfer between warehouses, return to supplier |
| `DELIVERED` | No (with customer) | No | Customer received — terminal for the sale |

Virtual counterparty buckets make the ledger double-entry (every posting nets to zero): `EXT_SUPPLIER`, `EXT_CUSTOMER` (≡ DELIVERED), `EXT_ADJUSTMENT`, `EXT_OPENING`, `EXT_SCRAP`. **On-hand = QC_HOLD + AVAILABLE + RESERVED + REJECTED.** Details in Phase 4.

---

## 7. Event catalog (all phases)

| Business name | Routing key | Producer | Main consumers | Phase |
|---|---|---|---|---|
| TENANT_CREATED/APPROVED/ACTIVATED/SUSPENDED/REACTIVATED/DEACTIVATED | `tenant.tenant.<verb>.v1` | tenant | gateway cache, auth, iam, notification, audit | 1 |
| USER_INVITED / MEMBERSHIP_ACTIVATED / MEMBER_SUSPENDED | `iam.membership.<verb>.v1` | iam | auth, notification, audit | 2 |
| ROLE_CHANGED / PERMISSIONS_CHANGED | `iam.role.<verb>.v1` | iam | auth (session refresh), audit | 2 |
| PRODUCT_CREATED/UPDATED/ARCHIVED | `master.product.<verb>.v1` | master | inventory, procurement, sales, reporting | 3 |
| WAREHOUSE_CREATED/UPDATED | `master.warehouse.<verb>.v1` | master | inventory, reporting | 3 |
| SUPPLIER_*/CUSTOMER_* | `party.<supplier\|customer>.<verb>.v1` | party | procurement, sales, billing, reporting | 3 |
| STOCK_POSTED | `inventory.posting.recorded.v1` | inventory | reporting, audit | 4 |
| PO_SUBMITTED/APPROVED/ISSUED/CANCELLED/CLOSED | `procurement.po.<verb>.v1` | procurement | notification, reporting, billing | 5 |
| GRN_CREATED (received) | `procurement.grn.received.v1` | procurement | inventory, qc, notification | 5 |
| GRN_CANCELLATION_REQUESTED | `procurement.grn.cancellation_requested.v1` | procurement | qc (then inventory via `qc.lot.cancelled.v1`) | 5 |
| QC_LOT_CANCELLED / CANCELLATION_REFUSED | `qc.lot.cancelled.v1` / `qc.lot.cancellation_refused.v1` | qc | inventory, procurement | 5 |
| RECEIPT_REVERSED / REVERSAL_REFUSED | `inventory.receipt.reversed.v1` / `.reversal_refused.v1` | inventory | procurement | 5 |
| STOCK_RECEIVED / RECEIPT_REJECTED | `inventory.receipt.<posted\|rejected>.v1` | inventory | procurement, qc | 5 |
| QC_PASSED / QC_FAILED (decision) | `qc.lot.decided.v1` | qc | inventory, procurement, returns | 5 |
| QC_POSTING_RECORDED | `inventory.qc_posting.recorded.v1` | inventory | qc (close lot), procurement (GRN QC_COMPLETED) | 5 |
| SO_CONFIRMED / SO_CANCELLED | `sales.so.<verb>.v1` | sales | fulfillment, notification, reporting | 6 |
| STOCK_RESERVED / RESERVATION_RELEASED | `inventory.reservation.<verb>.v1` | inventory | sales, reporting | 6 |
| DC_CREATED / PACKED | `fulfillment.dc.<verb>.v1` | fulfillment | sales, notification | 7 |
| STOCK_DISPATCHED | `fulfillment.shipment.dispatched.v1` | fulfillment | sales, billing, notification | 7 |
| DELIVERY_COMPLETED | `fulfillment.shipment.delivered.v1` | fulfillment | sales, billing, notification | 7 |
| TRANSFER_* | `inventory.transfer.<verb>.v1` | inventory | reporting | 8 |
| RETURN_* / RETURN_RECEIVED | `returns.rma.<verb>.v1` | returns | inventory, qc, billing | 8 |
| SUPPLIER_RETURN_DISPATCHED | `returns.supplier_return.dispatched.v1` | returns | billing (debit note) | 8 |
| INVOICE_ISSUED / BILL_POSTED / CREDIT_NOTE_ISSUED | `billing.<doc>.<verb>.v1` | billing | payment, reporting | 9 |
| PAYMENT_RECEIVED / PAYMENT_ALLOCATED | `payment.payment.<verb>.v1` | payment | billing, reporting | 10 |
| AUDIT_RECORDED | `audit.recorded.v1` | all | audit | 0+ |

---

## 8. Strangler-fig migration map

| Existing module (legacy) | Target service | Extracted in | Until then |
|---|---|---|---|
| Authentication | `svc-auth` | Phase 1 | Legacy login keeps working; gateway accepts both token types via adapter |
| Organization | `svc-tenant` (tenant) + `svc-iam` (memberships) | Phase 1–2 | Organizations migrated as `ACTIVE` tenants |
| Items | `svc-master` | Phase 3 | Legacy owns items |
| Settings / master data | `svc-master` | Phase 3 | Legacy owns |
| Suppliers | `svc-party` | Phase 3 | Legacy owns |
| Purchase Orders | `svc-procurement` | Phase 5 | Legacy owns; race conditions fixed in Phase 0 |
| Purchase Receives / GRN | `svc-procurement` | Phase 5 | Legacy owns; race conditions fixed in Phase 0 |

Each extraction follows the same five steps: (1) new service built behind the gateway, (2) one-time backfill from legacy DB with verification counts/checksums, (3) gateway route switched, (4) legacy tables made read-only (revoke write grants), (5) legacy code removed one phase later.

---

## 9. Definition of Done (every phase)

- [ ] Design (Steps 2–7) written in the phase doc's "Decisions" section and approved
- [ ] Migrations reversible or with a documented forward-fix; applied in staging
- [ ] Every new endpoint: authenticated, permission-checked, tenant-scoped, validated, documented in OpenAPI
- [ ] Every state change: transactional, audited, event emitted via outbox where required
- [ ] Tests: unit, integration (testcontainers Postgres + RabbitMQ), contract tests for new events/APIs, tenant-isolation tests, concurrency tests for stock/document writes
- [ ] Coverage ≥ 80% on domain modules; 100% of transition table rows tested (allowed + one disallowed each)
- [ ] Regression: full suite green; legacy flows still work
- [ ] Dashboards/alerts updated for new services
- [ ] ADRs committed for any decision that changed this README
- [ ] Phase marked COMPLETE only after the Exit Gate checklist in the phase doc passes

---

## 10. ADR backlog (to be written in Phase 0 unless noted)

| ADR | Decision |
|---|---|
| 0001 | Microservices with database-per-service on a shared Postgres cluster |
| 0002 | RabbitMQ + transactional outbox/inbox |
| 0003 | JWT (RS256) with embedded permissions + permission-version revocation |
| 0004 | Gateway strips identity headers; services re-verify tokens |
| 0005 | RLS as defence-in-depth for tenant isolation |
| 0006 | Double-entry stock ledger with virtual counterparty buckets (Phase 4) |
| 0007 | Serial allocation at reservation time (Phase 6) |
| 0008 | Inventory valuation method — weighted average per item per warehouse (Phase 4, confirm with finance) |
| 0009 | Local document numbering with gap-free series |
| 0010 | Strangler-fig extraction order |
