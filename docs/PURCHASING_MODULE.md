# Purchasing: Items, Purchase Orders, Purchase Receives

Second slice of the Inventory roadmap. Zoho Inventory's purchase order flow was the UX reference.

## Workflow

```
Item master  -->  Purchase Order (DRAFT)  --issue-->  ISSUED
                                                     |  receive goods (GRN)
                                                     v
                                    PARTIALLY_RECEIVED  -->  RECEIVED
   any open state --close-->  CLOSED  --reopen-->  (re-derived)
   DRAFT / ISSUED / PARTIALLY_RECEIVED / CLOSED  --cancel-->  CANCELLED  (only when no receives)
   DRAFT / CANCELLED  --delete-->  soft-deleted
```

- Editing is allowed in DRAFT, ISSUED and PARTIALLY_RECEIVED. Lines with received quantity
  cannot be removed or reduced below what was received; the vendor is locked once anything was received.
- A purchase receive (GRN) records quantities against PO lines, never more than the remaining
  quantity. Cancelling a receive reverses the quantities and re-derives the PO status.
- Stock is **not** updated yet; that arrives with the Inventory Stock module.

## Routes (web)

| Path | Page | Permission |
|---|---|---|
| `/items` | Item list + create/edit modal | `item.view` |
| `/purchases/purchase-orders` | PO list (views, filters, bulk issue) | `purchase_order.view` |
| `/purchases/purchase-orders/new` | New PO (Zoho-style form) | `purchase_order.create` |
| `/purchases/purchase-orders/:id` | PO detail (overview, receives, attachments, activity) | `purchase_order.view` |
| `/purchases/purchase-orders/:id/edit` | Edit PO | `purchase_order.edit` |
| `/purchases/purchase-receives` | GRN list | `purchase_receive.view` |
| `/purchases/purchase-receives/new?po=` | Record a receive | `purchase_receive.create` |
| `/purchases/purchase-receives/:id` | GRN detail | `purchase_receive.view` |
| `/settings/purchases` | Locations, taxes, numbering, PO custom fields | `settings.view` |

## API (all tenant-scoped, `Authorization` + `X-Organization-Id`)

| Method | Path | Permission |
|---|---|---|
| GET/POST | `/items` | item.view (or any PO permission) / item.create |
| GET/PUT/DELETE | `/items/:id` | item.view / item.edit / item.delete |
| PATCH | `/items/:id/status` | item.edit |
| GET | `/purchase-orders` | purchase_order.view. Query: `page, limit, search, status (ALL/OPEN/<status>), vendorId, dateFrom, dateTo, sortBy, sortOrder` |
| GET | `/purchase-orders/next-number` | purchase_order.create or edit |
| POST | `/purchase-orders?issue=true` | purchase_order.create (+ issue when `issue=true`) |
| GET/PUT/DELETE | `/purchase-orders/:id` | view / edit / delete |
| POST | `/purchase-orders/:id/issue`, `/close`, `/reopen` | purchase_order.issue |
| POST | `/purchase-orders/:id/cancel` | purchase_order.cancel |
| GET | `/purchase-orders/:id/activity` | purchase_order.view |
| GET/POST/DELETE | `/purchase-orders/:id/documents[/:docId]` (+ `/download`) | view / edit |
| GET | `/purchase-receives` | purchase_receive.view. Query: `page, limit, search, status, vendorId, purchaseOrderId, sortBy, sortOrder` |
| GET | `/purchase-receives/next-number` | purchase_receive.create |
| POST | `/purchase-receives` | purchase_receive.create |
| GET | `/purchase-receives/:id` | purchase_receive.view |
| POST | `/purchase-receives/:id/cancel` | purchase_receive.cancel |
| GET | `/settings/purchase-order-form-options` | any purchasing view permission |
| GET/POST/PATCH | `/settings/locations[/:id]`, `/settings/taxes[/:id]` | settings.view / settings.manage |
| GET / PUT | `/settings/document-sequences[/:docType]` | settings.view / settings.manage |
| GET/POST/PATCH | `/settings/custom-fields?entityType=PURCHASE_ORDER` | settings.view / settings.manage |

## Totals (shared `computePurchaseOrderTotals`)

1. Line amount = quantity x rate (2 dp).
2. Transaction discount (percent or amount, capped at subtotal) is pro-rated across lines
   before tax; rounding drift lands on the last non-zero line.
3. Tax per line = taxable x rate. Intra-state (Source of Supply == Destination of Supply)
   splits each rate into CGST + SGST; otherwise IGST. Source defaults to the vendor's state and
   destination to the delivery address state; both are editable on the PO
   (`sourceOfSupplyCode`, `destinationOfSupplyCode`) and validated against the state master.
   Breakup is stored on the PO.
4. TDS is subtracted / TCS added on the taxable total; then the signed adjustment.
5. The API recomputes and persists; the web form uses the same function for the live preview.

## Numbering

`document_sequences` per organization and document type (`PO-`, `GRN-`, 5 digits). Allocation
locks the row `FOR UPDATE` inside the create transaction and skips numbers already used manually.
A manually typed number that matches the prefix moves the sequence past it.

## Database

`locations`, `taxes`, `document_sequences`, `items`, `purchase_orders`, `purchase_order_lines`,
`purchase_order_custom_field_values`, `purchase_order_documents`, `purchase_order_activities`,
`purchase_receives`, `purchase_receive_lines`. Hand-written constraints: unique PO number per
organization among live rows, unique receive number, unique SKU per organization among live items,
one primary location, one default tax, trigram indexes for search.

## Permissions

`item.view/create/edit/delete`, `purchase_order.view/create/edit/issue/cancel/delete`,
`purchase_receive.view/create/cancel`. Purchase Manager holds all of them; Purchase Executive can
create/edit items and POs and record receives but cannot issue, cancel or delete; Viewer is read-only.

## Deferred

- Account column on lines (needs a chart of accounts).
- "Customer" delivery address option (needs the Customers module); "Other address" covers drop-ship today.
- PDF template / email to vendor.
- Stock movement on receive (Inventory Stock module).
- Billed status on receives (Bills module).
