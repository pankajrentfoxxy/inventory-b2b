# B2B Inventory - project rules

Multi-tenant B2B inventory app for Rentfoxxy. npm workspaces: `apps/api` (Express + Prisma +
PostgreSQL), `apps/web` (Vite + React + Tailwind), `packages/shared` (zod schemas, validators,
permission catalogue, PO arithmetic). Module roadmap: Vendors (done) -> Items (done, minimal) ->
Purchase Orders (done) -> GRN / Purchase Receives (done) -> QC -> Stock -> Transfers -> Sales Orders
-> Dispatch -> Invoices/GST -> Payments -> Reports. See `docs/VENDOR_MODULE.md` and
`docs/PURCHASING_MODULE.md`.

## Commands

```bash
npm run dev                # api :4000 + web :5173
npm run typecheck          # all three packages
npm test                   # API integration tests against b2b_inventory_test (run test:setup first once)
npm run db:migrate:dev -w @b2b/api -- --name <change>   # new migration
npm run db:seed            # demo orgs/users only, never vendors
```

## Non-negotiables

- **Tenant scoping at the data layer.** Every business table has `organization_id`. Every query
  filters on `ctx.organizationId`; lookups go through `findLiveVendorOrThrow`-style helpers.
  A record from another tenant returns 404, never 403 (do not confirm existence).
- **Backend authorization is the truth.** Routes: `requireAuth` -> `requireOrganization` ->
  `requirePermission(code)`. UI gating (`usePermission`, `PermissionGate`) is a convenience only.
  New permissions go in `packages/shared/src/permissions.ts`; the seed / register flow syncs them.
- **Validation lives in `packages/shared`** (zod). Schemas compose the builders in
  `packages/shared/src/validation/fields.ts` (`mobileField`, `gstinField`, `amountField`, ...);
  regexes live only in `validators.ts`, messages only in `validation/messages.ts`. API validates
  with `validateBody` / `validateQuery` / `validateParams`; the web form uses the same schema
  through `zodResolver`, gives inputs a `sanitize` kind, and maps API errors with
  `applyServerErrors`. Never write a regex or a validation message in app code. See `docs/VALIDATION.md`.
- **Error envelope is fixed**: `{ success: false, message, error: { code, message, details }, errors }`
  built by `errorBody` in `apps/api/src/lib/errors.ts`. Never `res.json({ error: ... })` by hand.
- **Soft delete.** Vendors get `deleted_at`; never hard-delete business records.
- **Audit every write** to a vendor through `recordActivity`. Never put full bank account numbers,
  passwords or tokens in audit rows (`bankAccountSnapshot` masks).
- **Masters over hardcoding.** GST treatment, source of supply, payment terms, custom fields and
  reporting tags are organization-scoped tables provisioned in `organization.service.ts`.
- **Transactions reference `vendor_id`**; never copy vendor fields into PO/GRN/bill rows. PO lines
  snapshot item name / HSN / tax rate at order time (documents must not change retroactively).
- **Money math lives in `packages/shared/src/purchase.math.ts`.** The API persists the result;
  the web form only previews with the same function. Never reimplement totals in a component.
- **Document numbers come from `documentNumber.service.ts`** (row lock inside the create
  transaction). Never accept a number from the client without `claimManualDocumentNumber`.
- **Status transitions go through the service functions** (`issue/cancel/close/reopen`,
  `recomputeReceiveStatus`). Never `update({ status })` from a route.
- Test files reset the same database, so the runner is serial (`--test-concurrency=1`). Keep it.
- Use the primitives in `apps/web/src/components/ui`. Do not add a second table, modal or button.
- All UI states are required: loading (skeleton), empty, error (with retry), success (toast).
- ASCII only in source files (the Windows shell mangles heredocs with non-ASCII characters).

## Adding the next module

1. Prisma models with `organization_id` + indexes; migration via `prisma migrate dev`.
2. `apps/api/src/modules/<name>/` with `*.routes.ts`, `*.service.ts`, `*.repository.ts`; mount in `app.ts`.
3. Permissions in shared `PERMISSIONS` + `DEFAULT_ROLES`.
4. Web feature folder mirroring `features/vendors` (api.ts, hooks.ts, types.ts, pages/, components/).
5. Integration tests in `apps/api/test` covering RBAC and cross-tenant access.
