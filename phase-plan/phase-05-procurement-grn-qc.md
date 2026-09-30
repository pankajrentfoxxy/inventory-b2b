# Phase 5 — Procurement + GRN + QC (svc-procurement, svc-qc)

> Prerequisite: Phase 4 COMPLETE. Extracts PO/GRN from legacy-api into `svc-procurement`, introduces `svc-qc`, and connects both to the inventory ledger. After this phase **legacy-api owns nothing** and is scheduled for removal.

---

## 5.1 Goal & scope
- PO state machine with approval, issue, revision (re-approval), cancel, close
- GRN with warehouse, serial capture, documents; posts `RECEIPT` to inventory
- GRN cancellation saga (reversible only while stock is untouched in QC_HOLD)
- QC lots created from received stock; quantity-based and serial-based inspection; checklists; defects; attachments; decisions → `QC_PASS`/`QC_FAIL` postings
- PO receipt tracking & auto status (PARTIALLY_RECEIVED/RECEIVED/CLOSED)
- Backfill of legacy PO/GRN; gateway cut-over; legacy tables read-only

Out of scope: supplier bills (Phase 9), supplier returns (Phase 8).

---

## 5.2 Step 1 — Understand
- [ ] Legacy PO/GRN statuses → mapping table to new statuses
- [ ] Open legacy GRNs: have they been "QC'd" informally? Decide their opening bucket (default: AVAILABLE with an `OPENING` posting dated at go-live; flag as "pre-system QC")
- [ ] Attachments location in legacy (migrate to S3)

---

## 5.3 Step 2 — Business flow

```text
Supplier ─▶ PO DRAFT ─submit─▶ PENDING_APPROVAL ─approve─▶ APPROVED ─issue─▶ ISSUED
                  ▲                     │reject (→DRAFT, reason)          │
                  └──── revise (creates rev n+1, back to PENDING_APPROVAL) ◀┘ (only if no live GRN on changed lines)
ISSUED ─GRN─▶ PARTIALLY_RECEIVED ─GRN─▶ RECEIVED ─close─▶ CLOSED
PARTIALLY_RECEIVED ─short-close (reason)─▶ CLOSED      (remaining qty cancelled)
DRAFT | PENDING_APPROVAL | APPROVED | ISSUED(no live GRN) ─cancel─▶ CANCELLED

GRN: DRAFT ─receive─▶ RECEIVED ─(inventory posts RECEIPT)─▶ QC_PENDING ─(all lots decided)─▶ QC_COMPLETED
     RECEIVED/QC_PENDING ─cancel─▶ CANCELLATION_PENDING ─(inventory reversed)─▶ CANCELLED
                                                     └─(reversal refused: stock moved)─▶ back to QC_PENDING + reason
     RECEIVED ─(inventory rejects receipt, e.g. serial duplicate)─▶ POSTING_FAILED (fix & retry or cancel)

QC lot: OPEN ─start─▶ IN_INSPECTION ─decide(all units)─▶ DECIDED ─(inventory posted)─▶ CLOSED
```

### PO transition table
| From | Command | To | Permission | Guards |
|---|---|---|---|---|
| DRAFT | submit | PENDING_APPROVAL | purchase.create | ≥1 line; supplier ACTIVE; items ACTIVE; qty>0; price≥0 |
| PENDING_APPROVAL | approve | APPROVED | purchase.approve | approver ≠ creator (setting); amount ≤ approver limit (setting) |
| PENDING_APPROVAL | reject | DRAFT | purchase.approve | reason |
| APPROVED | issue | ISSUED | purchase.issue | — ; emails PO PDF to supplier |
| ISSUED/PARTIALLY_RECEIVED | revise | PENDING_APPROVAL (rev+1) | purchase.edit | new qty ≥ received; received lines' item/price immutable |
| DRAFT…ISSUED | cancel | CANCELLED | purchase.cancel | no GRN in non-CANCELLED state |
| PARTIALLY_RECEIVED | short-close | CLOSED | purchase.approve | reason |
| RECEIVED | close | CLOSED | system/auto or purchase.edit | all GRNs QC_COMPLETED (setting) |
Auto transitions ISSUED→PARTIALLY_RECEIVED→RECEIVED happen inside the GRN-receive transaction.

---

## 5.4 Step 3 — Architecture & choreography

```text
[svc-procurement]  receive GRN (tx: lock PO lines, validate, write GRN RECEIVED, update received_qty, outbox)
        │ procurement.grn.received.v1 {grnId, poId, warehouseId, lines[{itemId, qty, unitCost, serials[], grade?}]}
        ▼
[svc-inventory]  consumer: posting RECEIPT (EXT_SUPPLIER → QC_HOLD), creates serial_units (qc_status=PENDING)
        │ inventory.receipt.posted.v1  |  inventory.receipt.rejected.v1 {reason, duplicates[]}
        ├─────────────▶ [svc-procurement] GRN → QC_PENDING | POSTING_FAILED
        ▼
[svc-qc] consumer of inventory.receipt.posted.v1: create QC lot per GRN line (items requiring QC)
        │ inspector records results → decide
        │ qc.lot.decided.v1 {lotId, grnId, lines[{itemId, passQty, failQty, serials:[{serial, result, grade, defects[]}]}]}
        ▼
[svc-inventory] consumer: postings QC_PASS / QC_FAIL (idempotency key 'QC_LOT:<id>:DECISION'), updates serial qc_status/grade
        │ inventory.qc_posting.recorded.v1
        ├──▶ [svc-qc] lot → CLOSED
        └──▶ [svc-procurement] when all lots of GRN closed → GRN QC_COMPLETED; maybe PO → CLOSED
```

**Why RECEIPT is posted by event, not a sync call:** the GRN is the business fact; inventory posting is its consequence. Outbox guarantees delivery; idempotency key `GRN:<id>:RECEIPT` guarantees once. To avoid the common failure (duplicate serial) turning into an async error, procurement does a **sync pre-check** `POST /internal/v1/serials:check` before committing the GRN. `POSTING_FAILED` remains as a safety net for races.

**Items that skip QC:** product setting `qcRequired=false` (default true for serialized) → svc-qc auto-creates and auto-decides the lot as PASS with `inspector=system`, keeping one path through the ledger.

**GRN cancellation saga**
```text
procurement: GRN → CANCELLATION_PENDING, outbox grn.cancellation_requested
qc: if any unit already decided → emits qc.lot.cancellation_refused; else lot → CANCELLED, emits qc.lot.cancelled
inventory: on qc.lot.cancelled → posting RECEIPT_REVERSAL (QC_HOLD → EXT_SUPPLIER) if all qty/serials still in QC_HOLD
           → inventory.receipt.reversed | inventory.receipt.reversal_refused
procurement: CANCELLED (received_qty −= qty; PO status recomputed) | revert to QC_PENDING with reason
```

---

## 5.5 Step 4 — Database

### procurement_db
```sql
CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  number text NOT NULL, revision int NOT NULL DEFAULT 0,
  supplier_id uuid NOT NULL, supplier_snapshot jsonb NOT NULL,     -- name, gstin, billing addr, state_code
  ship_to_warehouse_id uuid NOT NULL, ship_to_snapshot jsonb NOT NULL,
  order_date date NOT NULL, expected_date date,
  payment_term_id uuid, currency char(3) NOT NULL DEFAULT 'INR',
  subtotal numeric(18,2) NOT NULL, tax_total numeric(18,2) NOT NULL, total numeric(18,2) NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','ISSUED',
                 'PARTIALLY_RECEIVED','RECEIVED','CLOSED','CANCELLED')),
  status_reason text,
  created_by uuid NOT NULL, submitted_at timestamptz, approved_by uuid, approved_at timestamptz,
  issued_at timestamptz, cancelled_at timestamptz, closed_at timestamptz,
  notes text, terms text,
  version int NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, number)
);

CREATE TABLE po_lines (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  po_id uuid NOT NULL REFERENCES purchase_orders(id),
  line_no int NOT NULL,
  item_id uuid NOT NULL, item_snapshot jsonb NOT NULL,              -- sku, name, hsn, unit, isSerialized
  ordered_qty numeric(18,3) NOT NULL CHECK (ordered_qty > 0),
  received_qty numeric(18,3) NOT NULL DEFAULT 0,
  cancelled_qty numeric(18,3) NOT NULL DEFAULT 0,
  unit_price numeric(18,4) NOT NULL CHECK (unit_price >= 0),
  discount_pct numeric(5,2) NOT NULL DEFAULT 0,
  tax_rate numeric(5,2) NOT NULL,
  line_total numeric(18,2) NOT NULL,
  UNIQUE (po_id, line_no),
  CHECK (received_qty >= 0 AND received_qty + cancelled_qty <= ordered_qty)
);

CREATE TABLE po_revisions (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, po_id uuid NOT NULL,
  revision int NOT NULL, snapshot jsonb NOT NULL, reason text NOT NULL, created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (po_id, revision));

CREATE TABLE po_approvals (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, po_id uuid NOT NULL,
  revision int NOT NULL, decision text NOT NULL CHECK (decision IN ('APPROVED','REJECTED')),
  actor_id uuid NOT NULL, comment text, decided_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE grns (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, number text NOT NULL,
  po_id uuid NOT NULL REFERENCES purchase_orders(id),
  supplier_id uuid NOT NULL, supplier_snapshot jsonb NOT NULL,
  warehouse_id uuid NOT NULL,
  received_date date NOT NULL,
  supplier_invoice_no text, supplier_invoice_date date, delivery_note_no text, vehicle_no text,
  status text NOT NULL CHECK (status IN ('DRAFT','RECEIVED','QC_PENDING','QC_COMPLETED',
                'POSTING_FAILED','CANCELLATION_PENDING','CANCELLED')),
  status_reason text, remarks text,
  idempotency_key uuid,
  created_by uuid NOT NULL, received_at timestamptz, cancelled_at timestamptz,
  version int NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, number),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE grn_lines (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  grn_id uuid NOT NULL REFERENCES grns(id), po_line_id uuid NOT NULL REFERENCES po_lines(id),
  item_id uuid NOT NULL, item_snapshot jsonb NOT NULL,
  qty numeric(18,3) NOT NULL CHECK (qty > 0),
  unit_cost numeric(18,4) NOT NULL,
  bin_id uuid, condition_note text
);

CREATE TABLE grn_line_serials (
  tenant_id uuid NOT NULL, grn_line_id uuid NOT NULL REFERENCES grn_lines(id),
  serial_no text NOT NULL, imei text,
  PRIMARY KEY (grn_line_id, serial_no)
);

CREATE TABLE document_attachments (id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  entity_type text NOT NULL, entity_id uuid NOT NULL, object_key text NOT NULL,
  file_name text NOT NULL, content_type text NOT NULL, size_bytes bigint NOT NULL,
  uploaded_by uuid NOT NULL, uploaded_at timestamptz NOT NULL DEFAULT now());
```
*Note:* there is deliberately **no tenant-wide unique index on GRN serials** in procurement. A serial can legitimately be received again (bought back after a sale, or re-received after a cancelled GRN). Serial uniqueness is owned by inventory (`serial_units`) and checked via the sync pre-check; the composite PK only prevents duplicates within one GRN line.

### qc_db
```sql
CREATE TABLE qc_checklists (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, name text NOT NULL,
  applies_to jsonb NOT NULL,                 -- {categoryIds:[], itemIds:[]}
  version int NOT NULL DEFAULT 1, status text NOT NULL DEFAULT 'ACTIVE');
CREATE TABLE qc_checklist_items (id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  checklist_id uuid NOT NULL REFERENCES qc_checklists(id), seq int NOT NULL, label text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('PASS_FAIL','NUMERIC','TEXT','PHOTO')),
  critical boolean NOT NULL DEFAULT false,   -- a critical FAIL fails the unit
  min_value numeric, max_value numeric);

CREATE TABLE qc_lots (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, number text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('GRN','CUSTOMER_RETURN','TRANSFER_IN','RTO')),
  source_id uuid NOT NULL, source_line_id uuid NOT NULL, source_number text,
  item_id uuid NOT NULL, item_snapshot jsonb NOT NULL, warehouse_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('QUANTITY','SERIAL')),
  qty numeric(18,3) NOT NULL, pass_qty numeric(18,3) NOT NULL DEFAULT 0, fail_qty numeric(18,3) NOT NULL DEFAULT 0,
  checklist_id uuid, checklist_version int,
  status text NOT NULL CHECK (status IN ('OPEN','IN_INSPECTION','DECIDED','CLOSED','CANCELLED')),
  inspector_id uuid, started_at timestamptz, decided_at timestamptz, decided_by uuid,
  version int NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, number),
  UNIQUE (tenant_id, source_type, source_line_id),       -- one lot per source line → no duplicate QC
  CHECK (pass_qty + fail_qty <= qty)
);

CREATE TABLE qc_unit_results (             -- serial mode: one row per serial; quantity mode: rows per sample
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, lot_id uuid NOT NULL REFERENCES qc_lots(id),
  serial_no text, result text NOT NULL CHECK (result IN ('PASS','FAIL')),
  grade_code text, defect_codes text[], remarks text,
  checklist_answers jsonb NOT NULL DEFAULT '{}',
  inspected_by uuid NOT NULL, inspected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lot_id, serial_no)
);
CREATE TABLE qc_defect_codes (tenant_id uuid NOT NULL, code text NOT NULL, description text NOT NULL,
  PRIMARY KEY (tenant_id, code));
-- attachments via document_attachments pattern (entity_type = 'QC_UNIT_RESULT')
```

---

## 5.6 Step 5 — API

### svc-procurement (`/api/v1`)
| Endpoint | Permission | Notes |
|---|---|---|
| `GET/POST /purchase-orders`, `GET /purchase-orders/{id}` | purchase.view / purchase.create | POST snapshots supplier/items via sync calls to party/master |
| `PATCH /purchase-orders/{id}` | purchase.edit | DRAFT only; `If-Match` |
| `POST /purchase-orders/{id}/submit|approve|reject|issue|revise|cancel|short-close|close` | per table | Idempotency-Key; reason where required |
| `GET /purchase-orders/{id}/pdf` | purchase.view | Generated, cached in S3 |
| `GET /purchase-orders/{id}/receivable-lines` | grn.create | remaining qty per line |
| `POST /grns` | grn.create | Creates DRAFT or directly RECEIVED (`?receive=true`); Idempotency-Key mandatory |
| `POST /grns/{id}/receive` | grn.create | DRAFT → RECEIVED |
| `POST /grns/{id}/cancel` | grn.cancel | reason |
| `POST /grns/{id}/retry-posting` | grn.create | POSTING_FAILED after correcting serials |
| `GET /grns`, `GET /grns/{id}` | grn.view | includes QC progress (from events) |
| `POST /attachments:presign` | owning entity permission | returns PUT URL |

GRN receive guards (same transaction as Phase 0 fix, now in the new service): PO ISSUED/PARTIALLY_RECEIVED; warehouse ACTIVE and within user's warehouse scope; `received_qty + qty ≤ ordered_qty − cancelled_qty` (tolerance % setting, default 0); serialized lines: serial count = qty, integer qty, pattern matched, no duplicates in request, pre-check clean.

### svc-qc (`/api/v1/qc`)
| Endpoint | Permission |
|---|---|
| `GET /lots?status=&warehouseId=&sourceType=` | qc.view |
| `GET /lots/{id}` (with checklist) | qc.view |
| `POST /lots/{id}/start` (assigns inspector) | qc.inspect |
| `PUT /lots/{id}/results` (upsert unit results; serial or sample) | qc.inspect |
| `POST /lots/{id}/decide` `{passQty, failQty}` (quantity mode) or derived from unit results (serial mode) | qc.approve |
| `POST /lots/{id}/reopen` (only before inventory posted) | qc.approve |
| checklists & defect codes CRUD | qc.manage |

Guards: decide requires every serial to have a result; FAIL requires ≥1 defect code; a critical checklist FAIL forces FAIL; qc cannot decide a lot whose source GRN is CANCELLATION_PENDING (lot status CANCELLED).

---

## 5.7 Step 6 — Events
| Event | Producer → Consumers | Idempotency |
|---|---|---|
| `procurement.po.submitted/approved/rejected/issued/revised/cancelled/closed.v1` | → notification, reporting, audit, master(references) | inbox |
| `procurement.grn.received.v1` | → inventory (RECEIPT), notification, reporting | posting key `GRN:<id>:RECEIPT` |
| `inventory.receipt.posted.v1` / `.rejected.v1` | → procurement (status), qc (create lots) | lot unique on source line |
| `qc.lot.decided.v1` | → inventory (QC_PASS/QC_FAIL), procurement, reporting, notification (if fail rate > threshold) | posting key `QC_LOT:<id>:DECISION` |
| `inventory.qc_posting.recorded.v1` | → qc (close lot), procurement (GRN QC_COMPLETED) | inbox |
| `procurement.grn.cancellation_requested.v1` → qc → `qc.lot.cancelled|cancellation_refused.v1` → inventory → `inventory.receipt.reversed|reversal_refused.v1` → procurement | saga | keys `GRN:<id>:REVERSAL` |

Saga timeout: if CANCELLATION_PENDING for > 10 min, alert (stuck saga) — do not auto-resolve.

---

## 5.8 Step 7 — Frontend
- **Purchase Orders:** list with status chips & "awaiting my approval" filter; editor with product typeahead, tax preview, totals; approval panel with history; revision diff view; PDF preview; receive progress bar per line.
- **GRN:** "Receive" from PO → pick warehouse → lines with remaining qty → serialized lines open a **serial capture panel** (barcode-scanner friendly: focus stays in input, Enter adds, duplicates highlighted instantly, paste-many supported, running count vs qty) → attachments (supplier invoice, delivery note) → submit. Status banner for POSTING_FAILED with the offending serials.
- **QC:** inspector work queue; lot screen: serial list with per-unit checklist, pass/fail toggle, grade, defect multi-select, photo upload from phone camera (mobile-responsive); quantity mode: pass/fail counts + sample results; decide button (qc.approve) with summary.
- UI shows "Posting to inventory…" state after decisions until the confirmation event arrives (poll GRN/lot status every 2 s, max 30 s).

---

## 5.9 Step 8 — Implementation order
1. svc-procurement schema; port legacy PO/GRN logic (with Phase 0 fixes) into state machines
2. Inventory consumers for RECEIPT and QC postings; serial pre-check endpoint
3. svc-qc schema, lot creation consumer, inspection APIs, decisions
4. GRN cancellation saga
5. Backfill: legacy POs/GRNs (preserve ids/numbers), open GRNs → OPENING postings per Step 1 decision; reconcile
6. Gateway cut-over; legacy PO/GRN tables write-revoked; legacy-sync consumers from Phase 3 removed
7. Frontend pages
8. Schedule `legacy-api` removal (next phase)

---

## 5.10 Step 9 — Tests
| Area | Tests |
|---|---|
| Over-receipt | concurrent GRNs → never exceed ordered; tolerance setting respected |
| Duplicate GRN | same Idempotency-Key → one GRN; double event delivery → one RECEIPT posting |
| Cancellation | cancel before QC → stock back to EXT_SUPPLIER, PO qty restored; cancel after QC decision → refused, GRN back to QC_PENDING |
| QC validity | decide without valid GRN/lot → 404/409; decide twice → one posting; reopen after posting → 409 |
| Failed items not sellable | after QC_FAIL, `availability` API excludes them; attempt to RESERVE rejected (Phase 6 test stub) |
| Serials | GRN serial duplicates (in request, in inventory) → 422; POSTING_FAILED path via forced race; serial history shows PO → GRN → QC |
| Ledger | after full flow, reconciliation zero mismatches; QC_HOLD equals sum of undecided lot qty |
| PO transitions | full matrix; revise below received → 422; received-line item swap → 422 |
| Authorization | executive cannot approve; approver limit enforced; scoped warehouse user can't receive into other warehouse |
| Tenant isolation | cross-tenant PO/GRN/lot access → 404; events with wrong tenant ignored by consumers (consumer asserts envelope tenant = entity tenant) |
| Failure recovery | inventory down during GRN → GRN RECEIVED, event retried, eventually QC_PENDING |

## 5.11 Step 10 — Verification
- [ ] End-to-end: PO 100 → GRN 100 → QC 96/4 → stock AVAILABLE 96, REJECTED 4, QC_HOLD 0; serial states consistent
- [ ] Audit trail: PO_CREATED … QC_APPROVED with actors
- [ ] Events traced end-to-end in Tempo under one correlation id

## 5.12 Exit gate
- [ ] Over-receiving impossible; duplicate GRN impossible; GRN cancellation reversible (when legal)
- [ ] QC cannot happen without valid GRN; QC-failed items cannot be sold
- [ ] Serial numbers captured correctly; inventory ledger correct
- [ ] Legacy PO/GRN write-disabled; backfill reconciled
- [ ] **Approval recorded to start Phase 6**
