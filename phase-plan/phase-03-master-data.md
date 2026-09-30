# Phase 3 — Master Data (svc-master + svc-party)

> Prerequisite: Phase 2 COMPLETE. Extracts Items, Settings and Suppliers from legacy-api; adds Customers, Warehouses/Locations/Bins, tax, serial and warranty configuration.

---

## 3.1 Goal & scope

**svc-master:** products/items (GOODS/SERVICE, `trackInventory`, `isSerialized`), categories (tree), brands, units + conversions, HSN/SAC codes, GST rate slabs, tax groups, warehouses → locations → bins, payment terms, numbering series configuration, custom field definitions, condition grades, warranty defaults.

**svc-party:** suppliers, customers, contacts, addresses (billing/shipping), GSTIN/PAN, payment terms assignment, credit limit (stored; enforced in Phase 9/10).

**Also:** backfill from legacy, route cut-over, legacy tables read-only, reference-tracking for delete guards.

**Out of scope:** price lists (Phase 6 decision), stock (Phase 4), opening stock (Phase 4).

---

## 3.2 Step 1 — Understand
- [ ] Legacy item fields; any item variants? SKU uniqueness rules today
- [ ] Legacy supplier fields; duplicated suppliers in data?
- [ ] Which legacy modules reference items/suppliers by FK (PO lines, GRN lines) — they keep working after cut-over because ids are preserved
- [ ] Is there any warehouse concept today? (GRN needs a warehouse in Phase 5)

---

## 3.3 Step 2 — Business flow

```text
Tenant admin configures masters in this order (UI onboarding checklist):
  Units → Tax (GST slabs, HSN) → Categories/Brands → Condition grades → Warranty defaults
      → Warehouses → Locations → Bins → Payment terms → Numbering
      → Products → Suppliers → Customers
Product lifecycle:  DRAFT → ACTIVE → INACTIVE (not selectable on new docs) → ARCHIVED
Party lifecycle:    ACTIVE ⇄ INACTIVE → BLOCKED (cannot transact; reason required)
```

### Product rules
| Rule | Enforcement |
|---|---|
| `type=SERVICE` ⇒ `trackInventory=false`, `isSerialized=false` | DB CHECK + service |
| `isSerialized=true` ⇒ `trackInventory=true` | DB CHECK |
| `isSerialized` / `trackInventory` / base unit **cannot change once the item has any stock movement** | svc-master calls `GET svc-inventory /internal/v1/items/{id}/has-movements` (Phase 4+; before Phase 4, always allowed) |
| SKU unique per tenant (case-insensitive) | unique index on `(tenant_id, lower(sku))` |
| HSN required for GOODS, SAC for SERVICE (when tenant GST-registered) | service validation |
| Serialized items: optional `requiresImei`, `serialPattern` (regex) | validated at GRN/QC |

### Reference data used by other services
Warehouses and bins are **defined** in svc-master (reference data) and **replicated** into svc-inventory via events for local validation. Products are replicated into procurement/sales/inventory as lightweight local caches (`item_ref`: id, sku, name, isSerialized, trackInventory, status, version). Consumers ignore events with older `version`.

---

## 3.4 Step 3 — Architecture

| Data | Owner | Replicated to (via events) |
|---|---|---|
| Product, category, brand, unit, HSN, tax | svc-master | inventory, procurement, sales, billing, reporting |
| Warehouse, location, bin | svc-master | inventory, procurement, fulfillment, reporting |
| Condition grades, warranty defaults | svc-master | inventory, qc, sales |
| Numbering config | svc-master | owning services (they generate numbers locally) |
| Supplier | svc-party | procurement, billing, returns, reporting |
| Customer | svc-party | sales, fulfillment, billing, returns, reporting |

**Delete guards across services:** svc-master and svc-party keep a `references` table fed by events (`procurement.po.created` lines, `sales.so.created` lines, `inventory.posting.recorded`) — one row per (entity, referencing service). Hard delete only when no reference exists **and** status is DRAFT/never used; otherwise only INACTIVE/ARCHIVED. Default UX: "Archive", not "Delete".

---

## 3.5 Step 4 — Database

### master_db (key tables)
```sql
CREATE TABLE units (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  code text NOT NULL, name text NOT NULL, decimals int NOT NULL DEFAULT 0 CHECK (decimals BETWEEN 0 AND 3),
  uqc text,                                  -- GST Unique Quantity Code, e.g. 'NOS'
  UNIQUE (tenant_id, lower(code))
);

CREATE TABLE tax_rates (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  name text NOT NULL,                        -- 'GST 18%'
  gst_rate numeric(5,2) NOT NULL CHECK (gst_rate IN (0,0.1,0.25,1,1.5,3,5,6,7.5,12,18,28,40)),
  cess_rate numeric(5,2) NOT NULL DEFAULT 0,
  effective_from date NOT NULL, effective_to date,
  UNIQUE (tenant_id, name, effective_from)
);   -- verify current GST slabs with the tenant's CA before seeding

CREATE TABLE hsn_codes (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  code varchar(8) NOT NULL CHECK (code ~ '^[0-9]{4,8}$'),
  kind text NOT NULL CHECK (kind IN ('HSN','SAC')),
  description text, default_tax_rate_id uuid REFERENCES tax_rates(id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE categories (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, parent_id uuid REFERENCES categories(id),
  name text NOT NULL, path ltree NOT NULL,
  UNIQUE (tenant_id, parent_id, lower(name))
);

CREATE TABLE brands (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, name text NOT NULL,
  UNIQUE (tenant_id, lower(name)));

CREATE TABLE condition_grades (          -- e.g. A+, A, B, C for refurbished stock
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, code text NOT NULL, name text NOT NULL,
  sort_order int NOT NULL, sellable boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, code)
);

CREATE TABLE warranty_policies (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, name text NOT NULL,
  duration_months int NOT NULL CHECK (duration_months >= 0),
  starts_on text NOT NULL CHECK (starts_on IN ('INVOICE_DATE','DELIVERY_DATE')),
  terms text
);

CREATE TABLE products (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  sku text NOT NULL, name text NOT NULL, description text,
  type text NOT NULL CHECK (type IN ('GOODS','SERVICE')),
  track_inventory boolean NOT NULL,
  is_serialized boolean NOT NULL DEFAULT false,
  requires_imei boolean NOT NULL DEFAULT false,
  serial_pattern text,
  category_id uuid REFERENCES categories(id), brand_id uuid REFERENCES brands(id),
  unit_id uuid NOT NULL REFERENCES units(id),
  hsn_id uuid REFERENCES hsn_codes(id), tax_rate_id uuid REFERENCES tax_rates(id),
  default_warranty_id uuid REFERENCES warranty_policies(id),
  purchase_price numeric(18,2), selling_price numeric(18,2),
  reorder_level numeric(18,3),
  attributes jsonb NOT NULL DEFAULT '{}',   -- e.g. {"cpu":"i5-8th","ram":"8GB"}
  custom_fields jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('DRAFT','ACTIVE','INACTIVE','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz,
  version int NOT NULL DEFAULT 0,
  CHECK (type = 'GOODS' OR (track_inventory = false AND is_serialized = false)),
  CHECK (NOT is_serialized OR track_inventory),
  CHECK (NOT requires_imei OR is_serialized)
);
CREATE UNIQUE INDEX products_sku_uq ON products (tenant_id, lower(sku));
CREATE INDEX products_search ON products USING gin (to_tsvector('simple', name || ' ' || sku));

CREATE TABLE warehouses (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  code text NOT NULL, name text NOT NULL,
  address jsonb NOT NULL, state_code char(2) NOT NULL,   -- place of supply
  gstin char(15),                                        -- if separately registered
  is_default boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('ACTIVE','INACTIVE')),
  version int NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, lower(code))
);
CREATE UNIQUE INDEX one_default_wh ON warehouses (tenant_id) WHERE is_default;

CREATE TABLE locations (id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id), code text NOT NULL, name text,
  purpose text CHECK (purpose IN ('RECEIVING','QC','STORAGE','PACKING','DISPATCH','QUARANTINE')),
  UNIQUE (tenant_id, warehouse_id, lower(code)));

CREATE TABLE bins (id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  location_id uuid NOT NULL REFERENCES locations(id), code text NOT NULL,
  capacity numeric(18,3), status text NOT NULL DEFAULT 'ACTIVE',
  UNIQUE (tenant_id, location_id, lower(code)));

CREATE TABLE payment_terms (id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  name text NOT NULL, days int NOT NULL CHECK (days >= 0), is_default boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, lower(name)));

CREATE TABLE numbering_configs (tenant_id uuid NOT NULL, doc_type text NOT NULL,
  prefix_template text NOT NULL,           -- 'PO/{FY}/' → 'PO/26-27/0001'
  padding int NOT NULL DEFAULT 4, reset_each_fy boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, doc_type));

CREATE TABLE custom_field_defs (id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  entity text NOT NULL, key text NOT NULL, label text NOT NULL,
  data_type text NOT NULL CHECK (data_type IN ('TEXT','NUMBER','DATE','BOOLEAN','SELECT')),
  options jsonb, required boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, entity, key));

CREATE TABLE entity_references (tenant_id uuid NOT NULL, entity_type text NOT NULL,
  entity_id uuid NOT NULL, referenced_by text NOT NULL, first_seen_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, entity_type, entity_id, referenced_by));
```

### party_db (key tables)
```sql
CREATE TABLE parties (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  party_type text NOT NULL CHECK (party_type IN ('SUPPLIER','CUSTOMER')),
  code text NOT NULL, legal_name text NOT NULL, display_name text NOT NULL,
  gst_treatment text NOT NULL CHECK (gst_treatment IN
     ('REGISTERED','UNREGISTERED','COMPOSITION','CONSUMER','OVERSEAS','SEZ')),
  gstin char(15), pan char(10),
  payment_term_id uuid, credit_limit numeric(18,2), credit_days int,
  email citext, phone text,
  status text NOT NULL CHECK (status IN ('ACTIVE','INACTIVE','BLOCKED')),
  blocked_reason text,
  custom_fields jsonb NOT NULL DEFAULT '{}',
  version int NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, party_type, lower(code)),
  CHECK (gst_treatment <> 'REGISTERED' OR gstin IS NOT NULL),
  CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')
);
CREATE UNIQUE INDEX party_gstin_uq ON parties (tenant_id, party_type, gstin) WHERE gstin IS NOT NULL;

CREATE TABLE party_addresses (id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  party_id uuid NOT NULL REFERENCES parties(id),
  kind text NOT NULL CHECK (kind IN ('BILLING','SHIPPING')),
  line1 text NOT NULL, line2 text, city text NOT NULL, state_code char(2) NOT NULL,
  pincode char(6) NOT NULL CHECK (pincode ~ '^[1-9][0-9]{5}$'), country char(2) NOT NULL DEFAULT 'IN',
  is_default boolean NOT NULL DEFAULT false);

CREATE TABLE party_contacts (id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  party_id uuid NOT NULL REFERENCES parties(id), name text NOT NULL, email citext, phone text,
  designation text, is_primary boolean NOT NULL DEFAULT false);
```
One `parties` table with `party_type` keeps contact/address logic single-sourced; a business that is both supplier and customer gets two party rows (linked via optional `linked_party_id`) — keeps ledgers clean. GSTIN checksum validated in service (mod-36 check digit); first 2 digits must equal billing address `state_code`.

### Legacy backfill
Preserve legacy UUIDs for items and suppliers. Script → dry run → reconciliation report (counts, SKU collisions after case-folding, suppliers with invalid GSTIN flagged not dropped) → apply → gateway route switch → revoke write grants on legacy item/supplier tables. **Legacy PO/GRN still reads legacy item/supplier tables** — keep a one-way sync (svc-master/party events → legacy tables) until Phase 5 retires legacy PO/GRN.

---

## 3.6 Step 5 — API

| Resource | Endpoints | Permission |
|---|---|---|
| Products | `GET/POST /products`, `GET/PATCH /products/{id}`, `POST /products/{id}/activate|deactivate|archive`, `POST /products/import` (CSV, async job) | `master.view` / `master.manage` |
| Categories, brands, units, HSN, tax rates, grades, warranty policies, payment terms, custom fields | standard CRUD-with-archive | `master.view` / `master.manage` |
| Warehouses / locations / bins | `…/warehouses`, `…/warehouses/{id}/locations`, `…/locations/{id}/bins` | `warehouse.view` / `warehouse.manage` |
| Numbering | `GET/PUT /settings/numbering/{docType}` | `settings.manage` |
| Suppliers | `GET/POST /suppliers`, `GET/PATCH /suppliers/{id}`, `/block`, `/unblock`, `/addresses`, `/contacts` | `supplier.view/manage` |
| Customers | same shape under `/customers` | `customer.view/manage` |
| Lookups | `GET /lookups/products?q=&status=ACTIVE&trackInventory=` (typeahead, 20 results) | `master.view` |
| Internal | `GET /internal/v1/products:batch?ids=`, `GET /internal/v1/parties/{id}/snapshot` | service token |

Validation: SKU `^[A-Za-z0-9._/-]{1,40}$`; PATCH uses `If-Match` version; server rejects fields not allowed after first use (e.g. `isSerialized`) with `MASTER_FIELD_LOCKED` (422).

Error codes: `MASTER_DUPLICATE_SKU`, `MASTER_FIELD_LOCKED`, `MASTER_IN_USE` (delete guard), `PARTY_INVALID_GSTIN`, `PARTY_GSTIN_STATE_MISMATCH`, `PARTY_BLOCKED`.

---

## 3.7 Step 6 — Events
| Event | Consumers |
|---|---|
| `master.product.created|updated|status_changed.v1` | inventory, procurement, sales, billing, reporting, legacy-sync |
| `master.warehouse.*`, `master.bin.*` | inventory, procurement, fulfillment, iam (warehouse scope validation), reporting |
| `master.grade.*`, `master.warranty.*` | inventory, qc, sales |
| `party.supplier.*` / `party.customer.*` (incl. `blocked`) | procurement / sales / billing / returns / reporting / legacy-sync |
| consumes `procurement.po.created`, `sales.so.created`, `inventory.posting.recorded` | → `entity_references` |

Payload carries the full public snapshot + `version`, so consumers never need to call back for common fields.

---

## 3.8 Step 7 — Frontend (`web-app` → Masters)
- **Products:** list with filters (type, category, brand, serialized, status), bulk import with row-level error report, detail tabs (General, Inventory settings, Tax, Warranty, Custom fields, Activity). Locked fields show a lock icon + tooltip "Cannot change after stock exists".
- **Warehouses:** tree view Warehouse → Location → Bin; set default warehouse.
- **Suppliers / Customers:** list, detail with addresses & contacts, GSTIN input with live format validation and state auto-fill, block/unblock with reason.
- **Settings:** tax rates, HSN, units, grades, warranty, payment terms, numbering preview ("Next PO number: PO/26-27/0043").
- **Onboarding checklist** on dashboard until minimum masters exist.
- Typeahead components (`ProductPicker`, `PartyPicker`, `WarehousePicker`) in `ui-kit` — reused by every later phase.

---

## 3.9 Step 8 — Implementation order
1. svc-master & svc-party schemas, CRUD, validation, events
2. Local `item_ref` / `party_ref` consumers scaffolded in `platform-kit` (reused by later services)
3. Backfill scripts + reconciliation; legacy-sync consumer
4. Gateway cut-over of `/products`, `/suppliers`, settings routes; legacy tables write-revoked
5. Frontend pages; replace legacy item/supplier pages
6. Reference tracking + delete guards

## 3.10 Step 9 — Tests
- Duplicate SKU (case-insensitive) → 422; concurrent creates with same SKU → one wins
- SERVICE with trackInventory → 400; serialized flag lock (after Phase 4 via stubbed inventory client now)
- GSTIN format/checksum/state mismatch cases
- Tenant isolation on every resource (Tenant A cannot read/update Tenant B product/supplier/warehouse by id)
- Warehouse-scoped user sees only permitted warehouses
- Archive vs delete guard with a referenced product
- Backfill: counts/checksums match; legacy PO/GRN still render supplier & item names
- Events: product update increments version; consumer ignores stale version

## 3.11 Step 10 — Verification
- [ ] Legacy PO/GRN create still works with items/suppliers now owned by new services
- [ ] Audit entries for all master changes with field diffs
- [ ] `item_ref` caches in consumer services equal source (reconciliation query)

## 3.12 Exit gate
- [ ] Tenant isolation, duplicate validation, delete guards, master references, product lifecycle all proven by tests
- [ ] Legacy item/supplier tables read-only; one-way sync healthy
- [ ] **Approval recorded to start Phase 4**

## 3.13 Open decisions
| Decision | Default |
|---|---|
| Product variants (same model, different RAM/SSD) | Separate SKUs + `attributes` jsonb; revisit if catalog explodes |
| Price lists / customer-specific pricing | Deferred to Phase 6 |
| Supplier + customer as one party | Two linked party rows |
