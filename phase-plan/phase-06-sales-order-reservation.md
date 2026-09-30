# Phase 6 — Sales Order + Reservation (svc-sales, reservations in svc-inventory)

> Prerequisite: Phase 5 COMPLETE (sellable AVAILABLE stock exists). Sales owns the order; **Inventory owns the reservation**. An SO is CONFIRMED only if the reservation succeeded.

---

## 6.1 Goal & scope
- Sales orders (DRAFT → CONFIRMED → PARTIALLY_FULFILLED → FULFILLED; CANCELLED)
- Customer validation (ACTIVE, not BLOCKED; credit check hook — warn-only until Phase 10)
- Pricing: line price, discount, GST preview (authoritative tax computed in Phase 9)
- Availability check (live) and atomic all-or-nothing reservation of all lines
- Serialized allocation at reservation time (ADR-0007), with grade filter and optional specific serials
- Line edits after confirmation via reservation adjust (increase/decrease/swap serial)
- Cancellation releases reservations
- Orphan-reservation sweeper
- Legacy-api decommission (moved here because Phase 5 completes the extraction)

Out of scope: backorders (explicitly not supported unless decided), quotations, price lists (open decision), invoices (Phase 9).

---

## 6.2 Step 1 — Understand
- [ ] Any existing sales/customer data in legacy? (Brief says none)
- [ ] How the business sells refurbished units: by model + grade, or by specific serial the customer picked? (drives allocation UI)
- [ ] Is partial fulfilment allowed per SO? (default yes)

---

## 6.3 Step 2 — Business flow

```text
Customer ─▶ SO DRAFT (lines: item, warehouse, qty, grade?, price, discount)
             │ confirm
             ▼
   validate customer ACTIVE, items ACTIVE & trackInventory (services lines skip reservation)
             ▼
   sync call Inventory: POST /internal/v1/reservations  (all lines, all-or-nothing, Idempotency-Key 'SO:<id>:CONFIRM:<version>')
        ├─ success → SO CONFIRMED (stores reservationId per line, allocated serials)
        └─ INSUFFICIENT_STOCK → SO stays DRAFT, UI shows shortfall per line
CONFIRMED ─(first dispatch)─▶ PARTIALLY_FULFILLED ─(all qty delivered)─▶ FULFILLED
DRAFT | CONFIRMED (nothing dispatched) ─cancel─▶ CANCELLED  → reservations RELEASED (RESERVED → AVAILABLE)
CONFIRMED with partial dispatch ─short-close─▶ FULFILLED (remaining reservation released)
```

### SO transition table
| From | Command | To | Permission | Guards |
|---|---|---|---|---|
| — | create | DRAFT | sales.create | customer ACTIVE |
| DRAFT | edit | DRAFT | sales.edit | `If-Match` |
| DRAFT | confirm | CONFIRMED | sales.confirm | lines valid; reservation success; credit check (warn/block per setting) |
| CONFIRMED | amend-lines | CONFIRMED | sales.edit | per-line: new qty ≥ dispatched qty; reservation adjust succeeds |
| CONFIRMED | cancel | CANCELLED | sales.cancel | nothing dispatched; release succeeds |
| CONFIRMED/PARTIALLY_FULFILLED | (events from fulfillment) | PARTIALLY_FULFILLED / FULFILLED | system | — |
| PARTIALLY_FULFILLED | short-close | FULFILLED | sales.cancel | reason; release remainder |

### Reservation rules
- `AVAILABLE ≥ requested` per (item, warehouse[, grade]) or the **whole** request fails — no partial reservations.
- Serialized: reservation picks concrete serials (FIFO by receipt date within grade) unless the SO line specifies serials; units move AVAILABLE→RESERVED individually so the serial-count invariant (Phase 4) holds.
- One active reservation per SO line — unique constraint.
- **Never** reserve from QC_HOLD or REJECTED (engine transition guard).

---

## 6.4 Step 3 — Architecture

| Concern | Owner |
|---|---|
| SO document, pricing, status | svc-sales |
| Reservation records, AVAILABLE↔RESERVED postings, serial allocation | svc-inventory |
| Customer snapshot | svc-party (sync at create/confirm) |
| Availability read | svc-inventory `GET /internal/v1/availability` (sync, for UI hints — not a guarantee) |

**Consistency between confirm and reservation (no distributed transaction):**
```text
sales: BEGIN; SELECT so FOR UPDATE; assert DRAFT & version; COMMIT (short)   -- or mark CONFIRMING
sales → inventory: POST reservations (Idempotency-Key SO:<id>:CONFIRM:<v>)   -- atomic inside inventory
sales: BEGIN; UPDATE so SET status=CONFIRMED … WHERE status IN ('DRAFT','CONFIRMING') AND version=v; outbox; COMMIT
failure after reservation, before commit → client/ job retries confirm → same key → same reservation → commit
never-committed SO with active reservation → sweeper (every 5 min): reservations ACTIVE, age > 10 min,
   sales says SO not CONFIRMED (GET /internal/v1/sales-orders/{id}/status) → RELEASE
```
Intermediate status `CONFIRMING` (internal, shown as "Confirming…") prevents two concurrent confirm attempts.

---

## 6.5 Step 4 — Database

### sales_db
```sql
CREATE TABLE sales_orders (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, number text NOT NULL,
  customer_id uuid NOT NULL, customer_snapshot jsonb NOT NULL,   -- name, gstin, gst_treatment
  billing_address jsonb NOT NULL, shipping_address jsonb NOT NULL,
  place_of_supply char(2) NOT NULL,                              -- from shipping state; drives IGST/CGST+SGST
  order_date date NOT NULL, expected_ship_date date,
  customer_po_ref text, payment_term_id uuid, salesperson_id uuid,
  currency char(3) NOT NULL DEFAULT 'INR',
  subtotal numeric(18,2) NOT NULL, discount_total numeric(18,2) NOT NULL DEFAULT 0,
  tax_total_preview numeric(18,2) NOT NULL, total_preview numeric(18,2) NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT','CONFIRMING','CONFIRMED','PARTIALLY_FULFILLED','FULFILLED','CANCELLED')),
  status_reason text,
  confirmed_at timestamptz, confirmed_by uuid, cancelled_at timestamptz,
  created_by uuid NOT NULL, notes text,
  version int NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, number)
);

CREATE TABLE so_lines (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  so_id uuid NOT NULL REFERENCES sales_orders(id), line_no int NOT NULL,
  item_id uuid NOT NULL, item_snapshot jsonb NOT NULL,
  warehouse_id uuid,                               -- null for services
  grade_code text,
  requested_serials text[],                        -- optional customer-chosen units
  qty numeric(18,3) NOT NULL CHECK (qty > 0),
  reserved_qty numeric(18,3) NOT NULL DEFAULT 0,
  dispatched_qty numeric(18,3) NOT NULL DEFAULT 0,
  delivered_qty numeric(18,3) NOT NULL DEFAULT 0,
  cancelled_qty numeric(18,3) NOT NULL DEFAULT 0,
  unit_price numeric(18,4) NOT NULL CHECK (unit_price >= 0),
  discount_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  tax_rate numeric(5,2) NOT NULL,
  warranty_policy_id uuid,
  reservation_id uuid,
  UNIQUE (so_id, line_no),
  CHECK (dispatched_qty <= qty - cancelled_qty AND delivered_qty <= dispatched_qty)
);
```

### inventory_db (added)
```sql
CREATE TABLE reservations (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  ref_type text NOT NULL CHECK (ref_type IN ('SO','TRANSFER')),
  ref_id uuid NOT NULL, ref_line_id uuid NOT NULL, ref_number text,
  item_id uuid NOT NULL, warehouse_id uuid NOT NULL, grade_code text,
  qty_reserved numeric(18,3) NOT NULL CHECK (qty_reserved > 0),
  qty_consumed numeric(18,3) NOT NULL DEFAULT 0,       -- dispatched
  qty_released numeric(18,3) NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('ACTIVE','PARTIALLY_CONSUMED','CONSUMED','RELEASED')),
  request_group_id uuid NOT NULL,                      -- all lines of one confirm call
  created_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 0,
  CHECK (qty_consumed + qty_released <= qty_reserved)
);
CREATE UNIQUE INDEX one_active_reservation_per_line
  ON reservations (tenant_id, ref_type, ref_line_id) WHERE status IN ('ACTIVE','PARTIALLY_CONSUMED');

CREATE TABLE reservation_serials (
  tenant_id uuid NOT NULL, reservation_id uuid NOT NULL REFERENCES reservations(id),
  serial_unit_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('ALLOCATED','CONSUMED','RELEASED')),
  PRIMARY KEY (reservation_id, serial_unit_id)
);
CREATE UNIQUE INDEX serial_single_allocation ON reservation_serials (tenant_id, serial_unit_id)
  WHERE status = 'ALLOCATED';                          -- a unit can't be allocated twice
```

### Serial pick query (inside the reservation transaction)
```sql
SELECT id FROM serial_units
 WHERE tenant_id=$1 AND item_id=$2 AND warehouse_id=$3 AND bucket='AVAILABLE'
   AND ($4::text IS NULL OR grade_code=$4)
 ORDER BY created_at, id
 LIMIT $5
 FOR UPDATE SKIP LOCKED;          -- concurrent SOs pick different units instead of blocking
-- fewer rows than requested → INSUFFICIENT_STOCK (whole request rolls back)
```

---

## 6.6 Step 5 — API

### svc-sales (`/api/v1/sales-orders`)
| Endpoint | Permission | Notes |
|---|---|---|
| `GET /`, `GET /{id}` | sales.view | includes per-line reserved/dispatched/delivered |
| `POST /` | sales.create | Idempotency-Key; snapshots customer/items |
| `PATCH /{id}` | sales.edit | DRAFT only, `If-Match` |
| `POST /{id}/confirm` | sales.confirm | Idempotency-Key; 422 `INSUFFICIENT_STOCK` with `details[{lineNo, available, requested}]` |
| `POST /{id}/amend-lines` | sales.edit | CONFIRMED; triggers reservation adjust |
| `POST /{id}/cancel` | sales.cancel | reason |
| `POST /{id}/short-close` | sales.cancel | reason |
| `GET /availability?itemId=&warehouseId=&grade=` | sales.view | proxied, hint only |
| `GET /internal/v1/sales-orders/{id}/status` | service | for sweeper |

### svc-inventory (internal)
| Endpoint | Caller | Semantics |
|---|---|---|
| `POST /internal/v1/reservations` | sales | `{requestGroupId, refType:'SO', refId, lines[{refLineId, itemId, warehouseId, grade?, qty, serials?}]}` → all-or-nothing; returns reservations + allocated serials |
| `POST /internal/v1/reservations/{id}/adjust` | sales | `{newQty}` or `{swap:{from, to}}` |
| `POST /internal/v1/reservations:release` | sales | `{refType, refId, lineIds?}` — idempotent |
| `GET /internal/v1/reservations?refType=&refId=` | sales, fulfillment | |

Tenant-facing read: `GET /api/v1/inventory/reservations?itemId=&warehouseId=` (inventory.view) — "what is holding my stock".

Error codes: `SO_INVALID_TRANSITION`, `SO_CUSTOMER_BLOCKED`, `SO_CREDIT_LIMIT_EXCEEDED` (if blocking), `INSUFFICIENT_STOCK`, `RESERVATION_EXISTS`, `SERIAL_NOT_AVAILABLE`, `SO_QTY_BELOW_DISPATCHED`.

---

## 6.7 Step 6 — Events
| Event | Producer → Consumers |
|---|---|
| `sales.so.created|confirmed|amended|cancelled|short_closed.v1` | → fulfillment (create DC eligibility), notification (order confirmation to customer), reporting, audit |
| `inventory.reservation.created|adjusted|released.v1` | → sales (reconcile reserved_qty), reporting, audit (`STOCK_RESERVED`) |
| consumes `fulfillment.shipment.dispatched.v1` / `delivered.v1` (Phase 7) | sales updates dispatched/delivered qty & status |
| consumes `party.customer.blocked.v1` | sales blocks confirmation of DRAFTs for that customer |

---

## 6.8 Step 7 — Frontend
- **Sales Orders list:** status chips, "Needs attention" (confirm failed, partial), filters by customer/date/warehouse.
- **SO editor:** customer picker (shows GST treatment, credit usage), shipping address selector, line grid with live availability badge per line (Available / Short by N), grade selector for serialized items, optional "Pick specific units" drawer listing AVAILABLE serials with grade/QC summary; tax preview; totals.
- **Confirm:** on failure keep user on the form, highlight short lines with available qty and a "Reduce to available" action.
- **SO detail:** reservation panel (reserved serials), fulfilment progress per line, timeline (audit).
- **Inventory → Reservations:** who is holding stock, age, link to SO; release (permission `inventory.reserve`) for orphan cleanup.

---

## 6.9 Step 8 — Implementation order
1. Inventory reservation tables, engine support for RESERVE/RELEASE with serial allocation, internal APIs
2. svc-sales schema, state machine, confirm orchestration, sweeper
3. Event consumers both ways
4. Frontend
5. **Decommission legacy-api:** confirm zero traffic for 7 days in gateway metrics → remove route → archive legacy DB (read-only snapshot retained)

---

## 6.10 Step 9 — Tests
| Test | Assertion |
|---|---|
| Unavailable | AVAILABLE=5, SO=10 → 422, SO DRAFT, no reservation rows, balances unchanged |
| Atomic multi-line | line1 OK, line2 short → nothing reserved |
| Concurrency | AVAILABLE=10; 20 parallel SOs of 1 → exactly 10 CONFIRMED; RESERVED=10; AVAILABLE=0 |
| Serial concurrency | parallel SOs never share a serial (`serial_single_allocation`) |
| Duplicate reservation | confirm called twice / retried → one reservation per line |
| Cancellation | cancel CONFIRMED → RESERVED→AVAILABLE, serials back to AVAILABLE, reservation RELEASED |
| Orphan | kill sales after reservation, before commit → sweeper releases within 15 min; or retry confirms with same reservation |
| Amend | increase qty (stock available/not), decrease qty, swap serial; below dispatched → 422 |
| QC stock | stock in QC_HOLD/REJECTED never reservable |
| Authorization & isolation | standard matrix; Tenant A cannot reserve Tenant B stock even with forged ids via service call (service asserts `x-on-behalf-of-tenant` matches entity tenant) |

## 6.11 Step 10 — Verification
- [ ] Reconciliation: `SUM(reservations.qty_reserved − consumed − released WHERE active)` = RESERVED balance per item/warehouse
- [ ] Serial states match reservation_serials
- [ ] Audit `STOCK_RESERVED`, `SO_CONFIRMED`, `SO_CANCELLED`

## 6.12 Exit gate
- [ ] Cannot reserve unavailable stock; reservation atomic; cancellation releases; duplicate reservation impossible
- [ ] Serialized stock allocated correctly
- [ ] legacy-api removed from the gateway
- [ ] ADR-0007 merged
- [ ] **Approval recorded to start Phase 7**

## 6.13 Open decisions
| Decision | Default |
|---|---|
| Backorders | Not supported |
| Price lists / customer-specific pricing | Manual price per line; price list service later |
| Credit limit | Warn only until Phase 10 provides outstanding balances |
| Reservation expiry for unconfirmed quotes | N/A (no quotes) |
