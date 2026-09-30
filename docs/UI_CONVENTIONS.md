# Web app conventions for the service-backed modules (Phases 1-5 UI)

The web app (`apps/web`) talks to the gateway at `/api`. Service endpoints are `/api/v1/<service>/...`
(`api.get('/v1/master/products')`); legacy endpoints keep their `/api/<path>` form. Every response is
`{ data: T }` (use `unwrap` from `lib/api.ts`); errors follow the fixed envelope and `toApiError`
normalises them (`fieldErrors` keyed by dotted path, `details[]`, `code`, `message`).

## Feature folder

`src/features/<module>/` with `api.ts` (axios calls, typed), `types.ts`, `hooks.ts` (react-query
keys + hooks, invalidate after writes), `pages/`, `components/`, and `routes.tsx` exporting
`const <module>Routes: RouteDef[]` (`src/router/types.ts`): `{ path, permission, element }`.
`App.tsx` mounts every route inside `ProtectedRoute` + `AppLayout`; platform pages use
`area="platform"` and the platform layout variant.

## Building blocks (use these, do not add a second table / modal / button)

- `components/ui`: `Button`, `IconButton`, `Badge`, `StatusBadge` (any status string -> tone),
  `Card`, `CardHeader`, `CardBody`, `DescriptionList`, `PageHeader` (title, breadcrumbs, actions),
  `ListToolbar` (view switcher + actions + filter chips), `DataTable` (+ `Pagination`), `Tabs`,
  `Modal`, `ConfirmDialog`, `ReasonDialog` (reason + optional confirm code), `Dropdown`,
  `Field`/`Input`/`Select`/`Textarea`/`Checkbox`/`RadioPill`/`FormSection`, `Combobox`,
  `SearchSelect` (async picker), `Stat`/`StatGrid`, `ActivityTimeline`, `EmptyState`,
  `ErrorState`, `Skeleton`, `TableSkeleton`, `DetailSkeleton`, `FormSkeleton`.
- `hooks/useUrlFilters` (URL-backed list filters), `hooks/useDebouncedValue`,
  `hooks/useIdempotencyKey` (+ `withIdempotencyKey` for creating POSTs that must never double-apply:
  GRN create, opening stock, bin moves, adjustments, PO commands).
- `lib/utils`: `formatDate`, `formatDateTime`, `formatMoney`, `formatQty`, `humanize`, `cn`.
- `lib/validation`: `applyServerErrors(setError, apiError)` pushes API field errors onto
  react-hook-form fields; `summarizeErrors` for the toast.
- Permissions: `useAuth().hasPermission(code | codes[])`, `<PermissionGate permission=...>`; codes
  are the new catalogue (`purchase.approve`, `inventory.adjust.approve`, ...). Legacy codes still
  work through the mapping.
- Warehouse scope: `useAuth().warehouseIds` (null = all). Pickers should default to the first
  scoped warehouse; the API returns 403 `WAREHOUSE_SCOPE` / `GRN_WAREHOUSE_SCOPE` otherwise.

## Page patterns

- **List page**: `ListToolbar` (views by status, "New" button, filter selects, chips) over a `Card`
  containing `DataTable`; filters live in the URL via `useUrlFilters`; the global search box writes
  `?q=` for new lists. Row click opens the detail; row actions in a `Dropdown`. Required states:
  loading (`TableSkeleton` via `loading`), empty (`EmptyState` with a call to action when the user
  may create), error (`ErrorState` with retry), success toast after writes.
- **Detail page**: `PageHeader` with breadcrumbs, `StatusBadge`, primary actions on the right
  (state transitions as buttons; destructive ones through `ReasonDialog`), then `Tabs` or a
  two-column grid of `Card`s with `DescriptionList`. Activity / history where the API offers it.
- **Forms**: react-hook-form; controlled inputs with `sanitize` kinds; server validation is the
  truth (`applyServerErrors`); `If-Match` header with the record `version` on PATCH; toast on
  success; disable the primary button while pending. Modal forms for small masters, full pages for
  documents (PO, GRN, adjustment, opening stock).
- **Money and quantities**: never recompute totals in a component; show what the API returns.
  The PO form previews totals with `computePurchaseOrderTotals` from `@b2b/shared`.
- **Async processes** (GRN posting to inventory, QC decision posting): show a "Posting to
  inventory..." banner and poll the document every 2 s for up to 30 s
  (`refetchInterval` while status is RECEIVED / DECIDED).
- ASCII only in source files. No new colours: use the Tailwind tokens already in use
  (`brand-*`, `navy-*`, `slate-*`, `emerald`, `amber`, `red`, `violet`).
