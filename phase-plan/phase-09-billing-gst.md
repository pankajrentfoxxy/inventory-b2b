# Phase 9 — Billing / Invoice / GST (svc-billing)

> Prerequisite: Phase 8 COMPLETE. Billing owns every tax document. GST logic lives **only** here — no other service computes authoritative tax (sales/procurement show previews from the same shared calculator package, but the invoice is the source of truth).
>
> ⚠️ Tax rules below reflect the general Indian GST framework as understood at time of writing. **Every rule, threshold and rate must be confirmed with the tenant's chartered accountant before go-live**, and all thresholds are tenant settings, not code constants.

---

## 9.1 Goal & scope
- Supplier bills (purchase side) with PO/GRN **3-way match**
- Customer tax invoices (sales side), triggered by the invoice-timing policy decided in Phase 7 (at dispatch — typical for goods — or at delivery)
- Credit notes (sales returns, post-sale discounts, price corrections) and debit notes (supplier returns, price differences)
- GST engine: CGST+SGST vs IGST by place of supply, cess, rounding, HSN summary, reverse charge flag
- Margin-scheme support for second-hand/refurbished goods (configurable per tenant/product; see §9.3)
- Document numbering compliant with GST (per FY, consecutive, ≤ 16 characters)
- E-invoicing (IRN/QR via IRP/GSP) integration **adapter** — enabled per tenant setting
- E-way bill generation adapter (data already captured in Phase 7/8)
- Invoice PDFs; outstanding balances (updated by Phase 10 payment allocations)
- Exports for accounting (Tally/CSV) and GSTR-1 / GSTR-3B working reports (data, not filing)

Out of scope: general ledger / full accounting, GST return filing, TDS/TCS computation (flag only; later).

---

## 9.2 Step 1 — Understand
- [ ] Tenant GST registrations: one GSTIN or one per state/warehouse (Phase 3 stores warehouse GSTIN)
- [ ] Tenant AATO band → e-invoicing applicability (IRN is mandatory above a turnover threshold — currently ₹5 crore AATO; confirm)
- [ ] Does the tenant sell refurbished goods under the **margin scheme** (tax on the margin between purchase and sale price, where no input credit was availed)? If yes, which products/purchases qualify
- [ ] Invoice timing policy ADR from Phase 7
- [ ] Inter-state branch transfer policy from Phase 8

---

## 9.3 Step 2 — Business flows & tax rules

### Purchase side
```text
PO ─▶ GRN(s) ─▶ Supplier Bill DRAFT ─match─▶ MATCHED | VARIANCE ─approve─▶ POSTED ─(payments, Phase 10)─▶ PARTIALLY_PAID ─▶ PAID
                                         VARIANCE requires billing.approve.variance with reason
Supplier return dispatched (Phase 8) ─▶ Debit Note DRAFT ─approve─▶ ISSUED (reduces payable)
```
3-way match per line: `bill_qty ≤ grn_qty_received − grn_qty_returned − already_billed_qty`; `|bill_price − po_price| ≤ tolerance`; tax rate equals PO/master rate. Match results stored per line.

### Sales side
```text
Dispatch (or Delivery) event ─▶ Invoice DRAFT (auto) ─issue─▶ ISSUED ─(IRN if e-invoice)─▶ ISSUED+IRN
   ─(payments)─▶ PARTIALLY_PAID ─▶ PAID                ISSUED ─cancel (within IRN cancel window / before GSTR-1)─▶ CANCELLED
Customer return closed with CREDIT_NOTE/REFUND ─▶ Credit Note DRAFT ─issue─▶ ISSUED (reduces receivable)
```
Auto-draft vs manual issue is a tenant setting; default **auto-issue** so goods never leave without an invoice when policy = dispatch.

### GST computation rules (engine: `packages/gst-calc`, pure functions, used by billing authoritatively and by sales/procurement for previews)
| Rule | Logic |
|---|---|
| Supply type | `supplier_state` (warehouse GSTIN state / tenant state) vs `place_of_supply` (ship-to state for goods; customer billing state for B2C where applicable) → same = intra (CGST + SGST, rate/2 each), different = inter (IGST) |
| Unregistered/consumer buyer | Same computation; invoice flagged B2C (reporting split B2CS/B2CL) |
| SEZ / export | Zero-rated with/without payment of tax — tenant setting per invoice |
| Reverse charge | Line/party flag; tax shown but payable by recipient |
| Cess | `taxable × cess_rate` (+ specific cess if configured) |
| Rounding | Line tax computed at 2 decimals half-up per tax head; invoice total rounded to rupee with explicit `round_off` line (tenant setting) |
| Discounts | Pre-tax trade discount reduces taxable value; post-sale discounts only via credit note |
| Margin scheme (second-hand goods) | When enabled for a line: taxable value = sale price − purchase price of that unit (from serial `unit_cost`); if negative, taxable = 0; invoice shows no tax breakup to buyer and carries the scheme declaration; purchase must be marked "no ITC availed". Serial-level cost from Phase 4 makes this computable per unit. **CA sign-off required.** |
| Rate source | Tax rate snapshotted on SO/PO line; billing re-validates against HSN rate effective on invoice date and flags differences |

### Document numbering (GST)
Per GSTIN, per FY, per document series (INV, CN, DN, BILL-internal): consecutive, unique, max 16 characters, allowed characters `A-Z a-z 0-9 - /`. Gap-free generation from `number_series` (README §5.3). A cancelled invoice keeps its number (never reused).

---

## 9.4 Step 3 — Architecture
| Concern | Owner |
|---|---|
| Invoices, bills, credit/debit notes, tax lines, numbering, IRN/e-way data | svc-billing |
| GST calculation library | `packages/gst-calc` (pure, versioned, no I/O) — the one allowed piece of shared business logic, because tax preview must equal tax truth; billing is the only service that persists results |
| Receivable/payable outstanding | svc-billing (updated from `payment.allocation.*` events in Phase 10) |
| E-invoice / e-way bill provider | `EInvoiceAdapter`, `EwayBillAdapter` (GSP/IRP APIs) inside svc-billing; credentials per tenant in secrets manager |

Triggers:
```text
fulfillment.shipment.dispatched.v1 (policy=DISPATCH) or .delivered.v1 (policy=DELIVERY)
   → billing consumer: build invoice from event lines + SO snapshot (sync GET sales /internal SO snapshot)
   → idempotency: UNIQUE (tenant_id, source_type='SHIPMENT', source_id)
returns.rma.closed.v1 (resolution CREDIT_NOTE/REFUND) → credit note draft (UNIQUE source)
returns.supplier_return.dispatched.v1 → debit note draft (UNIQUE source)
procurement.grn.received.v1 → cache GRN qty for matching
```

---

## 9.5 Step 4 — Database (`billing_db`)
```sql
CREATE TABLE tax_documents (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  doc_type text NOT NULL CHECK (doc_type IN ('INVOICE','CREDIT_NOTE','DEBIT_NOTE','SUPPLIER_BILL')),
  number text NOT NULL CHECK (length(number) <= 16 OR doc_type = 'SUPPLIER_BILL'),
  fy text NOT NULL, doc_date date NOT NULL,
  seller_gstin char(15), seller_state char(2) NOT NULL,
  party_id uuid NOT NULL, party_snapshot jsonb NOT NULL,          -- name, gstin, gst_treatment, addresses
  place_of_supply char(2) NOT NULL,
  supply_type text NOT NULL CHECK (supply_type IN ('INTRA','INTER','EXPORT','SEZ_WITH_PAY','SEZ_WITHOUT_PAY')),
  is_reverse_charge boolean NOT NULL DEFAULT false,
  is_margin_scheme boolean NOT NULL DEFAULT false,
  source_type text NOT NULL, source_id uuid NOT NULL,             -- SHIPMENT | RMA | SUPPLIER_RETURN | MANUAL | SUPPLIER_INVOICE
  original_doc_id uuid REFERENCES tax_documents(id),              -- for CN/DN
  supplier_invoice_no text, supplier_invoice_date date,           -- SUPPLIER_BILL only
  taxable_total numeric(18,2) NOT NULL, cgst_total numeric(18,2) NOT NULL DEFAULT 0,
  sgst_total numeric(18,2) NOT NULL DEFAULT 0, igst_total numeric(18,2) NOT NULL DEFAULT 0,
  cess_total numeric(18,2) NOT NULL DEFAULT 0, round_off numeric(6,2) NOT NULL DEFAULT 0,
  grand_total numeric(18,2) NOT NULL,
  amount_settled numeric(18,2) NOT NULL DEFAULT 0,               -- from payment allocations (Phase 10)
  balance_due numeric(18,2) GENERATED ALWAYS AS (grand_total - amount_settled) STORED,
  due_date date,
  status text NOT NULL CHECK (status IN ('DRAFT','ISSUED','MATCHED','VARIANCE','POSTED',
          'PARTIALLY_PAID','PAID','CANCELLED')),
  irn char(64), ack_no text, ack_date timestamptz, signed_qr text, irn_status text,
  eway_bill_no text,
  pdf_object_key text,
  created_by uuid NOT NULL, issued_at timestamptz, cancelled_at timestamptz, cancel_reason text,
  version int NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, doc_type, fy, number),
  UNIQUE (tenant_id, doc_type, source_type, source_id),          -- one invoice per shipment etc.
  CHECK (amount_settled >= 0 AND amount_settled <= grand_total)
);
CREATE UNIQUE INDEX supplier_bill_dup ON tax_documents (tenant_id, party_id, lower(supplier_invoice_no), fy)
  WHERE doc_type = 'SUPPLIER_BILL' AND status <> 'CANCELLED';    -- same supplier invoice can't be booked twice

CREATE TABLE tax_document_lines (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, document_id uuid NOT NULL REFERENCES tax_documents(id),
  line_no int NOT NULL, item_id uuid, item_snapshot jsonb NOT NULL, hsn_sac varchar(8) NOT NULL,
  qty numeric(18,3) NOT NULL, uqc text, unit_price numeric(18,4) NOT NULL,
  discount numeric(18,2) NOT NULL DEFAULT 0,
  taxable_value numeric(18,2) NOT NULL,
  gst_rate numeric(5,2) NOT NULL, cgst numeric(18,2) NOT NULL DEFAULT 0, sgst numeric(18,2) NOT NULL DEFAULT 0,
  igst numeric(18,2) NOT NULL DEFAULT 0, cess numeric(18,2) NOT NULL DEFAULT 0,
  line_total numeric(18,2) NOT NULL,
  serials text[], purchase_cost_basis numeric(18,2),             -- margin scheme
  so_line_id uuid, po_line_id uuid, grn_line_id uuid,
  match_status text CHECK (match_status IN ('MATCHED','QTY_VARIANCE','PRICE_VARIANCE','TAX_VARIANCE')),
  UNIQUE (document_id, line_no)
);

CREATE TABLE billed_qty_ledger (          -- prevents double billing of the same GRN/SO line under concurrency
  tenant_id uuid NOT NULL, source_line_type text NOT NULL, source_line_id uuid NOT NULL,
  eligible_qty numeric(18,3) NOT NULL, billed_qty numeric(18,3) NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, source_line_type, source_line_id),
  CHECK (billed_qty <= eligible_qty)
);

CREATE TABLE einvoice_requests (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, document_id uuid NOT NULL,
  request jsonb NOT NULL, response jsonb, status text NOT NULL, attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now());
```

---

## 9.6 Step 5 — API (`/api/v1/billing`)
| Endpoint | Permission |
|---|---|
| `GET /invoices`, `/credit-notes`, `/debit-notes`, `/supplier-bills` (+ `/{id}`) | billing.view |
| `POST /invoices` (manual, e.g. services-only), `POST /invoices/{id}/issue|cancel` | billing.create / billing.cancel |
| `POST /invoices/{id}/einvoice` (generate/retry IRN), `POST /invoices/{id}/eway-bill` | billing.create |
| `POST /supplier-bills` (from GRNs), `/{id}/match`, `/{id}/approve-variance`, `/{id}/post`, `/{id}/cancel` | billing.create / billing.approve |
| `POST /credit-notes` (from RMA or manual against invoice), `/{id}/issue` | billing.create |
| `POST /debit-notes`, `/{id}/issue` | billing.create |
| `GET /{docType}/{id}/pdf` | billing.view |
| `GET /reports/gstr1?period=` `/gstr3b-summary?period=` `/hsn-summary?period=` | billing.view + reports.view |
| `GET /exports/tally?from=&to=` | billing.export |
| `GET /internal/v1/outstanding?partyId=` | payment, sales (credit check) |

Error codes: `BILL_DUPLICATE_SUPPLIER_INVOICE`, `BILL_QTY_EXCEEDS_RECEIVED`, `BILL_VARIANCE_REQUIRES_APPROVAL`, `INV_ALREADY_EXISTS_FOR_SOURCE`, `INV_CANCEL_WINDOW_EXPIRED`, `CN_EXCEEDS_ORIGINAL`, `GST_PLACE_OF_SUPPLY_MISSING`, `EINVOICE_PROVIDER_ERROR` (retryable).

---

## 9.7 Step 6 — Events
| Event | Consumers |
|---|---|
| `billing.invoice.issued|cancelled.v1` | payment (receivable), sales (invoice ref on SO), notification (email PDF), reporting |
| `billing.supplier_bill.posted.v1` | payment (payable), reporting |
| `billing.credit_note.issued.v1` | payment (refund/adjust), returns (link), reporting |
| `billing.debit_note.issued.v1` | payment, returns, reporting |
| consumes `fulfillment.shipment.dispatched|delivered.v1`, `returns.*`, `procurement.grn.received.v1`, `payment.allocation.created|reversed.v1` (Phase 10) | |

IRN generation is async with retries (provider outages are common); invoice PDF shows QR once IRN arrives; failures alert finance.

---

## 9.8 Step 7 — Frontend
- **Invoices:** list with status/IRN badges, overdue filter; detail with tax breakup, HSN summary, linked SO/DC/shipment, payments; PDF preview; cancel with reason (disabled after window).
- **Supplier bills:** create from supplier → select GRNs → auto-filled lines → match view (green/amber per line with variance explanation) → approve variance → post.
- **Credit/Debit notes:** from RMA / supplier return, or manual against an original document with max-amount guard.
- **GST reports:** period picker; GSTR-1 sections (B2B, B2CL, B2CS, CDNR, HSN) as tables + CSV/JSON download.
- **Settings → Billing:** invoice timing policy, auto-issue, rounding, margin scheme toggle, e-invoice/e-way credentials (write-only fields), document series.

---

## 9.9 Step 8 — Implementation order
1. `packages/gst-calc` with exhaustive unit tests (table-driven: intra/inter, rates, cess, rounding, margin scheme, CN)
2. Schema, numbering, invoice from shipment event (idempotent), PDF
3. Supplier bills + 3-way match + billed-qty ledger
4. Credit/debit notes from returns events
5. E-invoice & e-way adapters (sandbox first)
6. Reports & exports
7. Frontend

## 9.10 Step 9 — Tests
- GST engine golden tests reviewed by the tenant's CA (inputs → expected outputs spreadsheet checked into repo)
- Double invoicing impossible (event redelivery, concurrent manual create) — unique source + billed-qty ledger
- Supplier invoice booked twice → 422
- Bill qty > received − returned → variance; posting blocked without approval
- CN total ≤ original invoice remaining; CN for margin-scheme invoice follows same scheme
- Numbering: concurrent issue → consecutive, no gaps, ≤ 16 chars, resets per FY
- IRN retry idempotent; cancelled invoice keeps number
- Tenant isolation incl. PDFs and exports

## 9.11 Step 10 — Verification
- [ ] Sample month: GSTR-1 working report ties to sum of issued documents; HSN summary ties to lines
- [ ] Every shipment has exactly one invoice (policy-dependent) — reconciliation query
- [ ] CA review sign-off recorded

## 9.12 Exit gate
- [ ] GST, tax, invoice, credit note, debit note working and reconciled
- [ ] Tax logic centralized in `gst-calc` + billing only
- [ ] **Approval recorded to start Phase 10**
