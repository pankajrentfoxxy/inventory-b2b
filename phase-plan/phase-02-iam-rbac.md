# Phase 2 — IAM / RBAC

> Prerequisite: Phase 1 COMPLETE. Introduces `svc-iam` as the single owner of memberships, invitations, roles and permissions for both tenants and the platform.

---

## 2.1 Goal & scope

**In scope**
- Memberships (user ↔ tenant), member suspension/removal
- Invitations (email, expiry, resend, revoke, accept)
- Permission catalog (code-defined, versioned, seeded)
- System roles (seeded per tenant) + custom roles
- Role hierarchy / anti-escalation rules
- Optional data scope: restrict a member to specific warehouses
- Backend enforcement in every service via `platform-kit/permission-guard`  
- Permission-version revocation so changes take effect within one request
- Permission audit
- Migration of Phase 1 bootstrap tables (`tenant_memberships_bootstrap`, `platform_role_assignments`) into `iam_db`
- `web-app` Settings → Users, Roles, Permissions; permission-driven navigation

**Out of scope:** SSO/SAML, field-level permissions, approval workflows engine (per-module approvals are handled in their phases).

---

## 2.2 Step 1 — Understand
- [ ] Legacy role concept (if any) and how it maps to new roles
- [ ] Every legacy route and the permission it should require → produce `route-permission-matrix.md` (becomes a test fixture)
- [ ] Which UI elements are currently hidden by role (these are UX only; list them)

---

## 2.3 Step 2 — Business flow

```text
Tenant OWNER/ADMIN
  │
  ├─ Invite user (email, role(s), optional warehouse scope)
  │      → invitation PENDING → email → accept (set password or link existing identity)
  │      → membership ACTIVE
  │
  ├─ Change member roles  → permission version++ → member's next request re-evaluated
  ├─ Suspend member       → sessions for that membership revoked → 403 MEMBER_SUSPENDED
  ├─ Reactivate / Remove member
  │
  └─ Roles
        ├─ System roles (OWNER, ADMIN, PURCHASE_MANAGER, …) — permissions editable? NO (clone instead)
        └─ Custom roles — create/clone/edit/delete (delete blocked while assigned)
```

### Membership state machine
| From | Command | To | Permission |
|---|---|---|---|
| — | invite | INVITED | `iam.member.invite` |
| INVITED | accept | ACTIVE | invite token |
| INVITED | revoke-invite | REVOKED | `iam.member.invite` |
| INVITED | (expiry job) | EXPIRED | system |
| ACTIVE | suspend | SUSPENDED | `iam.member.suspend` |
| SUSPENDED | reactivate | ACTIVE | `iam.member.suspend` |
| ACTIVE, SUSPENDED | remove | REMOVED | `iam.member.remove` |

### Anti-escalation rules (enforced server-side)
1. You can only grant permissions you hold yourself.
2. Every role has a `rank` (OWNER=100, ADMIN=90, managers=50, executives=30, VIEWER=10, custom = rank ≤ creator's max rank − 1). You can only assign/edit/remove roles with rank lower than your highest rank.
3. The last active OWNER cannot be suspended, removed or demoted (`IAM_LAST_OWNER`).
4. `platform.*` permissions are never grantable in a tenant context; the catalog marks them `scope=PLATFORM` and tenant role APIs reject them.
5. A member cannot change their own roles.

---

## 2.4 Step 3 — Architecture

| Concern | Owner |
|---|---|
| Permission catalog, roles, role-permissions, memberships, invitations, warehouse scopes | svc-iam |
| Identity (user row, password) | svc-auth |
| Token issuance with `perms`, `pv` | svc-auth — asks svc-iam `GET /internal/v1/memberships/{id}/effective-permissions` at login/refresh |
| Enforcement | every service (`platform-kit`) + gateway (`pv` check) |

**Permission change propagation**
```text
Admin changes role R
  svc-iam tx: update role_permissions; for each membership with role R: permission_version++
              outbox iam.permissions.changed.v1 {tenantId, membershipIds[], newVersions}
  gateway consumer: SET permver:{mid} = newVersion
  next request with old token (pv < permver) → 401 PERMISSIONS_STALE
  web-app interceptor: silent refresh → new token with new perms → retry once
```
Result: effective within one request; no stale permissions for the 10-minute token lifetime.

**Permission catalog lives in code** (`packages/contracts/permissions.ts`) so services and UI compile against the same codes. svc-iam syncs it into the DB on deploy (adds new codes, flags removed ones as deprecated — never silently deletes grants).

---

## 2.5 Step 4 — Database (`iam_db`)

```sql
CREATE TABLE permissions (
  code text PRIMARY KEY,                -- 'purchase.approve'
  module text NOT NULL,                 -- 'purchase'
  scope text NOT NULL CHECK (scope IN ('TENANT','PLATFORM')),
  description text NOT NULL,
  is_sensitive boolean NOT NULL DEFAULT false,   -- e.g. inventory.adjust, iam.role.manage
  deprecated_at timestamptz
);

CREATE TABLE roles (
  id uuid PRIMARY KEY,
  tenant_id uuid,                       -- NULL = platform role
  key text NOT NULL,                    -- 'PURCHASE_MANAGER' or 'custom_ops_lead'
  name text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  rank int NOT NULL CHECK (rank BETWEEN 1 AND 100),
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, key)
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES permissions(code),
  tenant_id uuid,                       -- denormalised for RLS
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY,
  tenant_id uuid,                       -- NULL for platform staff membership
  user_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('INVITED','ACTIVE','SUSPENDED','REMOVED')),
  permission_version int NOT NULL DEFAULT 1,
  all_warehouses boolean NOT NULL DEFAULT true,
  joined_at timestamptz, suspended_at timestamptz, removed_at timestamptz,
  version int NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE membership_roles (
  membership_id uuid NOT NULL REFERENCES memberships(id),
  role_id uuid NOT NULL REFERENCES roles(id),
  tenant_id uuid,
  assigned_by uuid NOT NULL, assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (membership_id, role_id)
);

CREATE TABLE membership_warehouse_scopes (   -- used only when all_warehouses=false
  membership_id uuid NOT NULL REFERENCES memberships(id),
  warehouse_id uuid NOT NULL,               -- id from svc-master (Phase 3); validated then
  tenant_id uuid NOT NULL,
  PRIMARY KEY (membership_id, warehouse_id)
);

CREATE TABLE invitations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  email citext NOT NULL,
  role_ids uuid[] NOT NULL,
  warehouse_ids uuid[],
  token_hash char(64) NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('PENDING','ACCEPTED','REVOKED','EXPIRED')),
  invited_by uuid NOT NULL,
  expires_at timestamptz NOT NULL,          -- 72 h
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invitations_one_pending ON invitations (tenant_id, email) WHERE status = 'PENDING';
```
RLS on all tenant-scoped tables (platform rows with `tenant_id IS NULL` are only reachable by the platform code path using a separate policy).

**Seed per tenant on `tenant.tenant.activated.v1`:** the 10 system roles with default permission sets (table below), and the owner membership (migrated from the Phase 1 bootstrap table).

### Default permission sets
| Role | Rank | Permissions (summary) |
|---|---|---|
| OWNER | 100 | all tenant permissions |
| ADMIN | 90 | all except `iam.owner.transfer` |
| PURCHASE_MANAGER | 50 | purchase.*, grn.*, supplier.*, qc.view, inventory.view, master.view |
| PURCHASE_EXECUTIVE | 30 | purchase.view/create/edit, grn.view/create, supplier.view |
| INVENTORY_MANAGER | 50 | inventory.*, grn.view, qc.view, master.view, warehouse.* |
| QC_MANAGER | 50 | qc.*, grn.view, inventory.view |
| SALES_MANAGER | 50 | sales.*, customer.*, inventory.view, inventory.reserve, dispatch.view |
| DISPATCH_MANAGER | 50 | dispatch.*, sales.view, inventory.view |
| FINANCE | 50 | billing.*, payment.*, purchase.view, sales.view, reports.* |
| VIEWER | 10 | *.view |

Full permission list = the brief's §8 list plus: `supplier.*`, `customer.*`, `master.view/manage`, `warehouse.view/manage`, `iam.member.view/invite/suspend/remove`, `iam.role.view/manage`, `audit.view`, `reports.view/export`, `returns.*`, `transfer.view/create/receive`, `settings.manage`.

---

## 2.6 Step 5 — API (`/api/v1/iam`)

| Method & path | Permission | Notes |
|---|---|---|
| `GET /permissions` | `iam.role.view` | Catalog grouped by module (tenant scope only) |
| `GET /roles` | `iam.role.view` | With member counts |
| `POST /roles` | `iam.role.manage` | `{name, description, permissionCodes[], rank}`; anti-escalation checks |
| `POST /roles/{id}/clone` | `iam.role.manage` | |
| `PUT /roles/{id}/permissions` | `iam.role.manage` | Full replace; system roles → 422 `IAM_SYSTEM_ROLE_IMMUTABLE`; `If-Match` |
| `DELETE /roles/{id}` | `iam.role.manage` | 422 if assigned |
| `GET /members?status=&roleId=` | `iam.member.view` | |
| `POST /invitations` | `iam.member.invite` | `{email, roleIds[], warehouseIds?}`; Idempotency-Key |
| `POST /invitations/{id}/resend` / `/revoke` | `iam.member.invite` | |
| `POST /members/{id}/roles` | `iam.role.assign` | Full replace of role set |
| `POST /members/{id}/suspend` / `/reactivate` / `/remove` | `iam.member.suspend` / `iam.member.remove` | Reason required |
| `PUT /members/{id}/warehouse-scope` | `iam.member.manage` | |
| `GET /me` | authenticated | Profile, tenant, roles, effective permissions, warehouse scope — UI uses this for navigation |
| `GET /internal/v1/memberships/{id}/effective-permissions` | service token | For svc-auth |

Platform equivalents under `/api/v1/platform/iam/*` for platform staff (permission `platform.iam.manage`).

**Enforcement in services** — decorator:
```ts
@Post(':id/approve')
@RequirePermission('purchase.approve')
@WarehouseScoped({ from: 'entity.warehouseId' })   // optional, checks membership scope
approve(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) { … }
```
A CI check fails the build if any controller route lacks `@RequirePermission` or an explicit `@Public()`/`@AuthenticatedOnly()`.

Error codes: `FORBIDDEN` (403, includes missing permission code in `details` for UX), `IAM_ESCALATION_DENIED` (403), `IAM_LAST_OWNER` (422), `IAM_INVITE_EXPIRED` (410), `MEMBER_SUSPENDED` (403), `PERMISSIONS_STALE` (401).

---

## 2.7 Step 6 — Events

| Event | Producer | Consumers |
|---|---|---|
| `iam.invitation.created.v1` | iam | notification (email), audit |
| `iam.membership.activated.v1` | iam | auth (link identity), audit |
| `iam.membership.suspended.v1` / `removed.v1` | iam | auth (revoke sessions for membership), gateway (`member-status:{mid}`), audit |
| `iam.permissions.changed.v1` | iam | gateway (`permver`), audit (`USER_ROLE_CHANGED`, `ROLE_PERMISSIONS_CHANGED` with old/new sets) |
| consumes `tenant.tenant.activated.v1` | — | iam seeds roles + owner membership (idempotent by unique `(tenant_id,key)`) |

---

## 2.8 Step 7 — Frontend (`web-app` → Settings)

| Page | Notes |
|---|---|
| Users | Table: name, email, roles, status, last login; actions by permission; invite drawer (email, roles multi-select filtered to assignable roles, warehouse scope) |
| Pending invitations | Resend / revoke; shows expiry |
| Roles | List with system badge; clone; create custom role |
| Role editor | Permission matrix grouped by module (rows = modules, columns = view/create/edit/approve/…); sensitive permissions highlighted; disabled checkboxes for permissions the editor doesn't hold (tooltip explains) |
| Permission-driven nav | Sidebar built from `GET /me` permissions; `<PermissionGate perm="purchase.approve">` wraps buttons; routes guarded → "You don't have access" page instead of blank |

On `401 PERMISSIONS_STALE` the API client refreshes once and retries; on `403 FORBIDDEN` shows a toast naming the missing permission.

---

## 2.9 Step 8 — Implementation order
1. `packages/contracts/permissions.ts` catalog + default role sets
2. svc-iam schema, seeding consumer, migration from bootstrap tables
3. Role/membership/invitation APIs with anti-escalation
4. svc-auth: fetch effective permissions at login/refresh; embed `perms`, `pv`
5. Gateway `permver` + `member-status` checks
6. `platform-kit/permission-guard` + CI route-coverage check
7. **Legacy-api: apply permission checks to every route per `route-permission-matrix.md`** (until those modules are extracted)
8. Frontend settings pages + PermissionGate + nav

---

## 2.10 Step 9 — Tests
- Route matrix test: for every route × every system role → expected 2xx/403 (generated from the matrix file)
- Escalation: PURCHASE_MANAGER tries to create role with `iam.role.manage` → 403; ADMIN assigns OWNER → 403; member edits own roles → 403
- Last owner protection
- Permission change effective on next request (assert 401 PERMISSIONS_STALE then success after refresh with new perms)
- Suspended member blocked within 2 s; reactivated member regains access
- Invite: expired token → 410; accepted twice → second fails; duplicate pending invite → 409
- Tenant role APIs reject `platform.*` codes
- Warehouse scope: scoped user cannot read/act on other warehouse's GRN (legacy) → 404
- Tenant isolation: roles/members of Tenant B invisible to Tenant A

## 2.11 Step 10 — Verification
- [ ] `audit_events` shows old/new permission sets on every role change
- [ ] UI hides restricted actions **and** direct API calls are blocked (tested with curl scripts)
- [ ] Token claims match DB effective permissions for sampled users

## 2.12 Step 11 — Regression
Phase 0–1 suites; legacy flows with each system role.

## 2.13 Exit gate
- [ ] Users access only permitted modules; backend blocks unauthorized APIs
- [ ] UI correctly hides restricted actions
- [ ] Admin cannot grant platform permissions or escalate
- [ ] Permission changes take effect on the next request
- [ ] Every route has an explicit permission (CI check green)
- [ ] **Approval recorded to start Phase 3**
