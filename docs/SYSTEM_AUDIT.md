# B2B Inventory - System Audit

Date: 2026-09-29. Scope: the whole codebase - Prisma schema, all 3 migrations, every API module
(routes, services, repositories), middleware, the shared package, web routes, auth and permission
gating, tests, seed and docs. No code was changed as part of this audit.

One finding could not be verified at runtime because the local Postgres container (:5433) was not
running. It is marked *(unverified)* below.

**Naming clash to settle first.** The business term "Vendor (platform tenant)" is the
**`Organization`** model in the code. The business term "Supplier" is the **`Vendor`** model, which
is the supplier master. The code keeps the two separate, but the names are the opposite of the
business vocabulary. Every later phase needs one agreed naming.

---

## 1. Current architecture

- **Monorepo:** `apps/api` (Express, Prisma, PostgreSQL), `apps/web` (Vite, React, TanStack Query,
  Tailwind) and `packages/shared` (zod schemas, permission list, PO arithmetic).
- **API pattern:** `routes -> service -> repository`. Every router starts with
  `requireAuth -> requireOrganization`, and each route adds `requirePermission(code)`. Mounted in
  [app.ts](../apps/api/src/app.ts).
- **Tenancy:** the client sends `Authorization: Bearer <JWT>` plus an `X-Organization-Id` header.
  [auth.ts](../apps/api/src/middleware/auth.ts) loads the caller's membership, role and permissions
  from the database on **every request**, so a revoked permission or a suspension takes effect
  immediately.
- **Built so far:**
  - Auth: register creates a tenant; login.
  - Members API (no UI).
  - Suppliers (`Vendor`, very complete).
  - Items (minimal).
  - Settings masters: locations, taxes, GST treatments, payment terms, custom fields, reporting
    tags, numbering.
  - Purchase Orders.
  - Purchase Receives (GRN).
- **Web:** feature folders for vendors, items, purchase orders, purchase receives and settings.
  [navigation.ts](../apps/web/src/layout/navigation.ts) shows Inventory, Sales, Bills, Payments and
  Reports as greyed-out "not available" entries.

## 2. Current end-to-end flow

```
[Public] POST /auth/register  -> creates User + Organization (tenant) + default roles/masters; caller = OWNER
   (no Main Admin, no approval)
Login -> pick org -> X-Organization-Id header
Supplier (Vendor) create                                   DONE
Item create (GOODS/SERVICE, no serial flag)                DONE (minimal)
PO: DRAFT -> ISSUED                                        DONE
GRN against PO -> increments purchase_order_lines.received_quantity   DONE
   -> PO auto-moves ISSUED / PARTIALLY_RECEIVED / RECEIVED
------------------------------------------------ everything below does not exist ----
QC | Stock / ledger | Serials | Customers | Sales Order | Reservation | Delivery Challan | Dispatch | Delivery | Returns | Bills/Invoices | Payments | Reports
```

**A GRN changes no stock anywhere.** [PURCHASING_MODULE.md:21](PURCHASING_MODULE.md#L21) says so:
"Stock is not updated yet."

## 3. Existing vs required

| # | Module | Current state | Required | Gap | Priority |
|---|---|---|---|---|---|
| 1 | Frontend architecture | **COMPLETE** (for the modules built) | Same, plus the new modules | Shared UI primitives and loading/empty/error states are consistent | - |
| 2 | Backend architecture | **COMPLETE** pattern, **PARTIAL** robustness | Race-safe services | Status checks run outside the transaction (section 4) | P0 |
| 3 | Database schema | **NEEDS ARCH CHANGE** | Ledger, serials, sales, QC, platform tables | No CHECK constraints, no tenant-consistent foreign keys | P0 |
| 4 | Authentication | **PARTIAL** | Tenant login plus a Main Admin login | JWT kept in `localStorage`; no reset, revocation or refresh | P1 |
| 5 | Multi-tenancy | **PARTIAL** (app layer is good) | Plus database-level defence and tenant lifecycle | No tenant status or approval; no RLS or composite foreign keys | P0 |
| 6 | Platform vendor (tenant) management | **MISSING** | Main Admin creates, approves and suspends tenants | Nothing exists; tenants self-register | P0 |
| 7 | RBAC | **PARTIAL** | Per-tenant custom roles, action-level permissions | Fixed system roles only; no roles/members UI | P1 |
| 8 | Procurement (overall) | **PARTIAL** | PO -> GRN -> QC -> stock | Stops at GRN | - |
| 9 | Purchase Order | **PARTIAL** (functional, with bugs) | Approval, and locking after issue | Races; item can be swapped after receipt; edits after issue need no re-approval | P0 |
| 10 | GRN | **BROKEN** under concurrency; **NEEDS ARCH CHANGE** | Warehouse, accepted/rejected split, serial capture, ledger posting | Over-receipt race, double-cancel race, no warehouse choice | P0 |
| 11 | QC | **MISSING** | QC inspections, pass/fail per unit or quantity | Nothing exists | P1 |
| 12 | Inventory | **MISSING** | Stock balances by bucket and warehouse | `Item.trackInventory` exists but nothing uses it | P0 |
| 13 | Serialized inventory | **MISSING** | Serial/IMEI units with full history | Nothing exists | P1 |
| 14 | Sales Order | **MISSING** | SO with availability check and reservation | - | P2 |
| 15 | Delivery Challan | **MISSING** | DC / packing | - | P2 |
| 16 | Dispatch / Delivery | **MISSING** | Shipment states | - | P2 |
| 17 | Customer management | **MISSING** | Customer master (mirror the Vendor aggregate) | - | P1 |
| 18 | Supplier management | **COMPLETE** (minus 2 guards) | Same | Can be deleted while it has open POs (section 4) | P1 |
| 19 | Returns | **MISSING** | Customer returns with QC; returns to supplier | - | P3 |
| 20 | Payments / Bills | **MISSING** | Bills, invoices, GST, payments | Vendor "transactions" panel returns `available:false` | P3 |
| 21 | Reports | **MISSING** | Stock, ageing, serial history, purchase and sales | - | P3 |
| 22 | Document numbering | **COMPLETE** | Extend to new document types | Numbers of deleted POs can be reused (unique index is `WHERE deleted_at IS NULL`) | P2 |
| 23 | Audit logs | **PARTIAL** | Unified audit of every write | Only Vendor and PO have activity tables; items, settings, members, roles and logins are not audited | P1 |
| 24 | Validation | **COMPLETE** for bodies, **PARTIAL** overall | Plus route params and database constraints | Route params unvalidated; no CHECK constraints | P0 |
| 25 | API consistency | **PARTIAL** | One response shape | `{data}` vs bare objects (`/auth/*`, `/organizations/current`) | P3 |
| 26 | Error handling | **PARTIAL** | Every expected error mapped | Prisma P2023 not mapped; missing issue permission returns 400 instead of 403 | P1 |
| 27 | Transaction handling | **PARTIAL** | Row lock plus re-check inside the transaction | Read, then check, then write across the transaction boundary | P0 |
| 28 | Inventory consistency | **MISSING** | Ledger as the source of truth | No ledger | P0 |
| 29 | Security | **PARTIAL** | - | See sections 4 and 8 | P0-P1 |
| 30 | Performance | **PARTIAL** (fine now) | - | `ILIKE '%x%'` without trigram indexes, offset paging, a permissions query per request, uploads on local disk | P3 |

## 4. Critical problems

### Wrong inventory / duplicate records (race conditions, confirmed by reading the code)

1. **GRN over-receipt race.** [createReceive](../apps/api/src/modules/purchases/purchaseReceive.service.ts#L105)
   reads the PO and checks the remaining quantity
   ([L115](../apps/api/src/modules/purchases/purchaseReceive.service.ts#L115)) *before* the
   transaction. It then does `increment`
   ([L149](../apps/api/src/modules/purchases/purchaseReceive.service.ts#L149)) with no row lock and
   no re-check. There is no database `CHECK (received_quantity <= quantity)`.
   - Two concurrent submits (or a double-click) for the remaining 100 units both succeed, recording
     200 received against 100 ordered.
   - Once GRN posts stock, this directly inflates inventory.
2. **GRN double-cancel race.** [cancelReceive](../apps/api/src/modules/purchases/purchaseReceive.service.ts#L165)
   checks `status === 'CANCELLED'` outside the transaction
   ([L167](../apps/api/src/modules/purchases/purchaseReceive.service.ts#L167)). Two concurrent
   cancels both `decrement` ([L171](../apps/api/src/modules/purchases/purchaseReceive.service.ts#L171)),
   so `received_quantity` can go negative.
3. **PO cancel vs. GRN race.** [cancelPurchaseOrder](../apps/api/src/modules/purchases/purchaseOrder.service.ts#L291)
   checks "no receives" before the transaction. A GRN created in between leaves a **CANCELLED PO
   with a live GRN**.
4. **PO edit vs. GRN race.** [updatePurchaseOrder](../apps/api/src/modules/purchases/purchaseOrder.service.ts#L210)
   checks `qty >= received` before the transaction, so a concurrent GRN can leave ordered quantity
   below received quantity.

### Data integrity / wrong history

5. **An item can be swapped on a PO line that has already been received.** The edit only guards
   quantity. `lineData` rewrites `itemId`, `name`, `sku` and `hsn`
   ([L121](../apps/api/src/modules/purchases/purchaseOrder.service.ts#L121),
   [L232](../apps/api/src/modules/purchases/purchaseOrder.service.ts#L232)).
   - The GRN's line keeps the old `itemId`, but the GRN view reads its name from the PO line
     ([purchaseReceive.service.ts:42](../apps/api/src/modules/purchases/purchaseReceive.service.ts#L42)).
   - Result: the GRN document **retroactively shows a different item**, and the PO and GRN disagree
     on which item arrived.
6. **Supplier and item soft-delete have no guard.**
   - [deleteVendor](../apps/api/src/modules/vendors/vendor.service.ts#L439) (its own comment admits
     the guard is missing) and [deleteItem](../apps/api/src/modules/items/item.service.ts#L145)
     succeed even with open POs.
   - Afterwards the PO cannot be edited, because `resolvePurchaseOrder` rejects the deleted vendor or
     item, but GRNs can still be posted against it.

### Incorrect financial data

7. **An issued PO can be re-priced by someone without issue authority.** `ISSUED` and
   `PARTIALLY_RECEIVED` are editable ([purchase.schema.ts:60](../packages/shared/src/purchase.schema.ts#L60)),
   and the Purchase Executive role has `purchase_order.edit` but not `issue`.
   - The tests assert this behaviour on purpose ("executive cannot issue... but can edit").
   - The executive can change rates, quantities and the total of an order already sent to the
     supplier, with no re-approval and no revision number.

### Security / tenant boundary

8. **`addMember` attaches any existing user on the platform by email**
   ([organization.service.ts:202](../apps/api/src/modules/organizations/organization.service.ts#L202)).
   - The response includes that user's real name, so a tenant admin can check whether any email
     exists on the platform and learn the name.
   - The user is added to the tenant without their consent.
9. **Anyone can create a tenant** through the public `POST /auth/register`
   ([auth.routes.ts:21](../apps/api/src/modules/auth/auth.routes.ts#L21)). This contradicts the
   "Main Admin approves vendors" model.
10. **Malformed IDs return 500 *(unverified)*.** No `:id` route runs `validateParams`; only
    `docType` does. Prisma 6 raises P2023 for a non-UUID value, and
    [errorHandler.ts](../apps/api/src/middleware/errorHandler.ts#L41) does not map it, so the caller
    gets a logged 500 instead of a 404/422.
11. **The GST lookup authenticates with a Zoho browser session cookie** held in the server
    environment ([env.ts:31](../apps/api/src/config/env.ts#L31)). That is one platform-wide
    third-party credential used by every tenant. It is fragile, likely against Zoho's terms, and the
    endpoint has no rate limit.

## 5. Architectural problems (separate from bugs)

- **A1 - No stock ledger and no stock model.** Nothing represents quantity on hand. Inventory must
  be built as an append-only `stock_movements` ledger plus derived balances, not a quantity column.
- **A2 - No platform layer.** There is no Main Admin identity, no platform roles, no tenant
  lifecycle (`PENDING/ACTIVE/SUSPENDED`), no platform audit, and no tenant-status check in
  `requireOrganization`.
- **A3 - The GRN model cannot carry QC or serials.** It has one `quantity` per line, no
  accepted/rejected split, no serial rows, a status set of only `RECEIVED/CANCELLED`, and its
  warehouse is inferred from the PO (`null` for a custom delivery address,
  [L138](../apps/api/src/modules/purchases/purchaseReceive.service.ts#L138)).
- **A4 - The "check, then write" transaction pattern is used everywhere:** PO issue, cancel, close,
  reopen and delete; GRN cancel; vendor update. Every inventory-affecting service needs a row lock
  (`SELECT ... FOR UPDATE`) or a conditional `updateMany ... WHERE status IN (...)` with a row-count
  check. This matters more once stock exists.
- **A5 - Tenant isolation relies only on application code.** Foreign keys are single-column, so the
  database accepts, for example, `purchase_orders.vendor_id` pointing at another tenant's vendor.
  There is no RLS. One missed filter in a future module means a cross-tenant leak. Needs composite
  `(organization_id, id)` foreign keys or Postgres RLS.
- **A6 - Audit is split by module** (`vendor_activities`, `purchase_order_activities`). Continuing
  this means a new activity table per module. A single `audit_events` table (entity type and id, IP
  address, user agent) scales better.
- **A7 - Permission changes do not reach existing tenants.**
  [syncPermissionCatalogue](../apps/api/src/modules/organizations/organization.service.ts#L23) only
  grants new permissions to OWNER/ADMIN. Changes to `DEFAULT_ROLES` for other system roles only reach
  tenants when `provisionOrganizationDefaults` runs, and that only runs in the seed for the 2 demo
  orgs.
- **A8 - Uploads are stored on local disk** (`UPLOAD_DIR`), so the API cannot run as more than one
  instance.
- **A9 - Global `users` table with a platform-unique email.** One login spans many tenants. That is
  fine, but it is the root of problem 8 and needs an explicit invite/consent model.

## 6. Validation problems

The body-validation layer is strong: shared zod schemas, the server re-validates, and master data is
checked per tenant. The gaps:

- Route params (`:id`, `:contactId`, `:memberId`, ...) are never validated (problem 10).
- No database CHECK constraints: `quantity > 0`, `received_quantity BETWEEN 0 AND quantity`,
  amounts `>= 0`.
- No idempotency key on GRN or PO create, so a double submit creates duplicates (combined with
  race 1).
- A GRN's `receivedDate` is not compared with the PO's `orderDate`, so goods can be "received" before
  they were ordered.
- A GRN accepts `SERVICE` items. That will matter once receipts post stock.
- [vendor.service.ts:201](../apps/api/src/modules/vendors/vendor.service.ts#L201): `badIds` error
  paths use the index in the *filtered* list, so field errors can point at the wrong row. Minor.
- The P2002 duplicate error returns a generic message with no field path.

### PO -> GRN workflow questions

| Question | Answer |
|---|---|
| Can a GRN be created against another tenant's PO? | **No.** `findLivePoOrThrow` is scoped by org and returns 404. The code is correct, but no test covers it. |
| Can received quantity exceed ordered quantity? | Validated, but **yes under concurrency** (problem 1). |
| Can the same PO be received multiple times incorrectly? | Multiple partial GRNs are allowed by design. A **double submit can over-receive.** |
| Can a GRN be edited after QC? | GRNs cannot be edited at all; QC does not exist. |
| Can QC happen before GRN? / Can failed QC enter available stock? | Not applicable: no QC, no stock. |

For **SO -> DC -> Dispatch -> Delivered**, the whole chain is MISSING, so there is no validation at
any layer.

### Status transition audit (actual code)

| Entity | Transitions in the code | Invalid or risky |
|---|---|---|
| PO | `DRAFT -> ISSUED`; `ISSUED <-> PARTIALLY_RECEIVED <-> RECEIVED` (derived by `recomputeReceiveStatus`); `ISSUED/PARTIALLY_RECEIVED/RECEIVED -> CLOSED`; `DRAFT/ISSUED/PARTIALLY_RECEIVED/CLOSED -> CANCELLED` (only with no receives); `CLOSED/CANCELLED -> reopen -> DRAFT or ISSUED (recomputed)`; soft delete only from `DRAFT/CANCELLED` | CANCELLED with a live GRN (race); `CANCELLED -> ISSUED` on reopen with no re-approval; edits while ISSUED with no revision; received > ordered (race) |
| GRN | `RECEIVED -> CANCELLED` | Double cancel (race); no draft or QC states |
| Supplier (`Vendor`) | `ACTIVE <-> INACTIVE`, soft delete from either | Delete allowed with open POs |
| Member | `ACTIVE <-> SUSPENDED`; `INVITED` exists in the enum but nothing uses it | No invite flow |

## 7. RBAC problems

- The permission catalogue only covers vendor, item, purchase_order, purchase_receive and settings
  ([permissions.ts](../packages/shared/src/permissions.ts)). Nothing exists for QC, inventory,
  sales, dispatch or finance.
- **No custom roles.** There is no role create/update API; roles are the fixed system set (OWNER,
  ADMIN, PURCHASE_MANAGER, PURCHASE_EXECUTIVE, VIEWER). There is also **no UI** for members or
  roles, even though the API exists.
- **`settings.manage` does everything:** masters, numbering, members and role assignment. Any holder
  can make anyone an ADMIN, and there is no hierarchy guard (an ADMIN can suspend another ADMIN).
  Member and role changes are not audited.
- **No approval permission.** `purchase_order.issue` also covers close and reopen, and `edit` gets
  around it (problem 7).
- Missing issue permission on save-and-issue returns **400**, not 403
  ([purchaseOrder.routes.ts:27](../apps/api/src/modules/purchases/purchaseOrder.routes.ts#L27)).
- No platform-admin override, because there is no platform layer (A2).
- New permissions do not reach non-admin roles in existing tenants (A7).
- **Working well:** every route has a backend check. UI gating (`ProtectedRoute`, `PermissionGate`)
  is cosmetic only. Suspension takes effect immediately and has a test.

## 8. Multi-tenant problems

**Good:** every business and child table has `organization_id`. Every service query filters on it.
Records from another tenant return 404 (tests cover vendors, POs, items and masters). Child IDs are
checked against their parent before writes. Upload paths are namespaced by org, and downloads go
through scoped lookups.

**Gaps:**

1. No database-level enforcement (A5).
2. Cross-tenant email lookup and forced membership through `addMember` (problem 8).
3. No tenant lifecycle: a suspended tenant cannot be blocked, because `requireOrganization` does not
   check org status and none exists.
4. `X-Organization-Id` lives in `localStorage` and is shared across browser tabs. Switching org in
   tab B makes tab A's next request go to the other tenant while tab A still shows the first
   tenant's cached data. Mostly this fails validation, but it is a data-integrity hazard for users
   in several tenants.
5. No tests for: GRN create/cancel against a foreign PO or GRN, cross-tenant document download, or
   vendor sub-resources with IDs from another tenant. The code looks correct; the tests are missing.
6. The platform-wide Zoho GST credential is shared by all tenants (problem 11).

## 9. Inventory problems

### Every location in the code that changes a quantity

| Event | Code location | Inventory change | Validation | Transaction | Audit |
|---|---|---|---|---|---|
| GRN create | [purchaseReceive.service.ts:149](../apps/api/src/modules/purchases/purchaseReceive.service.ts#L149) | `po_line.received_quantity += q` (**no stock**) | Remaining qty checked, but **outside the transaction** | Yes, but no lock | PO activity `RECEIVE_CREATED` |
| GRN cancel | [purchaseReceive.service.ts:171](../apps/api/src/modules/purchases/purchaseReceive.service.ts#L171) | `received_quantity -= q` | Status checked **outside the transaction** | Yes, but no lock | PO activity `RECEIVE_CANCELLED` |
| PO edit | [purchaseOrder.service.ts:232](../apps/api/src/modules/purchases/purchaseOrder.service.ts#L232) | Ordered qty and item may change | `qty >= received` checked outside the transaction; **item swap not guarded** | Yes | `PO_UPDATED` (summary only) |

There are no other stock mutations, because there is no stock. So "delivery does not reduce stock",
"stock reduced twice", "QC-failed stock becomes sellable" and similar bugs cannot happen yet. **The
ledger has to be designed up front so they cannot happen later.**

### Proposed stock model (for approval, not built)

Stock sits in one bucket per unit or quantity, and every movement is a ledger row:

- **QC hold:** received, not yet inspected. Counts as on-hand, not sellable.
- **Available:** passed QC and not reserved. Sellable.
- **Reserved:** allocated to a confirmed SO but still in the warehouse. Counts as on-hand.
- **Rejected:** failed QC. Counts as on-hand, never sellable, until returned to the supplier or
  explicitly re-graded.
- **In transit / dispatched:** has left the warehouse. **On-hand decreases here, once.** Still owned
  by the tenant.
- **Delivered / sold:** ownership transfers. The warehouse quantity does not change again.
- **Returned:** received back into QC hold, then moves to available or rejected.

How the documents map onto it:

- GRN adds to QC hold.
- QC pass moves QC hold to available; QC fail moves QC hold to rejected.
- SO confirm moves available to reserved (on-hand unchanged).
- DC/packing changes nothing, or moves stock into a "packed" sub-state.
- Dispatch moves reserved to in transit.
- Delivery moves in transit to delivered.
- A return adds to QC hold.

Serialized items get one row per serial/IMEI unit, with its current bucket, warehouse, and the PO,
GRN, QC, SO, DC and warranty references. Each movement row points to its unit.

## 10. Recommended phase plan

The proposed phases are adjusted to what exists. The main change is that **the stock ledger comes
before QC and GRN rework**, because QC outcomes *are* ledger movements. Building QC first would mean
writing GRN-to-stock logic twice. This also changes the CLAUDE.md order (QC -> Stock).

| Phase | Scope | Why here |
|---|---|---|
| **0 - Harden what exists** | Fix races 1-4 (row locks or conditional updates); lock the item on received PO lines (5); add supplier/item delete guards (6); decide the edit-after-issue policy (7); fix `addMember` (8); validate route params and map P2023 (10); add database CHECK constraints; make permissions reach existing tenants (A7); add cross-tenant tests for GRN and documents | Everything later builds on PO and GRN correctness |
| **1 - Platform layer and naming** | Agree on terminology; Main Admin identity and portal; tenant lifecycle and approval; gate or remove public registration; tenant-status check in the middleware; platform audit | The business model depends on it |
| **2 - Tenant RBAC** | Custom role CRUD; action-level permission scheme for all planned modules; roles and members UI; hierarchy guards; unified audit table (A6) | Needed before new modules add permissions |
| **3 - Masters** | Customer master (mirror `Vendor`); item extensions (serial-tracked flag, brand/model, condition grades, warranty defaults); warehouses/bins on `Location` | SO and serials need them |
| **4 - Inventory ledger core** | `stock_movements` (append-only), stock balances by item, warehouse and bucket (locked updates), `serial_units`, opening stock, adjustments; decide composite foreign keys or RLS (A5) | Source of truth for everything after this |
| **5 - GRN rework + QC** | GRN requires a warehouse and captures serials, and posts to QC hold; QC documents move stock to available or rejected; GRN cancel reverses through the ledger; returns to supplier for rejected stock | The procurement flow |
| **6 - Sales Order** | SO, availability check, reservation and release, cancellation | - |
| **7 - Delivery Challan + Dispatch + Delivery** | DC/packing, dispatch, out for delivery, delivered; serial allocation | - |
| **8 - Transfers + Returns** | Warehouse transfers; customer returns with re-inspection | - |
| **9 - Bills / Invoices / GST + Payments** | Bills against GRNs, invoices against deliveries, payments | - |
| **10 - Reports** | Stock by bucket, serial history, ageing, purchase and sales reports | - |
| **11 - Security, performance, QA** | httpOnly cookie sessions and revocation, rate limits, object storage (A8), trigram indexes, load tests, replacing the Zoho GST provider | - |

Each phase goes through the same steps: define the business flow, database, API, frontend,
validation, authorization and transaction boundaries; implement; then run tests, verify existing
flows, test edge cases, tenant isolation, RBAC and inventory consistency. Nothing moves to the next
phase until those tests pass.

## Open decisions (needed before Phase 0)

1. **Naming:** rename in the UI and API only (tenant = "Vendor", `Vendor` = "Supplier"), or rename
   the models too?
2. **Issued POs:** should editing one be blocked, or allowed with re-approval and a revision number?
3. **Registration:** should self-sign-up be disabled completely once the Main Admin exists?
4. **Phase order:** is moving the stock ledger (Phase 4) ahead of QC approved?
