# Phase 4 — Inventory Core (svc-inventory)

> Prerequisite: Phase 3 COMPLETE. **Critical phase.** Every later phase moves stock only by calling this service. Get the ledger right here and the rest of the system inherits correctness.

---

## 4.1 Goal & scope

**In scope**
- Double-entry stock ledger (`stock_postings` + `stock_movements`)
- Materialised balances (`stock_balances`) updated atomically with the ledger
- Canonical buckets + virtual counterparty buckets
- Serial units + serial history
- Posting engine API (internal) with idempotency and deterministic locking
- Opening stock (manual + CSV import)
- Inventory adjustments (with approval for large deltas)
- Bin-level placement & bin-to-bin moves within a warehouse
- Cost capture on inbound movements (valuation groundwork)
- Stock views: balances, ledger, serial lookup/history
- Reconciliation jobs (ledger ↔ balance, serial count ↔ balance)

**Out of scope:** reservations (engine hooks exist; business API in Phase 6), transfers between warehouses (Phase 8), QC/GRN integration (Phase 5).

---

## 4.2 Step 1 — Understand
- [ ] Does legacy maintain any quantity on items (e.g. `items.stock_qty`)? Document it — it will be **retired**, not synced
- [ ] Existing received-but-unconsumed GRNs → they become opening balances in `QC_HOLD` or `AVAILABLE` (decide with business in Step 2)
- [ ] Serial data captured anywhere today?

---

## 4.3 Step 2 — Business flow & ledger model

### Buckets
Physical (count toward on-hand): `QC_HOLD`, `AVAILABLE`, `RESERVED`, `REJECTED`
Moving/outside: `IN_TRANSIT`, `DELIVERED`
Virtual counterparties (never have a warehouse balance you can read as stock): `EXT_SUPPLIER`, `EXT_CUSTOMER`, `EXT_OPENING`, `EXT_ADJUSTMENT`, `EXT_SCRAP`

> `DELIVERED` is modelled as a real bucket keyed to the **customer** (not a warehouse) for traceability; counterparties exist so that **every posting sums to zero**. If the sum isn't zero, the posting is rejected. Stock can't appear or vanish — it always comes from somewhere.

### Posting types (the only way stock changes)
| Posting type | Lines (qty per unit) | Phase used |
|---|---|---|
| `OPENING` | EXT_OPENING −q → AVAILABLE (or QC_HOLD) +q | 4 |
| `ADJUSTMENT_IN` / `ADJUSTMENT_OUT` | EXT_ADJUSTMENT ∓ ↔ bucket ± | 4 |
| `BIN_MOVE` | bucket@binA −q → bucket@binB +q | 4 |
| `RECEIPT` | EXT_SUPPLIER −q → QC_HOLD +q | 5 |
| `QC_PASS` / `QC_FAIL` | QC_HOLD −q → AVAILABLE/REJECTED +q | 5 |
| `RECEIPT_REVERSAL` | QC_HOLD −q → EXT_SUPPLIER +q | 5 |
| `RESERVE` / `RELEASE` | AVAILABLE ↔ RESERVED | 6 |
| `DISPATCH` | RESERVED −q → IN_TRANSIT +q | 7 |
| `DELIVER` | IN_TRANSIT −q → DELIVERED(customer) +q | 7 |
| `RTO_RECEIVE` | IN_TRANSIT −q → QC_HOLD +q | 7 |
| `TRANSFER_OUT` / `TRANSFER_IN` | AVAILABLE@A → IN_TRANSIT → AVAILABLE/QC_HOLD@B | 8 |
| `RETURN_RECEIVE` | DELIVERED(customer) −q → QC_HOLD +q | 8 |
| `SUPPLIER_RETURN_OUT` | REJECTED −q → IN_TRANSIT → EXT_SUPPLIER | 8 |
| `SCRAP` | REJECTED −q → EXT_SCRAP +q | 8 |

Phase 4 implements the engine for **all** types (it's generic), but only exposes OPENING, ADJUSTMENT and BIN_MOVE to users. Other posting types are callable only by the owning services' service tokens, each allow-listed (e.g. only `svc-qc`… see §4.6).

### Allowed bucket transitions (engine guard)
```text
EXT_OPENING → AVAILABLE | QC_HOLD
EXT_SUPPLIER → QC_HOLD             QC_HOLD → AVAILABLE | REJECTED | EXT_SUPPLIER
AVAILABLE ↔ RESERVED               AVAILABLE → IN_TRANSIT (transfer)
RESERVED → IN_TRANSIT              IN_TRANSIT → DELIVERED | QC_HOLD | AVAILABLE(transfer-in) | EXT_SUPPLIER
DELIVERED → QC_HOLD (return)       REJECTED → IN_TRANSIT (supplier return) | EXT_SCRAP | AVAILABLE (re-grade, permission)
EXT_ADJUSTMENT ↔ AVAILABLE | QC_HOLD | REJECTED   (never RESERVED/IN_TRANSIT)
```
Any other pair → `INV_ILLEGAL_BUCKET_TRANSITION`. **Nothing ever goes QC_HOLD → RESERVED or REJECTED → RESERVED.**

### Worked example (brief §17)
| Step | Posting | EXT_SUPPLIER | QC_HOLD | AVAILABLE | RESERVED | REJECTED | IN_TRANSIT | DELIVERED |
|---|---|---|---|---|---|---|---|---|
| GRN 100 | RECEIPT | −100 | 100 | | | | | |
| QC 96 pass | QC_PASS | | 4 | 96 | | | | |
| QC 4 fail | QC_FAIL | | 0 | 96 | | 4 | | |
| SO 10 | RESERVE | | | 86 | 10 | 4 | | |
| Dispatch | DISPATCH | | | 86 | 0 | 4 | 10 | |
| Delivered | DELIVER | | | 86 | 0 | 4 | 0 | 10 |
On-hand after delivery = 0 + 86 + 0 + 4 = **90** — deducted exactly once (at dispatch it left the warehouse; delivery only moves it from road to customer).

---

## 4.4 Step 3 — Architecture

svc-inventory owns: postings, movements, balances, serial units, serial events, adjustments, (Phase 6) reservations, (Phase 8) transfers, local replicas `item_ref`, `warehouse_ref`, `bin_ref`.

No other service writes stock. Other services call:
`POST /internal/v1/postings` with a **posting request** (type, reference, lines, serials, idempotency key). The engine validates and commits atomically, then emits `inventory.posting.recorded.v1`.

---

## 4.5 Step 4 — Database (`inventory_db`)

```sql
CREATE TYPE bucket AS ENUM ('QC_HOLD','AVAILABLE','RESERVED','REJECTED','IN_TRANSIT','DELIVERED',
  'EXT_SUPPLIER','EXT_CUSTOMER','EXT_OPENING','EXT_ADJUSTMENT','EXT_SCRAP');

CREATE TABLE stock_postings (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  posting_type text NOT NULL,
  ref_type text NOT NULL,                  -- 'GRN','QC_LOT','SO','SHIPMENT','ADJUSTMENT','OPENING',...
  ref_id uuid NOT NULL,
  ref_number text,                         -- human doc number snapshot
  idempotency_key text NOT NULL,           -- e.g. 'GRN:<id>:RECEIPT'
  requested_by_service text NOT NULL,
  actor_id uuid,
  reversal_of uuid REFERENCES stock_postings(id),
  posted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)      -- duplicate posting impossible
);

CREATE TABLE stock_movements (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  posting_id uuid NOT NULL REFERENCES stock_postings(id),
  line_no int NOT NULL,
  item_id uuid NOT NULL,
  warehouse_id uuid,                       -- NULL for EXT_* and DELIVERED
  bin_id uuid,
  party_id uuid,                           -- customer for DELIVERED, supplier for EXT_SUPPLIER
  bucket bucket NOT NULL,
  qty numeric(18,3) NOT NULL CHECK (qty <> 0),   -- signed
  unit_cost numeric(18,4),                 -- required on RECEIPT/OPENING/ADJUSTMENT_IN
  grade_code text,                         -- condition grade (serialized refurbished stock)
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (posting_id, line_no)
);
CREATE INDEX mv_item_wh ON stock_movements (tenant_id, item_id, warehouse_id, created_at);
CREATE INDEX mv_ref ON stock_movements (tenant_id, posting_id);
-- stock_movements and stock_postings are APPEND-ONLY: runtime role has INSERT/SELECT only (no UPDATE/DELETE grant)

CREATE TABLE stock_balances (
  tenant_id uuid NOT NULL,
  item_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  bin_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',  -- "unbinned"
  bucket bucket NOT NULL,
  qty numeric(18,3) NOT NULL DEFAULT 0,
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, item_id, warehouse_id, bin_id, bucket),
  CHECK (bucket IN ('QC_HOLD','AVAILABLE','RESERVED','REJECTED','IN_TRANSIT')),
  CHECK (qty >= 0)                         -- no negative stock (tenant override = separate ADR)
);
-- DELIVERED balances per customer live in customer_stock_balances (same shape, party_id instead of warehouse)

CREATE TABLE serial_units (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  item_id uuid NOT NULL,
  serial_no text NOT NULL,
  imei text,
  bucket bucket NOT NULL,
  warehouse_id uuid, bin_id uuid, party_id uuid,
  grade_code text,
  qc_status text NOT NULL DEFAULT 'PENDING' CHECK (qc_status IN ('PENDING','PASSED','FAILED')),
  unit_cost numeric(18,4),
  po_id uuid, grn_id uuid, qc_lot_id uuid, so_id uuid, reservation_id uuid, dc_id uuid, shipment_id uuid,
  warranty_policy_id uuid, warranty_start date, warranty_end date,
  version bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX serial_uq ON serial_units (tenant_id, item_id, upper(serial_no));
CREATE UNIQUE INDEX imei_uq   ON serial_units (tenant_id, imei) WHERE imei IS NOT NULL;
CREATE INDEX serial_lookup    ON serial_units (tenant_id, upper(serial_no));
CREATE INDEX serial_pick      ON serial_units (tenant_id, item_id, warehouse_id, bucket, grade_code);

CREATE TABLE serial_events (             -- full history, append-only
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  serial_unit_id uuid NOT NULL REFERENCES serial_units(id),
  posting_id uuid NOT NULL REFERENCES stock_postings(id),
  from_bucket bucket, to_bucket bucket NOT NULL,
  warehouse_id uuid, bin_id uuid, party_id uuid,
  ref_type text NOT NULL, ref_id uuid NOT NULL, ref_number text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX serial_events_unit ON serial_events (tenant_id, serial_unit_id, occurred_at);

CREATE TABLE inventory_adjustments (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, number text NOT NULL,
  warehouse_id uuid NOT NULL,
  reason_code text NOT NULL CHECK (reason_code IN ('COUNT_CORRECTION','DAMAGE','LOSS','FOUND','OPENING','OTHER')),
  notes text,
  status text NOT NULL CHECK (status IN ('DRAFT','PENDING_APPROVAL','POSTED','CANCELLED')),
  posting_id uuid REFERENCES stock_postings(id),
  created_by uuid NOT NULL, approved_by uuid, posted_at timestamptz,
  version int NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, number)
);
CREATE TABLE inventory_adjustment_lines (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  adjustment_id uuid NOT NULL REFERENCES inventory_adjustments(id),
  item_id uuid NOT NULL, bin_id uuid, bucket bucket NOT NULL,
  qty_delta numeric(18,3) NOT NULL CHECK (qty_delta <> 0),
  unit_cost numeric(18,4), serial_numbers text[]
);

CREATE TABLE item_cost (                  -- weighted average cost per item per warehouse (ADR-0008)
  tenant_id uuid NOT NULL, item_id uuid NOT NULL, warehouse_id uuid NOT NULL,
  avg_cost numeric(18,4) NOT NULL, qty_basis numeric(18,3) NOT NULL,
  PRIMARY KEY (tenant_id, item_id, warehouse_id)
);
```

### Posting engine algorithm (single transaction, `READ COMMITTED`)
```text
BEGIN
 1. INSERT stock_postings (… idempotency_key) ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING id
      → no row: SELECT existing posting, verify same payload hash → return it (idempotent replay)
 2. Validate: every line's item is trackInventory; sum(qty) per item = 0; bucket pairs allowed;
      serialized items: count(serials) == |qty| per line, integer quantities
 3. Lock balances in DETERMINISTIC ORDER (item_id, warehouse_id, bin_id, bucket) — prevents deadlocks:
      INSERT … ON CONFLICT DO NOTHING for missing rows, then
      SELECT … FROM stock_balances WHERE (…) ORDER BY … FOR UPDATE
 4. For each negative line: UPDATE stock_balances SET qty = qty + :delta, version = version+1
                                 WHERE pk = … AND qty + :delta >= 0
      → 0 rows ⇒ ROLLBACK, 422 INSUFFICIENT_STOCK {item, warehouse, bucket, available, requested}
    Positive lines: UPDATE … SET qty = qty + :delta
 5. Serials: SELECT serial_units WHERE id IN (…) ORDER BY id FOR UPDATE;
      assert each serial's current bucket/warehouse == line's source; UPDATE bucket/location/refs; version+1
      new serials (RECEIPT/OPENING): INSERT — unique index guarantees no duplicates (23505 → 422 SERIAL_DUPLICATE)
      re-entry: a RECEIPT for a serial whose existing unit sits in DELIVERED / EXT_SUPPLIER / EXT_SCRAP
        (buy-back, re-purchase) REUSES that unit (history continues) instead of failing; any other state → SERIAL_DUPLICATE
      INSERT serial_events
 6. INSERT stock_movements (all lines)
 7. Update item_cost on inbound-with-cost lines (weighted average)
 8. INSERT outbox inventory.posting.recorded.v1 (+ audit.recorded)
COMMIT
```
Hot-row contention (many postings on one item/warehouse) is bounded by keeping the transaction short: no network calls inside it.

---

## 4.6 Step 5 — API

### Internal (service token; allow-list per posting type)
| Endpoint | Allowed callers |
|---|---|
| `POST /internal/v1/postings` | per type: RECEIPT/RECEIPT_REVERSAL → procurement consumer path (engine runs inside inventory's own consumer; see Phase 5); QC_* → inventory's QC consumer; RESERVE/RELEASE → sales (Phase 6); DISPATCH/DELIVER/RTO → fulfillment (Phase 7); RETURN/SUPPLIER_RETURN/SCRAP → returns (Phase 8) |
| `GET /internal/v1/items/{id}/has-movements` | master |
| `POST /internal/v1/serials:check` `{itemId, serials[]}` → `{duplicates[], invalidPattern[]}` | procurement (pre-check at GRN) |
| `GET /internal/v1/availability?itemIds=&warehouseId=` | sales |

### Tenant-facing (`/api/v1/inventory`)
| Endpoint | Permission | Notes |
|---|---|---|
| `GET /stock?warehouseId=&itemId=&bucket=&q=` | `inventory.view` | Pivot: one row per item×warehouse with columns per bucket + on-hand |
| `GET /stock/{itemId}` | `inventory.view` | By warehouse, by bin, by grade |
| `GET /ledger?itemId=&warehouseId=&from=&to=&refType=` | `inventory.view` | Movements with running balance |
| `GET /serials?q=&itemId=&bucket=&warehouseId=` | `inventory.view` | Search by serial/IMEI |
| `GET /serials/{id}` / `GET /serials/{id}/history` | `inventory.view` | Timeline: PO → GRN → QC → … |
| `POST /opening-stock` (JSON) / `POST /opening-stock/import` (CSV, async job with per-row results) | `inventory.adjust` | Allowed only when item has no movements in that warehouse |
| `POST /adjustments` → DRAFT; `POST /adjustments/{id}/submit`; `/approve`; `/cancel` | `inventory.adjust` / `inventory.adjust.approve` | Auto-post if |value| < tenant threshold, else PENDING_APPROVAL |
| `POST /bin-moves` | `inventory.transfer` | Same warehouse, same bucket |

Error codes: `INSUFFICIENT_STOCK`, `INV_ILLEGAL_BUCKET_TRANSITION`, `INV_UNBALANCED_POSTING`, `SERIAL_DUPLICATE`, `SERIAL_NOT_IN_EXPECTED_STATE`, `SERIAL_COUNT_MISMATCH`, `INV_NON_INTEGER_SERIALIZED_QTY`, `INV_ITEM_NOT_STOCKED`, `INV_POSTING_KEY_CONFLICT` (same key, different payload).

---

## 4.7 Step 6 — Events
| Event | Payload (summary) | Consumers |
|---|---|---|
| `inventory.posting.recorded.v1` | postingId, type, ref, lines[{item, warehouse, bucket, qty, cost}], serials[] | reporting, master (references), audit |
| `inventory.adjustment.posted.v1` | adjustment summary | audit, notification (if large) |
| `inventory.stock.low.v1` | item, warehouse, available, reorderLevel | notification (Phase 11 dashboards) |
| consumes `master.product.*`, `master.warehouse.*`, `master.bin.*` | → local refs | — |

---

## 4.8 Step 7 — Frontend (`web-app` → Inventory)
- **Stock:** grid with bucket columns (QC Hold, Available, Reserved, Rejected, In Transit) + On-hand; filters; click-through to item stock detail.
- **Stock ledger:** filter by item/warehouse/date/reference; running balance; each row links to its source document.
- **Serial numbers:** search box (serial/IMEI) → serial card with current state and vertical history timeline.
- **Adjustments:** create (warehouse → lines with bucket, ±qty, reason; serial picker for serialized items), approval queue.
- **Opening stock:** wizard + CSV import with downloadable error report.
- Empty state for new tenants: "No stock yet — record opening stock or receive a PO."

---

## 4.9 Step 8 — Implementation order
1. Schema + enum + grants (append-only enforcement)
2. Local ref consumers (items, warehouses, bins)
3. Posting engine + unit tests (pure validation) + integration tests (locking)
4. Serial units + events
5. Opening stock, adjustments, bin moves
6. Read APIs + UI
7. Reconciliation jobs (nightly + on-demand), exposed as `GET /internal/v1/reconciliation/report`

## 4.10 Step 9 — Tests
| Test | Assertion |
|---|---|
| Ledger = balance | For random 10k postings, `SUM(movements.qty) GROUP BY key` equals `stock_balances.qty` for every key |
| Postings balance | Every posting's `SUM(qty) GROUP BY item` = 0 |
| Concurrency | 50 parallel postings each taking 1 from AVAILABLE=20 → exactly 20 succeed, balance 0, never negative |
| Deadlock | Postings touching items (A,B) and (B,A) in parallel → no deadlock (deterministic lock order) |
| Idempotency | Same key twice → one posting; same key different payload → 422 |
| Serial uniqueness | Parallel opening stock with same serial → one succeeds |
| Serial state | Adjusting out a serial not in the bucket → 422 |
| Serial count invariant | For serialized items, `count(serial_units) GROUP BY item, warehouse, bucket` = balance qty |
| Illegal transitions | Every non-allowed pair rejected |
| Tenant isolation | Tenant A cannot read Tenant B serial by id or by serial number search; RLS test with raw SQL under Tenant A setting |
| Append-only | Runtime role `UPDATE stock_movements` → permission denied |
| Service allow-list | sales service token trying `QC_PASS` → 403 |

## 4.11 Step 10 — Verification
- [ ] Reconciliation report: zero mismatches after test suite and after a 30-minute randomized soak
- [ ] Ledger UI running balance equals stock grid
- [ ] Audit entries for adjustments with approver

## 4.12 Exit gate
- [ ] Ledger balances match stock; concurrent operations safe; duplicate movement impossible
- [ ] Serial uniqueness; tenant isolation; no negative stock
- [ ] ADR-0006 (double-entry) and ADR-0008 (valuation) merged
- [ ] **Approval recorded to start Phase 5**

## 4.13 Open decisions
| Decision | Default |
|---|---|
| Allow negative stock per tenant? | No. Changing it needs an ADR and a separate CHECK strategy |
| Valuation method | Weighted average per item per warehouse; FIFO layers only if finance requires |
| Serial uniqueness scope | Per tenant + item (same serial string on different models allowed); IMEI unique per tenant |
| Adjustment approval threshold | Tenant setting; default ₹25,000 absolute value per adjustment |
