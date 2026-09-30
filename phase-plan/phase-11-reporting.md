# Phase 11 — Reporting (svc-reporting)

> Prerequisite: Phase 10 COMPLETE. Reporting builds **read models from events**. It is never a source of truth and never queries another service's database. Transactional services stay fast because reports don't touch them.

---

## 11.1 Goal & scope
- Event-fed projections in `reporting_db` for every report family in the brief
- Rebuild/replay capability (projection from scratch using an event archive)
- Report API with filters, pagination, server-side aggregation; async exports (CSV/XLSX) to S3
- Dashboards: tenant dashboard (stock, pending actions, sales, receivables) and platform dashboard extensions
- Freshness indicators ("data as of 12 s ago")
- Scheduled report emails (optional)

Out of scope: BI tool embedding, ad-hoc query builder (later; can point a BI tool at `reporting_db` read replica).

---

## 11.2 Step 1 — Understand
- [ ] Which 10 reports are used daily (build these first); agree definitions (e.g. "stock valuation" = weighted average cost × on-hand buckets)
- [ ] Event archive: verify the Phase 0 archiver has retained every envelope since go-live (`platform/event-archive/` in object storage). If gaps exist, backfill projections via one-time internal snapshot APIs on the owning services

---

## 11.3 Step 2 — Report catalog & sources

| Family | Report | Built from events | Key measures |
|---|---|---|---|
| Inventory | Current stock by item/warehouse/bucket | `inventory.posting.recorded` | qty per bucket, on-hand |
| | Stock ledger (movement register) | same | in/out/running balance |
| | Stock valuation | postings + cost | on-hand × avg cost, by category/warehouse |
| | Ageing (days since receipt) | postings (serial receipt dates) | 0–30/31–60/61–90/90+ |
| | QC hold / rejected / in transit | postings | qty, value, age |
| | Low stock | postings + product reorder level | shortfall |
| Purchase | PO register, pending receipts | `procurement.po.*`, `grn.received` | ordered/received/pending |
| | GRN register, supplier purchase summary | `procurement.grn.*`, billing bills | qty, value |
| | QC rejections by supplier/item/defect | `qc.lot.decided` | reject %, defect Pareto |
| Sales | SO register, customer sales, fulfilment status | `sales.so.*`, `fulfillment.*` | booked, dispatched, delivered |
| | Pending dispatch, delivered, DC register | `fulfillment.*` | age since confirm |
| | Returns (rate, reasons) | `returns.*` | return %, by reason |
| Serial | Serial history, current location, purchase & sales history, warranty expiry | postings (serials), `qc`, `sales`, `billing` | timeline, warranty end |
| Finance | Receivables & payables ageing, collections, party statement, GST summaries | `billing.*`, `payment.*` | outstanding by bucket |
| Audit | Audit explorer | svc-audit API (audit_db is already an append-only store; reporting links to it rather than duplicating) | who/what/when/old/new |

---

## 11.4 Step 3 — Architecture

```text
domain.events ──▶ svc-reporting consumers (one queue per projection group)
                     │ inbox dedupe; per-aggregate version check
                     ▼
              reporting_db (projection tables, tenant_id-first indexes, RLS)
                     │
    /api/v1/reports/* ◀── gateway ◀── web-app / web-admin
                     │
              export worker ──▶ S3 (tenants/{tid}/reports/…) ──▶ presigned download link + notification

event archive: daily JSONL objects written by the Phase 0 archiver (object storage, service-neutral)
rebuild: POST /internal/v1/projections/{name}/rebuild → truncate shadow table → replay archive → catch up from live queue → swap
```
Scale path: start on the same Postgres cluster (separate DB); move `reporting_db` to its own instance/read replica when report load is visible; ClickHouse only if event volume demands it.

---

## 11.5 Step 4 — Database (`reporting_db`, representative)
```sql
CREATE TABLE rpt_stock_position (
  tenant_id uuid NOT NULL, item_id uuid NOT NULL, warehouse_id uuid NOT NULL,
  sku text, item_name text, category_path text, brand text,
  qc_hold numeric(18,3) NOT NULL DEFAULT 0, available numeric(18,3) NOT NULL DEFAULT 0,
  reserved numeric(18,3) NOT NULL DEFAULT 0, rejected numeric(18,3) NOT NULL DEFAULT 0,
  in_transit numeric(18,3) NOT NULL DEFAULT 0,
  on_hand numeric(18,3) GENERATED ALWAYS AS (qc_hold + available + reserved + rejected) STORED,
  avg_cost numeric(18,4), stock_value numeric(18,2),
  last_movement_at timestamptz, last_event_id uuid,
  PRIMARY KEY (tenant_id, item_id, warehouse_id)
);

CREATE TABLE rpt_stock_movements (            -- partitioned by month
  tenant_id uuid NOT NULL, posting_id uuid NOT NULL, line_no int NOT NULL, occurred_at timestamptz NOT NULL,
  item_id uuid NOT NULL, warehouse_id uuid, bucket text NOT NULL, qty numeric(18,3) NOT NULL,
  ref_type text NOT NULL, ref_number text, unit_cost numeric(18,4),
  PRIMARY KEY (tenant_id, occurred_at, posting_id, line_no)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE rpt_serial_units (tenant_id uuid NOT NULL, serial_unit_id uuid NOT NULL, serial_no text NOT NULL,
  item_id uuid NOT NULL, sku text, bucket text, warehouse_id uuid, grade text,
  supplier_name text, po_number text, grn_number text, received_at timestamptz, unit_cost numeric(18,4),
  customer_name text, so_number text, invoice_number text, delivered_at timestamptz,
  warranty_end date, PRIMARY KEY (tenant_id, serial_unit_id));
CREATE INDEX rpt_serial_no ON rpt_serial_units (tenant_id, upper(serial_no));

CREATE TABLE rpt_documents (                  -- unified register for PO/GRN/SO/DC/INV/BILL/RMA
  tenant_id uuid NOT NULL, doc_type text NOT NULL, doc_id uuid NOT NULL, number text, doc_date date,
  party_id uuid, party_name text, warehouse_id uuid, status text, total numeric(18,2),
  balance_due numeric(18,2), extra jsonb, updated_at timestamptz,
  PRIMARY KEY (tenant_id, doc_type, doc_id));
CREATE INDEX rpt_docs_lookup ON rpt_documents (tenant_id, doc_type, status, doc_date DESC);

CREATE TABLE rpt_daily_kpis (tenant_id uuid NOT NULL, day date NOT NULL,
  po_value numeric(18,2), grn_qty numeric(18,3), qc_pass_qty numeric(18,3), qc_fail_qty numeric(18,3),
  so_value numeric(18,2), dispatched_qty numeric(18,3), delivered_qty numeric(18,3),
  invoiced_value numeric(18,2), collected_value numeric(18,2), returns_qty numeric(18,3),
  PRIMARY KEY (tenant_id, day));

CREATE TABLE projection_checkpoints (projection text PRIMARY KEY, last_event_at timestamptz, events_processed bigint,
  status text NOT NULL DEFAULT 'LIVE');
CREATE TABLE report_exports (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, report text NOT NULL, params jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('QUEUED','RUNNING','DONE','FAILED')), object_key text,
  requested_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz);
```
Projection rules: every handler is idempotent (inbox) and version-aware; names/labels come from master/party events so reports render without cross-service calls.

---

## 11.6 Step 5 — API (`/api/v1/reports`)
| Endpoint | Permission |
|---|---|
| `GET /inventory/stock`, `/inventory/ledger`, `/inventory/valuation`, `/inventory/ageing`, `/inventory/low-stock` | reports.view + inventory.view |
| `GET /purchase/po-register`, `/purchase/pending-receipts`, `/purchase/qc-rejections`, `/purchase/supplier-summary` | reports.view + purchase.view |
| `GET /sales/so-register`, `/sales/pending-dispatch`, `/sales/customer-summary`, `/sales/returns` | reports.view + sales.view |
| `GET /serials/{serialNo}`, `/serials/warranty-expiring?days=` | reports.view + inventory.view |
| `GET /finance/receivables-ageing`, `/finance/payables-ageing`, `/finance/collections` | reports.view + billing.view |
| `GET /dashboard` | authenticated (widgets filtered by permission) |
| `POST /exports` `{report, params, format}` / `GET /exports/{id}` | reports.export |
| `GET /freshness` | reports.view |

Warehouse-scoped users automatically get warehouse filters applied server-side. Query guardrails: max date range 366 days per request, max 200 rows per page, statement timeout 10 s; bigger → export.

---

## 11.7 Step 6 — Events
Consumes everything in README §7. Produces `reporting.export.completed.v1` → notification (download link). Lag metric per projection exported to Prometheus; alert if lag > 60 s for 5 min.

---

## 11.8 Step 7 — Frontend
- **Reports hub:** categories (Inventory, Purchase, Sales, Serial, Finance, Audit), favourite reports, recent exports.
- **Report page pattern:** filter bar (date range, warehouse, item/party, status) synced to URL; summary cards; table with column chooser, sort; export button; freshness badge.
- **Dashboard:** stock value & on-hand by bucket, pending actions (POs awaiting approval, GRNs in QC, SOs to dispatch, overdue invoices), 30-day trend charts, QC reject rate.
- **Serial lookup:** single search box → full lifecycle card (PO → GRN → QC → SO → DC → delivery → invoice → return).

---

## 11.9 Step 8 — Implementation order
1. Event archive verification/backfill; projection framework (checkpoint, rebuild, shadow swap)
2. Inventory projections & reports (highest value)
3. Document register + purchase/sales reports
4. Serial projection
5. Finance ageing
6. Exports worker; dashboard
7. Frontend

## 11.10 Step 9 — Tests
- Projection correctness: after a scripted scenario, every report equals the source-of-truth numbers from service reconciliation APIs
- Replay: rebuild projection from archive → identical to live
- Duplicate/out-of-order events do not change results
- Tenant isolation (RLS + API) including exports and presigned links
- Load: 1M movement rows, stock report p95 < 500 ms; export of 100k rows < 60 s

## 11.11 Step 10 — Verification
- [ ] Stock valuation ties to inventory `item_cost × on-hand`
- [ ] Receivables ageing ties to billing outstanding
- [ ] No report query hits a transactional DB (verify via DB connection logs)

## 11.12 Exit gate
- [ ] All brief report families available and reconciled
- [ ] Rebuild tested; lag alerting live
- [ ] **Approval recorded to start Phase 12**
