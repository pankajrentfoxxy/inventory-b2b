# Phases 1-5 UI pass: what was built and how it was verified

Date: 2026-09-30. The web app (`apps/web`) now signs in through svc-auth and drives every Phase 1-5
service through the gateway. The legacy pages (vendors, items, legacy POs / receives, settings)
remain mounted under "Legacy" in the sidebar until cut-over. Conventions the modules follow are in
`docs/UI_CONVENTIONS.md`.

## Core

| Piece | Location | Notes |
|---|---|---|
| API client | `src/lib/api.ts` | axios with `withCredentials`, Bearer token + `X-Organization-Id` (legacy API only), single-flight refresh on 401 through the httpOnly cookie (`POST /v1/auth/refresh`), retry once, then `onUnauthorized`; `unwrap` for `{ data }` bodies; `toApiError` normalises the fixed error envelope (`fieldErrors` keyed by dotted path, `details[]`) |
| Session | `src/lib/auth.tsx`, `src/lib/jwt.ts` | Access-token claims decoded client-side (`tokenType`, user, tenant, membership, `perms`, `permissionVersion`, `warehouseIds`); `login` returns `done` / `mfa` / `select`, `verifyMfa`, `selectTenant`, `switchOrganization` (select-tenant with the current tenant token), `logout`; `hasPermission(code | codes[])` with legacy codes mapped through `LEGACY_PERMISSION_MAP`; `usePermission()` keeps the legacy booleans for the old pages |
| Routing | `src/App.tsx`, `src/router/ProtectedRoute.tsx`, `src/router/types.ts` | Feature modules export `RouteDef[]`; `ProtectedRoute` redirects anonymous users to `/login` or `/admin/login`, platform tokens away from tenant pages and vice versa, and shows "No access" when the permission is missing |
| Layout | `src/layout/AppLayout.tsx`, `src/layout/navigation.ts` | Sidebar filtered by permission (Home, Masters, Parties, Inventory, Purchases, Quality, Settings, Legacy); tenant switcher; quick-create menu; global search scoped per section; platform variant (violet) for `/admin/*` |
| Shared primitives added | `src/components/ui/StatusBadge.tsx`, `ListToolbar.tsx`, `Stat.tsx`, `ReasonDialog.tsx` | Any status string -> tone; view switcher + actions + filter chips; work-queue tiles; reason (+ optional confirm code) dialog for destructive transitions |
| Auth pages | `src/features/auth/*` | `/login` (password -> MFA enrolment / code -> tenant selection), `/admin/login`, `/apply` (public vendor application, replaces self-registration; `/register` redirects), `/forgot-password`, `/reset-password?token=`, `/accept-invite?token=` (owner, svc-auth), `/accept-invitation?token=` (member, svc-iam) |
| Home | `src/features/home/HomePage.tsx` | Work queues driven by permission: POs awaiting approval, receipts in QC / failed to post, open QC lots, adjustments to approve; shortcuts |

## Modules

| Module | Routes | Permissions | Notes |
|---|---|---|---|
| IAM (`features/iam`) | `/settings/members` (Members + Invitations tabs), `/settings/roles` (permission matrix), `/settings/audit` | `iam.member.view`, `iam.role.view`, `audit.view`; button gating `iam.member.invite`, `iam.role.assign`, `iam.member.manage`, `iam.member.suspend`, `iam.member.remove`, `iam.role.manage` | Invite (Idempotency-Key), change roles, warehouse scope, suspend / reactivate / remove via `ReasonDialog`; role permissions saved with `If-Match` (409 -> refetch); anti-escalation errors show the offending codes; audit trail with cursor "Load more" |
| Platform console (`features/platform`) | `/admin` (dashboard), `/admin/tenants`, `/admin/tenants/new`, `/admin/tenants/:id` (Overview / Settings / History), `/admin/staff`, `/admin/audit` | `platform.dashboard.view`, `platform.tenant.view|create|edit|approve|activate|suspend|deactivate`, `platform.iam.manage`, `platform.audit.view` | Transitions gated by status and permission: approve / reject (PENDING), activate (APPROVED), suspend (ACTIVE), reactivate (SUSPENDED), deactivate (reason + tenant code as confirm code); resend owner invite (ACTIVE); every command sends an Idempotency-Key |
| Inventory (`features/inventory`) | `/inventory/stock`, `/inventory/stock/:itemId`, `/inventory/ledger`, `/inventory/serials`, `/inventory/serials/:id`, `/inventory/adjustments` (+ `/new`, `/:id`), `/inventory/opening-stock` (manual wizard + bulk import), `/inventory/bin-moves`, `/settings/inventory` | `inventory.view`, `inventory.adjust`, `inventory.adjust.approve`, `inventory.transfer` | Stock list defaults to the first scoped warehouse; adjustments Save / Save and submit / approve (self-approval disabled with hint); `INSUFFICIENT_STOCK` mapped back to the offending line; `INV_OPENING_NOT_ALLOWED` links to adjustments; import results with per-row status and CSV error download; reconciliation runs on demand |
| Masters (`features/master`) | `/masters/products` (+ `/:id`), `/masters/warehouses` (warehouses -> locations -> bins tree), `/masters/catalog` (category tree, brands), `/masters/tax` (units, tax rates, HSN / SAC), `/masters/other` (payment terms, condition grades, warranty policies, custom fields), `/masters/numbering` | `master.view` (or the module view codes the service accepts), `warehouse.view`, `settings.manage` (numbering edit; `master.view` reads) | Product modal enforces service / tracked / serialized / IMEI rules, disables locked fields (`lockedFields`) and shows `referencedBy`; PATCH with `If-Match` sends changed fields only; activate / deactivate / archive via `ReasonDialog`, delete only for DRAFT, `MASTER_IN_USE` shown with details; numbering rows edit inline with a live preview (`{FY}`, `{YYYY}`, `{YY}`); shared `ProductPicker`, `WarehousePicker`, `useScopedWarehouses`, `useWarehouses` |
| Parties (`features/parties`) | `/parties/suppliers`, `/parties/suppliers/new`, `/parties/suppliers/:id`, `/parties/customers` (same three) | `supplier.view|manage`, `customer.view|manage` | Full-page create with tabbed sections (basic, addresses, contacts, bank) and error dots per section; server paths such as `addresses.0.pincode` land on the right field; detail tabs Overview / Addresses / Contacts / Bank accounts / Activity; bank numbers masked with reveal for managers (re-masks after 30 s); block / unblock with reason; shared `PartyPicker` |
| Procurement (`features/procurement`) | `/purchases/orders`, `/purchases/orders/new`, `/purchases/orders/:id/edit` (DRAFT only), `/purchases/orders/:id` (Overview / Approvals / Revisions / Receipts / Attachments), `/purchases/receipts`, `/purchases/receipts/new`, `/purchases/receipts/:id`, `/settings/procurement` | `purchase.view|create|edit|approve|issue|cancel`, `grn.view|create|cancel`, `settings.manage` (settings edit) | PO editor previews totals with `computePurchaseOrderTotals` (intra-state from supplier vs warehouse state) and notes that the server computes the final figures; transitions gated by status x permission with `PO_SELF_APPROVAL` / `PO_APPROVAL_LIMIT` / `PO_HAS_RECEIVES` explained; revise modal keeps received lines immutable and shows a side-by-side revision diff; GRN create pulls `receivable-lines`, captures serials with a scanner-style input (duplicates, pattern, IMEI), sends `Idempotency-Key` (same key re-used on 5xx / network errors), polls the receipt every 2 s while it posts; `POSTING_FAILED` recovery edits only the failed serials; attachments via presign |
| QC (`features/qc`) | `/qc/lots` (views, "Mine", warehouse and source filters), `/qc/lots/:id`, `/qc/checklists` | `qc.view` or `grn.view` (lots), `qc.inspect` (start / results), `qc.approve` (decide / reopen), `qc.manage` (checklists) | Quantity mode with pass / fail auto-complement and defect codes on failures; serial mode with per-unit cards, checklist answers and dirty tracking, Decide disabled until every serial has a saved result; lot polls while DECIDED until inventory posts; checklist editor with product multi-pick |

## Backend changes made for the UI

| Change | Where | Why |
|---|---|---|
| `GET /api/v1/auth/me/tenants` | `apps/svc-auth` (`auth.routes.ts`, `auth.service.ts` `tenantsFor`) | Tenant switcher lists the active memberships of the signed-in user |
| Invitations embed `roles[] { id, key, name }` | `apps/svc-iam` `listInvitations` | A viewer with only `iam.member.view` sees role names without `GET /roles` |
| Reconciliation returns `binId: null` for unbinned rows | `apps/svc-inventory` `reconciliation` | The sentinel UUID never leaves the service |
| `GET /grns?q=` (GRN number, supplier invoice number, PO number) and `poNumber` on every GRN view | `apps/svc-procurement` `grnListQuery`, `listGrns`, `grnView`, `loadGrn` | Global search on the receipts list; receipt rows show the PO number without a second call |
| `GET /lots?q=` (lot number, source document number) | `apps/svc-qc` `lotListQuery`, `list` | Global search on the QC queue |
| Public GSTIN lookup: legacy API GET /api/public/gst/lookup (rate limited, 20 per 15 min per client, checksum-validated GSTIN) + gateway public route /api/public/gst | apps/api integrations.routes.ts, apps/gateway routes.ts | /apply auto-fills legal name, trade name, PAN and registered address when a valid GSTIN is typed (PAN and state still derived locally when the provider is not configured) |
| Log transport prints the mail body | `apps/svc-notification` `transport.ts` | Invitation / reset links are readable from the dev log |
| `notification` added to `infra/postgres/init/00-create-dbs.sh` | infra | Fresh `infra:up` provisions `notification_db` |
| Default Vite proxy -> gateway `:4010`; `@b2b/contracts` dependency | `apps/web/vite.config.ts`, `package.json` | The app talks to services through the gateway; `LEGACY_PERMISSION_MAP` in the browser |

## Verification

| Check | Result |
|---|---|
| `npm run typecheck -w @b2b/web` | pass, 0 errors (every module also clean under `--noUnusedLocals --noUnusedParameters`) |
| `npm run build -w @b2b/web` | pass; one 1.13 MB chunk (311 kB gzip). Route-level code splitting is a follow-up |
| Endpoint smoke as the tenant owner through the gateway (`:4011`) | 200 for `/v1/auth/me/tenants`, `/v1/iam/invitations`, `/v1/procurement/grns?q=`, `/v1/qc/lots?q=`, `/v1/inventory/reconciliation` (`ok: true`), `/v1/inventory/adjustments?status=PENDING_APPROVAL`, `/v1/master/settings/numbering` (14 document types), product and supplier lookups, `/v1/audit`, procurement / inventory settings, `/v1/qc/checklists` |
| `npm test` (api + gateway + every service, serial) | api 134, gateway 11, svc-auth 19, svc-tenant 13, svc-audit 4, svc-notification 4, svc-iam 11, svc-master 10, svc-party 5, svc-inventory 15, svc-qc 4, svc-procurement 8: all pass |
| Auth smoke through a second gateway (`:4011`) against the live services | admin login with MFA enrolment and TOTP, tenant created -> approved by a second reviewer (four-eyes) -> activated, owner invitation accepted, owner login returns a tenant token with 56 permissions and the refresh cookie, `/me/tenants` lists the tenant, `/iam/me` 200, seeded units and warehouse visible, empty lists 200 for products / suppliers / stock / POs / lots, refresh issues a new token |
| Service suites after the UI-driven backend changes | svc-auth 19, svc-iam 11, svc-inventory 15, svc-notification 4: pass |

## Laptop-only catalogue (added 2026-09-30)

| Area | What changed | Verified by |
|---|---|---|
| svc-master | `laptop_spec_options` (8 kinds, RLS, model belongs to brand, unique per kind), products gain 8 spec FKs + `specs` + unique `config_key` (migration `20261002000000_laptop_configurations`); `GET/POST /laptop-specs`, `POST /laptops/preview`, `POST /laptops` (generated SKU, duplicate guard, serialized + QC-required, GST 18% default), `PATCH /laptops/:id` (specs editable only in DRAFT, SKU / default name follow the specs); defaults seeded on activation; `npm run seed:laptop-specs -w @b2b/svc-master` backfills existing tenants | `test/laptop.test.ts` (7 cases), svc-master 16 pass |
| contracts | `LAPTOP_SPEC_FIELDS`, `laptopSpecs`, `productSnapshot.specs` | typecheck |
| svc-inventory | `item_refs.specs` (migration `20261002000000_item_ref_specs`); specs on stock rows, stock item, serial detail; stock search matches spec text | svc-inventory 15 pass |
| svc-qc | unit result HOLD, `laptop_check` column (migration `20261002000000_laptop_qc`); laptop lots require the check; PASS only when all 8 specs match, powers on, nothing missing; FAIL auto-records SPEC_MISMATCH / NO_POWER / MISSING_PARTS; HOLD needs remarks and blocks decide (`QC_UNITS_ON_HOLD`); lot view `isLaptop`, `expectedSpecs`, progress passed / failed / onHold | svc-qc 4 pass |
| End to end | configuration -> PO 10 (specs on line, no stock) -> GRN 10 serials (QC hold 10, available 0, specs on stock) -> auto QC lot with expected specs -> rule violations refused -> 8 pass, 1 fail (RAM 8 GB), 1 hold -> decide blocked -> hold resolved -> AVAILABLE 9, REJECTED 1 -> lot CLOSED, GRN QC_COMPLETED, PO CLOSED -> serial traces to lot, GRN, PO and specs | `apps/svc-procurement/test/laptop-e2e.test.ts`, svc-procurement 9 pass |
| Web | Laptop specifications page (8 cards), Laptop configurations list / create (8 pickers, live SKU preview, duplicate banner) / detail (spec lock after activation); PO editor and detail, GRN create / detail / list, QC lot list, QC laptop inspection panel (match / mismatch per spec, power, missing parts, asset tag, PASS / FAIL / HOLD, decide blocked while on hold), stock list / item, serial traceability card; generic product creation and the categories page removed | web typecheck + build |

## Known gaps (UI)

- Members show "Joined" instead of "Last activity" (the service does not track it).
- Adjustment and serial list rows carry `itemId` only; the UI resolves SKU / name with one lookup per
  distinct item. A server-side item snapshot on those rows would remove the extra calls.
- Ledger and serial history show actor ids, not names (svc-inventory stores `actorId` only).
- Platform staff creation needs an existing `userId` (identities come from `admin:create`).
- Simple masters, locations and bins have create + status endpoints only (no rename); the UI offers add
  and activate / deactivate. `TaxRate.gstRate` / `cessRate` arrive as Decimal strings and are coerced.
- Product CSV import has api / hook support (`masterApi.importProducts`) but no modal yet.
- Product / supplier / warehouse pickers exist per module (master, parties, inventory, procurement) as thin
  wrappers over the shared `SearchSelect` / `Select` primitives with module-specific snapshot types;
  consolidating them onto the master and parties exports is a follow-up.
- Approvals, revisions, QC lots and ledger rows carry actor ids only; names need an `actorName` on
  those rows.
- The web app has no browser-level end-to-end tests yet; the UI pass was verified by typecheck, build
  and the endpoint smoke above.
- Tenant edit cannot clear GSTIN / PAN / phone (empty strings are omitted from the PATCH).
- Bills, payments, sales and reports are placeholders in the sidebar ("soon") until their phases.
