# Phase 7 — Delivery / Fulfillment (svc-fulfillment)

> Prerequisite: Phase 6 COMPLETE. Fulfillment owns Delivery Challans, packing, shipments, tracking and proof of delivery. **Only dispatch and delivery move stock**, each exactly once, through inventory postings.

---

## 7.1 Goal & scope
- Delivery Challan (DC) from one or more confirmed SO lines (same customer, same warehouse, same ship-to)
- Packing: pick & verify exact serials (scan), packages, weights/dimensions
- Dispatch: consume reservation → `DISPATCH` posting (RESERVED → IN_TRANSIT)
- Tracking: carrier, AWB, status updates (manual first; carrier integrations as adapters)
- Out for delivery → Delivered with POD (receiver name, phone, signature/photo/document) → `DELIVER` posting (IN_TRANSIT → DELIVERED)
- Delivery failure / RTO → `RTO_RECEIVE` posting (IN_TRANSIT → QC_HOLD) + QC lot
- E-way bill data capture (generation integration optional)
- DC/packing slip PDFs

Out of scope: invoices (Phase 9), customer returns after delivery (Phase 8).

---

## 7.2 Step 1 — Understand
- [ ] Which carriers are used (courier aggregators, own fleet)? Start with a `MANUAL` carrier adapter
- [ ] Does one shipment always equal one DC? (default yes)
- [ ] **GST compliance check with the tenant's CA:** for an outright sale of goods, a **tax invoice** normally has to accompany the goods at removal; a delivery challan alone is permitted only for specific cases (e.g. goods sent on approval, job work, stock transfer between own branches). If that applies to the tenant, Phase 9 must issue the invoice **at dispatch**, not after delivery. This phase emits the events needed for either policy (see §7.7)

---

## 7.3 Step 2 — Business flow

```text
Confirmed SO ─create DC (select lines/qty)─▶ DC DRAFT ─release─▶ READY_TO_PACK
READY_TO_PACK ─pack (scan serials, packages)─▶ PACKED
PACKED ─dispatch (carrier, AWB, e-way bill no.)─▶ DISPATCHED      ◀── stock: RESERVED → IN_TRANSIT
DISPATCHED ─mark out for delivery─▶ OUT_FOR_DELIVERY
OUT_FOR_DELIVERY ─deliver (POD)─▶ DELIVERED                          ◀── stock: IN_TRANSIT → DELIVERED(customer)
DISPATCHED | OUT_FOR_DELIVERY ─delivery failed─▶ DELIVERY_FAILED ─reattempt─▶ OUT_FOR_DELIVERY
DELIVERY_FAILED ─RTO initiated─▶ RTO_IN_TRANSIT ─RTO received at warehouse─▶ RTO_RECEIVED  ◀── stock: IN_TRANSIT → QC_HOLD (+ QC lot)
DRAFT | READY_TO_PACK | PACKED ─cancel─▶ CANCELLED                    (no stock change; reservation remains with SO)
```

### Transition table
| From | Command | To | Permission | Guards | Stock |
|---|---|---|---|---|---|
| — | create | DRAFT | dispatch.create | SO CONFIRMED/PARTIALLY_FULFILLED; qty ≤ reserved − already on open DCs | none |
| DRAFT | release | READY_TO_PACK | dispatch.create | | none |
| READY_TO_PACK | pack | PACKED | dispatch.create | serials scanned = qty; each serial ∈ reservation's allocated serials (or swap within same grade via inventory adjust) | none |
| PACKED | dispatch | DISPATCHED | dispatch.dispatch | carrier set; e-way bill no. present if required by tenant setting & value | **DISPATCH** |
| DISPATCHED | out-for-delivery | OUT_FOR_DELIVERY | dispatch.dispatch | | none |
| OUT_FOR_DELIVERY / DISPATCHED | deliver | DELIVERED | dispatch.deliver | POD fields per tenant setting | **DELIVER** |
| DISPATCHED / OUT_FOR_DELIVERY | fail | DELIVERY_FAILED | dispatch.deliver | reason | none |
| DELIVERY_FAILED | reattempt | OUT_FOR_DELIVERY | dispatch.dispatch | | none |
| DELIVERY_FAILED | initiate-rto | RTO_IN_TRANSIT | dispatch.dispatch | | none |
| RTO_IN_TRANSIT | receive-rto | RTO_RECEIVED | dispatch.deliver + warehouse scope | | **RTO_RECEIVE** |
| DRAFT/READY_TO_PACK/PACKED | cancel | CANCELLED | dispatch.create | | none |

Key invariant: **DC creation and packing never touch stock.** Physical stock leaves the warehouse once (DISPATCH). Delivery only moves it from IN_TRANSIT to the customer.

---

## 7.4 Step 3 — Architecture

```text
fulfillment dispatch command:
  1. BEGIN; lock DC FOR UPDATE; assert PACKED & version; set DISPATCHING; COMMIT
  2. sync → inventory POST /internal/v1/postings  type=DISPATCH  key='DC:<id>:DISPATCH'
        lines: per reservation, serials = packed serials
        inventory: consume reservation (qty_consumed += q, reservation_serials CONSUMED),
                   RESERVED −q → IN_TRANSIT +q (warehouse_id retained, shipment ref), serial units → IN_TRANSIT
  3. BEGIN; DC/shipment → DISPATCHED; outbox fulfillment.shipment.dispatched.v1; COMMIT
  retry-safe: step 2 idempotent by key; stuck DISPATCHING > 5 min → recovery job re-runs step 2 then 3
deliver command: same pattern with key 'SHIPMENT:<id>:DELIVER'
```
Sync (not event) because the user needs an immediate "dispatched / insufficient reserved stock" answer and the scanner flow must fail fast on a wrong serial.

Carrier integration: `CarrierAdapter` interface (`createShipment`, `getLabel`, `track`, `cancel`) with `ManualAdapter` now; aggregator/courier adapters added later without schema change. Tracking webhooks land on `/webhooks/carriers/{carrier}` (signature verified, idempotent by carrier event id) and map to the transitions above.

---

## 7.5 Step 4 — Database (`fulfillment_db`)
```sql
CREATE TABLE delivery_challans (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, number text NOT NULL,
  customer_id uuid NOT NULL, customer_snapshot jsonb NOT NULL,
  ship_to jsonb NOT NULL, warehouse_id uuid NOT NULL, warehouse_snapshot jsonb NOT NULL,
  challan_type text NOT NULL DEFAULT 'SALE' CHECK (challan_type IN ('SALE','ON_APPROVAL','JOB_WORK','OTHER')),
  declared_value numeric(18,2) NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT','READY_TO_PACK','PACKED','DISPATCHING','DISPATCHED',
         'OUT_FOR_DELIVERY','DELIVERY_FAILED','DELIVERED','RTO_IN_TRANSIT','RTO_RECEIVED','CANCELLED')),
  status_reason text, remarks text,
  created_by uuid NOT NULL, version int NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, number)
);

CREATE TABLE dc_lines (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, dc_id uuid NOT NULL REFERENCES delivery_challans(id),
  so_id uuid NOT NULL, so_number text NOT NULL, so_line_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  item_id uuid NOT NULL, item_snapshot jsonb NOT NULL,
  qty numeric(18,3) NOT NULL CHECK (qty > 0),
  unit_value numeric(18,4) NOT NULL
);
CREATE INDEX dc_lines_so_line ON dc_lines (tenant_id, so_line_id);

CREATE TABLE dc_line_serials (
  tenant_id uuid NOT NULL, dc_line_id uuid NOT NULL REFERENCES dc_lines(id),
  serial_unit_id uuid NOT NULL, serial_no text NOT NULL, scanned_by uuid NOT NULL, scanned_at timestamptz NOT NULL,
  PRIMARY KEY (dc_line_id, serial_unit_id)
);

CREATE TABLE packages (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, dc_id uuid NOT NULL REFERENCES delivery_challans(id),
  package_no int NOT NULL, weight_kg numeric(8,3), length_cm numeric(8,1), width_cm numeric(8,1), height_cm numeric(8,1),
  contents jsonb NOT NULL, UNIQUE (dc_id, package_no));

CREATE TABLE shipments (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, dc_id uuid NOT NULL UNIQUE REFERENCES delivery_challans(id),
  carrier_code text NOT NULL, service_level text, awb_no text, tracking_url text,
  eway_bill_no text, eway_bill_valid_until timestamptz, vehicle_no text, driver_name text, driver_phone text,
  dispatched_at timestamptz, dispatched_by uuid,
  out_for_delivery_at timestamptz, delivered_at timestamptz, delivered_by uuid,
  receiver_name text, receiver_phone text,
  pod_signature_key text, pod_photo_keys text[], pod_document_keys text[], pod_geo point,
  failure_reason text, attempt_count int NOT NULL DEFAULT 0,
  version int NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX awb_uq ON shipments (tenant_id, carrier_code, awb_no) WHERE awb_no IS NOT NULL;

CREATE TABLE shipment_events (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, shipment_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('USER','CARRIER_WEBHOOK','SYSTEM')), external_event_id text,
  status text NOT NULL, location text, raw jsonb, occurred_at timestamptz NOT NULL,
  UNIQUE (tenant_id, shipment_id, source, external_event_id));
```
Open-DC guard: `SUM(dc_lines.qty) over non-cancelled DCs per so_line_id ≤ reserved qty` checked in the create transaction with `SELECT … FOR UPDATE` on a per-SO-line lock row (`so_line_fulfilment_locks`) to prevent two DCs over-allocating the same reservation.

---

## 7.6 Step 5 — API (`/api/v1`)
| Endpoint | Permission |
|---|---|
| `GET /fulfillment/pending?warehouseId=` — SO lines reserved but not on a DC | dispatch.view |
| `POST /delivery-challans` `{soLineIds/qty}` (Idempotency-Key) | dispatch.create |
| `GET /delivery-challans`, `GET /delivery-challans/{id}` | dispatch.view |
| `POST /delivery-challans/{id}/release|cancel` | dispatch.create |
| `POST /delivery-challans/{id}/scan` `{serialNo}` → validates instantly, returns line match | dispatch.create |
| `POST /delivery-challans/{id}/pack` `{packages[]}` | dispatch.create |
| `POST /delivery-challans/{id}/dispatch` `{carrierCode, awbNo?, ewayBillNo?, vehicleNo?}` (Idempotency-Key) | dispatch.dispatch |
| `POST /shipments/{id}/out-for-delivery` | dispatch.dispatch |
| `POST /shipments/{id}/deliver` `{receiverName, receiverPhone, podUploads[]}` (Idempotency-Key) | dispatch.deliver |
| `POST /shipments/{id}/fail|reattempt|initiate-rto|receive-rto` | dispatch.deliver / dispatch.dispatch |
| `GET /delivery-challans/{id}/pdf`, `/packing-slip.pdf`, `/labels.pdf` | dispatch.view |
| `POST /webhooks/carriers/{carrier}` | carrier signature |

Error codes: `DC_QTY_EXCEEDS_RESERVED`, `DC_SERIAL_NOT_RESERVED`, `DC_SERIAL_ALREADY_SCANNED`, `DC_INVALID_TRANSITION`, `DC_EWAY_BILL_REQUIRED`, `POD_REQUIRED`, `INSUFFICIENT_RESERVED_STOCK`.

---

## 7.7 Step 6 — Events
| Event | Consumers |
|---|---|
| `fulfillment.dc.created|packed|cancelled.v1` | sales (UI status), notification, reporting |
| `fulfillment.shipment.dispatched.v1` `{dcId, soLines[{soLineId, qty, serials[]}], carrier, awb, dispatchedAt}` | sales (dispatched_qty, PARTIALLY_FULFILLED), **billing (invoice-at-dispatch policy)**, notification (customer tracking msg), reporting |
| `fulfillment.shipment.out_for_delivery.v1` | notification |
| `fulfillment.shipment.delivered.v1` `{…, deliveredAt, receiver}` | sales (delivered_qty, FULFILLED), **billing (invoice-at-delivery policy)**, inventory (warranty start if policy = DELIVERY_DATE), notification, reporting |
| `fulfillment.shipment.failed|rto_received.v1` | sales, qc (RTO lot, `source_type=RTO`), notification |

---

## 7.8 Step 7 — Frontend
- **Pending dispatch board:** grouped by warehouse → customer; create DC from selected lines.
- **Pack screen (warehouse tablet/phone):** big scan input, per-line progress (3/5), wrong-serial error sound + message, package builder, print packing slip & labels.
- **Dispatch dialog:** carrier, AWB, e-way bill no. (required-badge when declared value ≥ tenant threshold), vehicle/driver for own fleet.
- **Delivery (mobile-first):** driver/agent view listing today's OUT_FOR_DELIVERY; POD capture (receiver name/phone, signature pad, photo); offline-tolerant queue with Idempotency-Key per attempt.
- **Shipment tracking timeline** on DC and SO detail.
- Invalid actions not rendered for the current status; server still enforces.

---

## 7.9 Step 8 — Implementation order
1. Inventory: DISPATCH / DELIVER / RTO_RECEIVE postings with reservation consumption & serial updates
2. svc-fulfillment schema, DC/pack/dispatch/deliver commands, recovery job for DISPATCHING
3. Scan validation endpoint; PDFs
4. Events → sales status updates; RTO → QC lot
5. Frontend; POD uploads via presigned URLs
6. ManualAdapter + webhook scaffold

## 7.10 Step 9 — Tests
| Test | Assertion |
|---|---|
| Only reserved stock | DC for unreserved qty → 422; scanning serial not in reservation → 422 |
| Correct serials | dispatched serials = packed serials = inventory IN_TRANSIT serials |
| Once only | dispatch retried 5× → one DISPATCH posting; RESERVED decreased once |
| No double deduction | after deliver: on-hand unchanged vs after dispatch; DELIVERED(customer) +q |
| Concurrency | two DCs for same SO line in parallel → second fails if exceeding reserved |
| Transitions | full matrix; deliver from PACKED → 409 |
| POD | missing required POD fields → 422; files stored in S3, download requires permission & tenant |
| RTO | IN_TRANSIT → QC_HOLD, QC lot created, SO dispatched_qty reduced |
| Failure | inventory unavailable during dispatch → DC stays DISPATCHING → recovery completes |
| Isolation | cross-tenant DC/shipment/POD → 404 |

## 7.11 Step 10 — Verification
- [ ] Full flow SO 5 laptops → DC → scan 5 serials → dispatch → deliver: serial history shows SO, DC, shipment refs; SO FULFILLED
- [ ] Reconciliation: IN_TRANSIT balance = sum of dispatched-not-delivered shipments
- [ ] Audit `STOCK_DISPATCHED`, `DELIVERY_COMPLETED` with POD reference

## 7.12 Exit gate
- [ ] Only reserved stock dispatched; correct serials; stock changes once at dispatch; delivery does not double-deduct
- [ ] POD stored; invalid transitions blocked
- [ ] Invoice timing policy (dispatch vs delivery) decided with CA and recorded as ADR for Phase 9
- [ ] **Approval recorded to start Phase 8**
