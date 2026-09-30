# Phase 8 — Transfers + Returns (svc-inventory transfers, svc-returns)

> Prerequisite: Phase 7 COMPLETE. Adds the three remaining stock paths: warehouse ↔ warehouse, customer → us, us → supplier. Every one of them goes through QC or an explicit bucket rule — **returned goods never jump straight into AVAILABLE** when the product requires inspection.

---

## 8.1 Goal & scope
- **Warehouse transfer** (owned by svc-inventory): request → approve → dispatch → receive (with optional inspection) → short/excess handling
- **Customer return / RMA** (svc-returns): request → approve/reject → pickup → receive → QC → AVAILABLE / REJECTED; refund/replacement outcome recorded (financial effect in Phase 9/10)
- **Supplier return** (svc-returns): REJECTED stock → supplier return → dispatch → close; debit-note trigger for Phase 9
- **Scrap / write-off** of REJECTED stock (inventory adjustment type, approval required)
- **Re-grade**: REJECTED → AVAILABLE after refurbishment via a new QC lot (never a direct adjustment)

---

## 8.2 Step 1 — Understand
- [ ] Return window & reasons the business accepts; who pays reverse logistics
- [ ] Do transfers between warehouses in **different states** occur? (GST: an inter-state branch transfer between distinct GSTINs is a taxable supply needing a tax invoice; same-GSTIN movement uses a delivery challan) — Phase 9 dependency
- [ ] Refurbishment workflow for rejected units (in-house repair → re-QC?)

---

## 8.3 Step 2 — Business flows

### Warehouse transfer
```text
DRAFT ─submit─▶ PENDING_APPROVAL ─approve─▶ APPROVED
APPROVED ─dispatch─▶ IN_TRANSIT            ◀── TRANSFER_OUT: AVAILABLE@A → IN_TRANSIT (ref transfer)
IN_TRANSIT ─receive (full)─▶ RECEIVED       ◀── TRANSFER_IN:  IN_TRANSIT → AVAILABLE@B  (or QC_HOLD@B if inspectOnReceipt)
IN_TRANSIT ─receive (partial)─▶ PARTIALLY_RECEIVED ─resolve shortage─▶ CLOSED
      shortage resolution: LOSS (IN_TRANSIT → EXT_ADJUSTMENT, approval) | later receipt
DRAFT/PENDING/APPROVED ─cancel─▶ CANCELLED (no stock change)
```
Reservation option: on APPROVED, reserve source stock (`reservations.ref_type='TRANSFER'`) so sales cannot sell units already promised to the transfer.

### Customer return (RMA)
```text
Delivered SO line ─request─▶ REQUESTED ─approve─▶ APPROVED ─schedule pickup─▶ PICKUP_SCHEDULED
                         └─reject (reason)─▶ REJECTED                     │
PICKUP_SCHEDULED ─picked─▶ IN_TRANSIT ─receive at warehouse─▶ RECEIVED     ◀── RETURN_RECEIVE: DELIVERED(customer) → QC_HOLD
RECEIVED ─(QC lot source=CUSTOMER_RETURN decided)─▶ INSPECTED
      per unit: PASS → AVAILABLE (grade may change) | FAIL → REJECTED
INSPECTED ─resolve (REFUND | REPLACE | CREDIT_NOTE | REPAIR_AND_RETURN)─▶ CLOSED
```
Guards: return qty ≤ delivered − already returned per SO line; serial must be one delivered to **this** customer on **this** SO; within return window (tenant setting) unless overridden with `returns.approve.override`.
Note: IN_TRANSIT on the return leg is tracked on the RMA document, not the ledger — stock stays in `DELIVERED(customer)` until physically received, so the ledger never shows goods we can't touch.

### Supplier return
```text
REJECTED stock ─create─▶ DRAFT ─approve─▶ APPROVED ─dispatch─▶ DISPATCHED   ◀── SUPPLIER_RETURN_OUT: REJECTED@wh → EXT_SUPPLIER
DISPATCHED ─supplier acknowledges (credit/replacement)─▶ CLOSED
```
Default posts directly REJECTED → EXT_SUPPLIER at dispatch (goods have left our control). Tenants that need road visibility can enable a two-step REJECTED → IN_TRANSIT → EXT_SUPPLIER.
Guards: only REJECTED (or AVAILABLE with `returns.supplier.from_available` permission for commercial returns); supplier must match original GRN supplier for serialized units (warning if not).

---

## 8.4 Step 3 — Architecture
| Concern | Owner |
|---|---|
| Transfer documents + postings | svc-inventory (transfers are pure stock movements) |
| RMA, supplier return documents | svc-returns |
| Return inspection | svc-qc (lots with `source_type=CUSTOMER_RETURN` / `TRANSFER_IN`) |
| Stock postings | svc-inventory (sync calls from returns for receive/dispatch; QC decision via event as in Phase 5) |
| Refund / credit note / debit note | Phase 9/10 consume `returns.*` events |
| Pickups | svc-returns uses fulfillment's `CarrierAdapter` library (shared package code, no shared data) |

---

## 8.5 Step 4 — Database

### inventory_db (added)
```sql
CREATE TABLE transfers (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, number text NOT NULL,
  from_warehouse_id uuid NOT NULL, to_warehouse_id uuid NOT NULL,
  inspect_on_receipt boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','IN_TRANSIT',
          'PARTIALLY_RECEIVED','RECEIVED','CLOSED','CANCELLED')),
  carrier jsonb, eway_bill_no text, dispatched_at timestamptz, received_at timestamptz,
  created_by uuid NOT NULL, approved_by uuid, version int NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, number),
  CHECK (from_warehouse_id <> to_warehouse_id)
);
CREATE TABLE transfer_lines (id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  transfer_id uuid NOT NULL REFERENCES transfers(id), item_id uuid NOT NULL,
  qty numeric(18,3) NOT NULL CHECK (qty > 0), received_qty numeric(18,3) NOT NULL DEFAULT 0,
  lost_qty numeric(18,3) NOT NULL DEFAULT 0, serials text[],
  CHECK (received_qty + lost_qty <= qty));
```

### returns_db
```sql
CREATE TABLE customer_returns (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, number text NOT NULL,
  customer_id uuid NOT NULL, customer_snapshot jsonb NOT NULL,
  so_id uuid NOT NULL, so_number text NOT NULL,
  warehouse_id uuid NOT NULL,                 -- receiving warehouse
  reason_code text NOT NULL, customer_remarks text,
  requested_resolution text CHECK (requested_resolution IN ('REFUND','REPLACE','CREDIT_NOTE','REPAIR_AND_RETURN')),
  final_resolution text,
  status text NOT NULL CHECK (status IN ('REQUESTED','APPROVED','REJECTED','PICKUP_SCHEDULED','IN_TRANSIT',
         'RECEIVED','INSPECTED','CLOSED','CANCELLED')),
  status_reason text, pickup jsonb, received_at timestamptz,
  created_by uuid NOT NULL, approved_by uuid, version int NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, number)
);
CREATE TABLE customer_return_lines (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, return_id uuid NOT NULL REFERENCES customer_returns(id),
  so_line_id uuid NOT NULL, shipment_id uuid NOT NULL, item_id uuid NOT NULL, item_snapshot jsonb NOT NULL,
  qty numeric(18,3) NOT NULL CHECK (qty > 0), received_qty numeric(18,3) NOT NULL DEFAULT 0,
  pass_qty numeric(18,3) NOT NULL DEFAULT 0, fail_qty numeric(18,3) NOT NULL DEFAULT 0,
  unit_price numeric(18,4) NOT NULL,          -- snapshot for credit note
  serials text[], qc_lot_id uuid
);
CREATE TABLE returned_qty_ledger (           -- guards "return ≤ delivered − returned" under concurrency
  tenant_id uuid NOT NULL, so_line_id uuid NOT NULL,
  delivered_qty numeric(18,3) NOT NULL, returned_qty numeric(18,3) NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, so_line_id), CHECK (returned_qty <= delivered_qty)
);                                           -- fed by fulfillment.shipment.delivered.v1

CREATE TABLE supplier_returns (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, number text NOT NULL,
  supplier_id uuid NOT NULL, supplier_snapshot jsonb NOT NULL,
  warehouse_id uuid NOT NULL, grn_id uuid, po_id uuid,
  reason_code text NOT NULL, status text NOT NULL CHECK (status IN ('DRAFT','APPROVED','DISPATCHED','CLOSED','CANCELLED')),
  dispatch jsonb, supplier_ack jsonb, version int NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, number)
);
CREATE TABLE supplier_return_lines (id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  supplier_return_id uuid NOT NULL REFERENCES supplier_returns(id), item_id uuid NOT NULL, item_snapshot jsonb NOT NULL,
  source_bucket text NOT NULL CHECK (source_bucket IN ('REJECTED','AVAILABLE')),
  qty numeric(18,3) NOT NULL CHECK (qty > 0), unit_cost numeric(18,4) NOT NULL, serials text[]);
```

---

## 8.6 Step 5 — API
| Endpoint | Permission |
|---|---|
| `POST /inventory/transfers`, `/{id}/submit|approve|dispatch|receive|resolve-shortage|cancel` | transfer.create / transfer.approve / transfer.receive |
| `GET /inventory/transfers…` | transfer.view |
| `POST /returns/customer` (from SO/delivered lines), `/{id}/approve|reject|schedule-pickup|mark-picked|receive|resolve|cancel` | returns.create / returns.approve / returns.receive |
| `GET /returns/customer/eligible-lines?soId=` (delivered − returned) | returns.view |
| `POST /returns/supplier`, `/{id}/approve|dispatch|close|cancel` | returns.create / returns.approve |
| `POST /inventory/scrap` (REJECTED → EXT_SCRAP, approval) | inventory.adjust + inventory.adjust.approve |
| `POST /qc/lots:regrade` (creates lot for REJECTED units; PASS moves REJECTED → AVAILABLE) | qc.inspect |

All state-changing POSTs take `Idempotency-Key`. Error codes: `RETURN_QTY_EXCEEDS_DELIVERED`, `RETURN_SERIAL_NOT_DELIVERED_TO_CUSTOMER`, `RETURN_WINDOW_EXPIRED`, `TRANSFER_SAME_WAREHOUSE`, `TRANSFER_RECEIVE_EXCEEDS_SENT`, `SUPPLIER_RETURN_BUCKET_NOT_ALLOWED`.

---

## 8.7 Step 6 — Events
| Event | Consumers |
|---|---|
| `inventory.transfer.approved|dispatched|received|closed.v1` | qc (lot if inspect_on_receipt), reporting, notification |
| `returns.rma.requested|approved|rejected|received|inspected|closed.v1` | inventory (none — sync postings), qc (lot on received), billing (credit note on CLOSED with CREDIT_NOTE/REFUND), payment (refund), notification, reporting |
| `qc.lot.decided.v1` (source CUSTOMER_RETURN/TRANSFER_IN/RTO) | inventory (QC_PASS/FAIL), returns (INSPECTED) |
| `returns.supplier_return.dispatched|closed.v1` | billing (debit note), reporting |
| consumes `fulfillment.shipment.delivered.v1` | returns → `returned_qty_ledger` |

---

## 8.8 Step 7 — Frontend
- **Transfers:** create (from/to, lines with availability at source), approval, dispatch dialog, receive screen with scan & shortage reporting.
- **Customer returns:** start from SO detail ("Return items") or Returns list; eligible lines only; serial selection restricted to units delivered on that SO; pickup scheduling; receive with scan; outcome after QC; resolution picker.
- **Supplier returns:** start from Inventory → Rejected stock (grouped by supplier/GRN) → select units → approve → dispatch.
- **Rejected stock workspace:** actions per unit — supplier return, re-grade QC, scrap.
- Serial history timeline now includes transfer/return/supplier-return steps.

---

## 8.9 Step 8 — Implementation order
1. Inventory: TRANSFER_OUT/IN, RETURN_RECEIVE, SUPPLIER_RETURN_OUT, SCRAP postings (engine already supports; add allow-lists & serial rules)
2. Transfers (documents, reservation option, shortage)
3. svc-returns: RMA with returned-qty ledger; supplier returns
4. QC source types; re-grade flow
5. Frontend; events to billing stubs (consumed in Phase 9)

## 8.10 Step 9 — Tests
- No duplicate stock: transfer dispatch+receive retried → balances move once; on-hand at A+B unchanged except declared loss
- Return QC enforced: received return cannot be reserved/sold until QC PASS
- Serial history: sold serial returned, re-QC'd, resold to another customer → full chain visible; uniqueness intact
- Return guards: over-return (concurrent RMAs) blocked by `returned_qty_ledger` CHECK; wrong serial/customer → 422; expired window → 422 unless override permission
- Supplier return only from REJECTED (or permitted AVAILABLE); posting once
- Scrap requires approval; REJECTED → AVAILABLE only via re-grade QC lot
- Tenant isolation across all new documents

## 8.11 Step 10 — Verification
- [ ] Reconciliation zero mismatches after a scripted scenario covering every flow
- [ ] Serial-count invariant holds per bucket
- [ ] Audit trail for approvals/overrides

## 8.12 Exit gate
- [ ] No duplicate stock; serial history maintained; return QC enforced; tenant isolation
- [ ] Inter-state transfer tax treatment documented for Phase 9
- [ ] **Approval recorded to start Phase 9**
