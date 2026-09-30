# Route-permission matrix (legacy API, Phase 2 step 8.7)

Every legacy route requires a legacy permission code (`requirePermission` in the route file). With
platform tokens the code is satisfied when the token's `perms` claim contains any of the mapped new
codes (`LEGACY_PERMISSION_MAP` in `packages/contracts/src/permissions.ts`). The automated matrix
test `apps/api/test/route-permission-matrix.test.ts` mints a token per system role and asserts
403 exactly where the role lacks the permission.

| Legacy route | Legacy permission | New permission(s) |
|---|---|---|
| `GET /api/vendors`, `GET /api/vendors/:id` | `vendor.view` | `supplier.view` |
| `POST /api/vendors`, `PUT /api/vendors/:id`, `PATCH .../status`, `DELETE`, bank reveal | `vendor.create` / `edit` / `status_update` / `delete` / `bank_details_view` | `supplier.manage` |
| `GET /api/items` | `item.view` | `master.view` |
| `POST/PUT/DELETE /api/items` | `item.create` / `edit` / `delete` | `master.manage` |
| `GET /api/purchase-orders`, activity, documents | `purchase_order.view` | `purchase.view` |
| `POST /api/purchase-orders` | `purchase_order.create` | `purchase.create` |
| `PUT /api/purchase-orders/:id` | `purchase_order.edit` | `purchase.edit` |
| `POST .../issue`, `/close`, `/reopen` | `purchase_order.issue` | `purchase.issue` |
| `POST .../cancel` | `purchase_order.cancel` | `purchase.cancel` |
| `DELETE /api/purchase-orders/:id` | `purchase_order.delete` | `purchase.cancel` |
| `GET /api/purchase-receives` | `purchase_receive.view` | `grn.view` |
| `POST /api/purchase-receives` | `purchase_receive.create` | `grn.create` |
| `POST /api/purchase-receives/:id/cancel` | `purchase_receive.cancel` | `grn.cancel` |
| `GET /api/settings/*` | `settings.view` | `master.view` or `settings.manage` |
| `POST/PUT/PATCH /api/settings/*` | `settings.manage` | `settings.manage` |

System roles (rank) and what they may do on the legacy API:

| Role | Suppliers | Items | PO view/create/edit | PO issue | PO cancel | GRN create | GRN cancel | Settings manage |
|---|---|---|---|---|---|---|---|---|
| OWNER (100), ADMIN (90) | all | all | yes | yes | yes | yes | yes | yes |
| PURCHASE_MANAGER (50) | all | view | yes | yes | yes | yes | yes | no |
| PURCHASE_EXECUTIVE (30) | view | view | yes (no approve) | no | no | yes | no | no |
| INVENTORY_MANAGER (50) | no | view | no | no | no | no | no | no |
| QC_MANAGER (50) | no | view | no | no | no | no | no | no |
| SALES_MANAGER, DISPATCH_MANAGER (50) | no | view | no | no | no | no | no | no |
| FINANCE (50) | view | no | view | no | no | no | no | no |
| VIEWER (10) | view | view | view | no | no | no | no | no |

UI elements hidden by role today (UX only, never authorization): PO issue/cancel buttons, GRN cancel,
vendor status toggle, bank-account reveal, settings pages. Backend enforcement is the truth.
