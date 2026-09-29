# Vendor Management module

Functional reference for the first Inventory module. Zoho Inventory's vendor flow was the UX
reference; the implementation uses this app's own design system and tenancy model.

## Routes (web)

| Path | Page | Permission |
|---|---|---|
| `/purchases/vendors` | Vendor list (search, filters, sort, pagination, bulk status) | `vendor.view` |
| `/purchases/vendors/new` | Add vendor (GST prefill, primary contact, tabs) | `vendor.create` |
| `/purchases/vendors/:id` | Vendor details (overview, transactions, notes, documents, activity) | `vendor.view` |
| `/purchases/vendors/:id/edit` | Edit vendor | `vendor.edit` |
| `/settings/vendor-fields` | Custom fields & reporting tags admin | `settings.view` / `settings.manage` |

## API

All routes under `/api` require `Authorization: Bearer <jwt>` and `X-Organization-Id: <uuid>`
(except `/api/auth/*`). The caller must be an active member of that organization; otherwise
403 `ORGANIZATION_ACCESS_DENIED`. Records from other tenants are indistinguishable from
missing ones (404).

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/vendors` | vendor.view | `page, limit(<=100), search, status(ACTIVE/INACTIVE/ALL), sortBy, sortOrder, gstTreatmentId, sourceOfSupplyId, vendorType, tagOptionId`. Returns `data, pagination, counts` |
| POST | `/vendors` | vendor.create | full aggregate (addresses, contacts, bankAccounts, customFields, reportingTags) |
| GET | `/vendors/:id` | vendor.view | full profile; bank numbers masked |
| PUT | `/vendors/:id` | vendor.edit | full aggregate; children reconciled by `id` (missing = removed) |
| PATCH | `/vendors/:id/status` | vendor.status_update | `{ status, reason? }` |
| DELETE | `/vendors/:id` | vendor.delete | soft delete (`deleted_at`, status INACTIVE) |
| GET | `/vendors/:id/activity` | vendor.view | paginated audit trail |
| GET | `/vendors/:id/transactions` | vendor.view | summary + per-module `{ available, items, total }` |
| POST/PUT/DELETE | `/vendors/:id/contacts[/:contactId]` | vendor.edit | one primary enforced |
| POST/PUT/DELETE | `/vendors/:id/addresses[/:addressId]` | vendor.edit | one primary per type |
| POST/PUT/DELETE | `/vendors/:id/bank-accounts[/:accountId]` | vendor.edit | numbers encrypted |
| GET | `/vendors/:id/bank-accounts/:accountId/reveal` | vendor.bank_details_view | audited |
| GET/POST/DELETE | `/vendors/:id/notes[/:noteId]` | view / edit | |
| GET/POST/DELETE | `/vendors/:id/documents[/:documentId]` | view / edit | multipart `file`, 10 MB |
| GET | `/vendors/:id/documents/:documentId/download` | vendor.view | |
| GET | `/settings/vendor-form-options` | vendor.view | all masters the form needs in one call |
| GET/POST/PATCH | `/settings/custom-fields[/:id]` | settings.view / settings.manage | type immutable |
| GET/POST/PATCH | `/settings/reporting-tags[/:id]` | settings.view / settings.manage | options reconciled by name |
| GET/POST/PATCH | `/settings/gst-treatments[/:id]` | settings.view / settings.manage | |
| GET/POST/PATCH | `/settings/payment-terms[/:id]` | settings.view / settings.manage | |
| GET | `/integrations/gst/lookup?gstin=` | vendor.create/edit | 501 until a provider is configured |
| POST | `/auth/register`, `/auth/login`; GET `/auth/me` | - | |
| GET | `/organizations/current`, `/current/roles`, `/current/members` | - / settings.view | |
| POST/PATCH | `/organizations/current/members[/:memberId]` | settings.manage | |

Error envelope: `{ error: { code, message, details?: [{ path, message }] } }`.
Status codes: 400 malformed request / missing tenant header, 401 no or expired token,
403 not a member or missing permission, 404 not found (incl. other tenant), 409 duplicate,
413 upload too large, 422 validation, 501 integration not configured.

## Database

`organizations`, `users`, `permissions`, `roles`, `role_permissions`, `organization_members`
form the tenancy/RBAC core. Vendor tables (all with `organization_id`):

```
vendors 1-* vendor_addresses         (type BILLING|SHIPPING, one primary per type)
        1-* vendor_contacts          (one primary)
        1-* vendor_bank_accounts     (AES-256-GCM encrypted number + last4, one primary)
        1-* vendor_custom_field_values -> custom_field_definitions
        1-* vendor_reporting_tags     -> reporting_tags / reporting_tag_options
        1-* vendor_documents
        1-* vendor_notes
        1-* vendor_activities        (append-only audit)
        *-1 gst_treatments, sources_of_supply, payment_terms, currencies
```

Constraints beyond Prisma: `UNIQUE (organization_id, lower(display_name)) WHERE deleted_at IS NULL`,
partial unique indexes for the primary flags, `pg_trgm` GIN indexes for list search.
Future transaction tables (purchase_orders, purchase_receives, bills, payments, vendor_credits,
returns) reference `vendors.id` via `vendor_id` and never copy vendor fields.

## RBAC

Permissions: `vendor.view`, `vendor.create`, `vendor.edit`, `vendor.delete`, `vendor.status_update`,
`vendor.bank_details_view`, `settings.view`, `settings.manage`.
Default roles per organization: Owner / Admin (all), Purchase Manager (all vendor except delete),
Purchase Executive (view, create, edit), Viewer (view). Role permissions resolve per request from
the DB; suspending a member takes effect immediately.

## Validation (shared zod, enforced by API and web)

Field builders and messages are documented in `docs/VALIDATION.md`; this list is the vendor-specific summary.

- Display name required, trimmed, unique per organization (case-insensitive, live rows). Person
  names (first/last, contact person) allow letters and `. ' -` only; company / display / bank
  names also allow digits and trade punctuation.
- Email format (trimmed); work phone 6-15 digits; mobile with `+91` must be exactly 10 digits
  starting 6-9 (contact mobiles always). Stored digits-only; dial code `+NN`. Website http(s) only.
- GSTIN: 15 chars, pattern + mod-36 check digit; required when the GST treatment's `requiresGstin` is true.
- PAN: pattern; must equal GSTIN characters 3-12 when both given.
- IFSC pattern; account number 6-34 alphanumerics; Indian PIN 6 digits not starting with 0.
- At most one primary contact / bank account; one primary address per type.
- MSME number required when MSME is ticked; TDS section required when TDS is ticked.
- Custom fields: type-checked per definition, required flags honoured, dropdown values restricted.
- Masters (GST treatment, source of supply, payment term, tag options) must belong to the tenant and be active.

## Audit

`vendor_activities` rows: VENDOR_CREATED/UPDATED/STATUS_CHANGED/DELETED, CONTACT_*, ADDRESS_*,
BANK_ACCOUNT_ADDED/UPDATED/REMOVED/REVEALED, CUSTOM_FIELDS_UPDATED, REPORTING_TAGS_UPDATED,
NOTE_*, DOCUMENT_*. Each stores user id + name, action, entity, summary, `old_value`/`new_value`
field diffs. Bank account numbers appear only masked.

## Extension points

- `modules/integrations/gst.service.ts`: implement `GstLookupProvider`, register it, set `GST_PROVIDER`.
- `getVendorTransactions`: add a loader per module as PO/GRN/Bills ship.
- `deleteVendor`: add a referential guard once transactions exist.
- `taxConfig` JSON on vendors for TDS/TCS rate tables and e-invoicing flags.
