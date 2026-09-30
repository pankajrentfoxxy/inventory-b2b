# Phase 1 — Platform / Super Admin

> Prerequisite: Phase 0 COMPLETE. Read `README.md` §5 (identity & tenant context).
> Introduces `svc-auth`, `svc-tenant`, minimal `svc-notification`, the `web-admin` portal, and the tenant lifecycle that gates every business API.

---

## 1.1 Goal & scope

**In scope**
- `svc-auth`: identities, password login, RS256 JWT + refresh rotation, sessions, logout, password reset, MFA (TOTP) mandatory for platform admins, JWKS
- `svc-tenant`: vendor/tenant creation, review, approval, rejection, activation, suspension, reactivation, deactivation; tenant profile & config
- Tenant-status enforcement at gateway (+ refresh-token denial)
- Vendor **application** flow replacing uncontrolled self-registration
- Initial **owner invite** on activation (full invitation system in Phase 2)
- Migration of legacy Organizations → tenants (`ACTIVE`, grandfathered) and legacy users → identities
- `web-admin` portal: login, dashboard, vendor list/detail, approval queue, status actions, platform audit view
- Platform audit through `svc-audit`

**Out of scope:** custom roles and permission management (Phase 2), tenant billing/subscriptions (future), SSO.

---

## 1.2 Step 1 — Understand
- [ ] Current registration endpoint(s) and what they create (org + owner user + auto-login?)
- [ ] Password hash algorithm & parameters (migrate as-is; rehash to argon2id on next login if weaker)
- [ ] Users belonging to multiple organizations?
- [ ] Any "super admin" concept in legacy?
- [ ] Email sending mechanism and provider credentials (check they actually work)

---

## 1.3 Step 2 — Business flow

```text
                    ┌─────────── Public vendor application (optional) ──────────┐
                    │  POST /public/vendor-applications → tenant PENDING          │
                    │  (no user login created, no access to anything)            │
                    └──────────────────────────────┬─────────────────────────────┘
Super Admin ─ login (password + TOTP) ─┐           │
                                       ▼           ▼
                           Create vendor ──▶ PENDING ──review──▶ APPROVED ──activate──▶ ACTIVE
                                               │                                        │   ▲
                                               └──reject──▶ REJECTED (terminal)          │   │ reactivate
                                                                                    suspend  │
                                                                                        ▼   │
                                                                                    SUSPENDED
                                                                                        │
                                                                        deactivate (from ACTIVE or SUSPENDED)
                                                                                        ▼
                                                                                  DEACTIVATED (terminal; data retained)
On ACTIVATE: owner invite email → owner sets password → can log in → Vendor dashboard
```

### Tenant state machine
| From | Command | To | Permission | Guards | Emits |
|---|---|---|---|---|---|
| — | create | PENDING | `platform.tenant.create` | unique legal name+GSTIN/PAN, owner email valid | `tenant.tenant.created.v1` |
| PENDING | approve | APPROVED | `platform.tenant.approve` | KYC fields complete; approver ≠ creator (4-eyes, configurable) | `…approved.v1` |
| PENDING | reject | REJECTED | `platform.tenant.approve` | reason required | `…rejected.v1` |
| APPROVED | activate | ACTIVE | `platform.tenant.activate` | owner email present | `…activated.v1` |
| ACTIVE | suspend | SUSPENDED | `platform.tenant.suspend` | reason required | `…suspended.v1` |
| SUSPENDED | reactivate | ACTIVE | `platform.tenant.suspend` | reason required | `…reactivated.v1` |
| ACTIVE, SUSPENDED | deactivate | DEACTIVATED | `platform.tenant.deactivate` | reason; typed confirmation | `…deactivated.v1` |

**Effects of SUSPENDED/DEACTIVATED:** gateway returns `403 TENANT_NOT_ACTIVE` for every `/api/v1/*` call; `svc-auth` revokes all refresh tokens for the tenant; login returns a clear message; outbound scheduled jobs for the tenant stop. **Data is never deleted by these transitions.**

---

## 1.4 Step 3 — Architecture & ownership

| Concern | Owner |
|---|---|
| Credentials, sessions, tokens, MFA | svc-auth |
| Tenant record + lifecycle + config | svc-tenant |
| Platform admin users (identity) | svc-auth (`user_type=PLATFORM`) |
| Platform admin permissions | svc-auth holds a fixed platform-role table in this phase (`PLATFORM_SUPER_ADMIN`, `PLATFORM_REVIEWER`, `PLATFORM_SUPPORT`); moves to svc-iam in Phase 2 |
| Tenant membership (owner) | Minimal table in svc-auth this phase → migrated to svc-iam in Phase 2 |
| Tenant status cache | Redis `tenant-status:{tid}` written by gateway's consumer of tenant events; TTL 5 min; miss → `GET svc-tenant /internal/v1/tenants/{id}/status` |

Sequence — suspend:
```text
Admin → gateway → svc-tenant: POST /platform/vendors/{id}/suspend
  svc-tenant tx: ACTIVE→SUSPENDED, audit, outbox(tenant.tenant.suspended.v1)
  relay → broker
     ├─▶ gateway consumer: SET tenant-status:{tid} = SUSPENDED  (within ~1 s)
     ├─▶ svc-auth: revoke refresh tokens; add session ids to revocation set
     ├─▶ svc-notification: email tenant owner
     └─▶ svc-audit
Worst-case window: access tokens already issued remain valid ≤ 10 min
  → mitigated because gateway checks tenant-status on every request (not token claims)
```

---

## 1.5 Step 4 — Database

### auth_db
```sql
CREATE TABLE users (
  id uuid PRIMARY KEY,
  email citext NOT NULL UNIQUE,
  phone text,
  full_name text NOT NULL,
  user_type text NOT NULL CHECK (user_type IN ('PLATFORM','TENANT')),
  password_hash text,                       -- null until invite accepted
  password_algo text NOT NULL DEFAULT 'argon2id',
  mfa_secret_enc bytea,                      -- encrypted with KMS/app key
  mfa_enabled boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('INVITED','ACTIVE','LOCKED','DISABLED')),
  failed_login_count int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  tenant_id uuid,                            -- null for platform sessions
  membership_id uuid,
  ip inet, user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz, revoke_reason text
);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions(id),
  token_hash char(64) NOT NULL UNIQUE,       -- sha256; raw token never stored
  family_id uuid NOT NULL,                   -- rotation family (reuse detection)
  expires_at timestamptz NOT NULL,           -- 14 days, sliding
  used_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL, used_at timestamptz
);

CREATE TABLE platform_role_assignments (   -- temporary; moves to iam_db in Phase 2
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('PLATFORM_SUPER_ADMIN','PLATFORM_REVIEWER','PLATFORM_SUPPORT')),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE tenant_memberships_bootstrap ( -- temporary; migrated to iam_db in Phase 2
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL DEFAULT 'OWNER', status text NOT NULL DEFAULT 'ACTIVE',
  UNIQUE (tenant_id, user_id)
);
```
Refresh-token **reuse detection**: presenting an already-used token revokes the whole `family_id` and the session.

### tenant_db
```sql
CREATE TABLE tenants (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,                 -- short slug, immutable
  legal_name text NOT NULL,
  display_name text NOT NULL,
  pan char(10), gstin char(15),
  registered_address jsonb NOT NULL,
  state_code char(2),                        -- GST state; drives IGST vs CGST/SGST later
  owner_name text NOT NULL, owner_email citext NOT NULL, owner_phone text,
  status text NOT NULL CHECK (status IN ('PENDING','APPROVED','ACTIVE','SUSPENDED','DEACTIVATED','REJECTED')),
  status_reason text,
  source text NOT NULL CHECK (source IN ('ADMIN_CREATED','APPLICATION','LEGACY_MIGRATION')),
  created_by uuid, approved_by uuid, approved_at timestamptz,
  activated_at timestamptz, suspended_at timestamptz, deactivated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX tenants_gstin_uq ON tenants (gstin) WHERE gstin IS NOT NULL AND status <> 'REJECTED';

CREATE TABLE tenant_status_history (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
  from_status text, to_status text NOT NULL, reason text, actor_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  fy_start_month int NOT NULL DEFAULT 4,
  base_currency char(3) NOT NULL DEFAULT 'INR',
  features jsonb NOT NULL DEFAULT '{}',      -- feature flags, e.g. {"serialTracking":true}
  limits jsonb NOT NULL DEFAULT '{}'         -- e.g. {"maxUsers":25,"maxWarehouses":5}
);

CREATE TABLE vendor_applications (
  id uuid PRIMARY KEY, tenant_id uuid REFERENCES tenants(id),
  payload jsonb NOT NULL, submitted_ip inet, captcha_score numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### Legacy migration
- Script `migrate-orgs-to-tenants`: every legacy Organization → `tenants` row, `status=ACTIVE`, `source=LEGACY_MIGRATION`, **same UUID as legacy `organization_id`** (keeps all later backfills trivial).
- Legacy users → `users` (`user_type=TENANT`), keep hashes, `password_algo` = legacy algo; rehash on next login.
- User↔org links → `tenant_memberships_bootstrap`.
- Verification: counts match; random sample of 50 users can log in on staging.

---

## 1.6 Step 5 — API

### svc-auth
| Method & path | Auth | Permission | Notes |
|---|---|---|---|
| `POST /api/v1/auth/login` | none | — | `{email,password}` → if platform & MFA: `{mfaRequired, mfaToken}`; if tenant user with >1 membership: `{tenants:[…], selectionToken}`; else tokens. Rate limit 5/min/IP+email; lock after 10 failures for 15 min |
| `POST /api/v1/auth/mfa/verify` | mfaToken | — | TOTP → tokens |
| `POST /api/v1/auth/select-tenant` | selectionToken / access | — | Issues token scoped to chosen tenant (must be ACTIVE) |
| `POST /api/v1/auth/refresh` | refresh cookie | — | Rotation; denies if tenant not ACTIVE or membership inactive |
| `POST /api/v1/auth/logout` | access | — | Revokes session |
| `POST /api/v1/auth/password/forgot` | none | — | Always 202 (no user enumeration) |
| `POST /api/v1/auth/password/reset` | reset token | — | Single-use, 30 min |
| `POST /api/v1/auth/invitations/accept` | invite token | — | Sets password; activates owner |
| `GET /.well-known/jwks.json` | none | — | Key rotation: 2 active keys, 90-day rotation |
| `POST /internal/v1/service-tokens` | mTLS/secret | — | Client-credentials for services |

Tokens: access token in memory (JS), refresh token in `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth` cookie. Separate cookie names for admin and app portals.

### svc-tenant (all under `/api/v1/platform`, platform token only)
| Method & path | Permission | Body / notes |
|---|---|---|
| `GET /vendors?status=&q=&cursor=` | `platform.tenant.view` | List |
| `GET /vendors/{id}` | `platform.tenant.view` | Detail + status history |
| `POST /vendors` | `platform.tenant.create` | Legal/owner/KYC fields; `Idempotency-Key` |
| `PATCH /vendors/{id}` | `platform.tenant.edit` | Profile only; **no status**; `If-Match: <version>` |
| `POST /vendors/{id}/approve` | `platform.tenant.approve` | `{note}` |
| `POST /vendors/{id}/reject` | `platform.tenant.approve` | `{reason}` |
| `POST /vendors/{id}/activate` | `platform.tenant.activate` | Triggers owner invite |
| `POST /vendors/{id}/suspend` | `platform.tenant.suspend` | `{reason}` |
| `POST /vendors/{id}/reactivate` | `platform.tenant.suspend` | `{reason}` |
| `POST /vendors/{id}/deactivate` | `platform.tenant.deactivate` | `{reason, confirmCode}` |
| `POST /vendors/{id}/resend-owner-invite` | `platform.tenant.activate` | |
| `GET /dashboard` | `platform.dashboard.view` | Counts by status, recent applications, recent actions |
| `GET /audit?tenantId=&action=&from=&to=` | `platform.audit.view` | Proxied to svc-audit |

Public: `POST /api/v1/public/vendor-applications` (captcha, 3/hour/IP) → creates `PENDING` tenant, emails applicant "under review". **The legacy self-registration route is disabled at the gateway** (returns 410 with a pointer to the application form).

Internal: `GET /internal/v1/tenants/{id}/status` → `{status, version}`.

Error codes: `TENANT_INVALID_TRANSITION` (409), `TENANT_DUPLICATE_GSTIN` (422), `TENANT_NOT_ACTIVE` (403), `AUTH_INVALID_CREDENTIALS` (401), `AUTH_ACCOUNT_LOCKED` (403), `AUTH_MFA_REQUIRED` (401), `AUTH_REFRESH_REUSED` (401).

---

## 1.7 Step 6 — Events

| Event | Producer | Consumers & reaction | Idempotency |
|---|---|---|---|
| `tenant.tenant.created.v1` | tenant | audit, notification (applicant ack) | inbox |
| `tenant.tenant.approved.v1` | tenant | audit | inbox |
| `tenant.tenant.activated.v1` | tenant | gateway (cache ACTIVE), auth (create owner user INVITED + invite token), notification (invite email) | inbox; auth uses unique `(tenant_id,user_id)` |
| `tenant.tenant.suspended.v1` | tenant | gateway (cache), auth (revoke sessions/refresh), notification | inbox |
| `tenant.tenant.reactivated.v1` | tenant | gateway, notification | inbox |
| `tenant.tenant.deactivated.v1` | tenant | gateway, auth, notification | inbox |
| `auth.user.logged_in.v1` / `login_failed.v1` | auth | audit | inbox |

Payload example `tenant.tenant.suspended.v1`: `{ tenantId, previousStatus, reason, suspendedBy, suspendedAt }`.

Out-of-order safety: gateway cache stores `{status, version}` and ignores events with lower `aggregate.version`.

---

## 1.8 Step 7 — Frontend (`web-admin`, served at `/admin`)

| Page | Components | Query / mutation | Permission gate |
|---|---|---|---|
| Login | email/password, TOTP step, forced MFA enrolment on first login | `login`, `mfaVerify` | — |
| Dashboard | status count cards, pending approvals list, recent audit | `GET /dashboard` | `platform.dashboard.view` |
| Vendors | table (status filter chips, search), row actions | `GET /vendors` | `platform.tenant.view` |
| Vendor detail | profile, KYC, status timeline, action bar (Approve/Reject/Activate/Suspend/Reactivate/Deactivate shown by current status) | detail + commands | per action |
| Create vendor | multi-step form (legal → address → owner → review) with GSTIN/PAN format validation and GSTIN state-code auto-fill | `POST /vendors` | `platform.tenant.create` |
| Approval queue | PENDING list with SLA age | list filtered | `platform.tenant.approve` |
| Platform audit | filterable table, diff viewer for old/new | `GET /audit` | `platform.audit.view` |

States: skeleton loaders, empty states ("No vendors awaiting approval"), error state with correlation id. Destructive actions (suspend/deactivate) use a confirmation dialog requiring a reason; deactivate requires typing the tenant code.

`web-app` changes: login page handles tenant selection; `TENANT_NOT_ACTIVE` → dedicated "Account suspended — contact support" screen; remove sign-up link or point to application form.

---

## 1.9 Step 8 — Implementation order
1. svc-auth schema, argon2id, JWT signing + JWKS, login/refresh/logout, lockout, password reset
2. svc-tenant schema + state machine + platform APIs + outbox
3. Gateway: switch verifier to JWKS (keep legacy-token adapter for a documented overlap window), tenant-status check, `/api/v1/platform/*` routing restricted to `typ=platform`
4. Legacy-api: accept new JWT (verify via JWKS, map `tid`→organization) — legacy stays the business backend
5. Migration scripts (orgs, users, memberships) — dry-run on staging copy, reconcile counts
6. svc-notification minimal: template + SMTP/provider adapter + delivery log; invite and suspension emails
7. `web-admin` pages; `web-app` login/tenant-select/suspended screen
8. Seed first `PLATFORM_SUPER_ADMIN` via a one-off CLI (never an API)
9. Disable legacy self-registration route

---

## 1.10 Step 9 — Tests
- State machine: every allowed transition + at least one forbidden transition per state → 409
- Suspended tenant: every business route returns 403 within 2 s of the suspend call (poll test); refresh returns 401; login shows suspended message
- Reactivation restores access without re-invite
- Platform token cannot call `/api/v1/*` tenant routes; tenant token cannot call `/api/v1/platform/*`
- Tenant A token + Tenant B resource ids → 404 on every legacy route (re-run Phase 0 isolation suite)
- Refresh token reuse → whole family revoked
- Login brute force → lockout; forgot-password does not reveal user existence
- Duplicate `POST /vendors` with same Idempotency-Key → one tenant
- Two admins approve simultaneously → one 200, one 409
- Public application cannot result in an ACTIVE tenant without admin actions
- Migration: counts equal; sample logins succeed

## 1.11 Step 10 — Verification
- [ ] DB: `tenant_status_history` row for every transition; `audit_events` row per admin action with IP/UA
- [ ] Events visible in broker metrics; gateway Redis cache reflects status
- [ ] UI: each action button appears only in valid states
- [ ] Owner of a newly activated vendor receives invite, sets password, lands on dashboard with only own data

## 1.12 Step 11 — Regression
Full Phase 0 suite + legacy PO/GRN flows under new tokens.

---

## 1.13 Exit gate
- [ ] Main Admin can create, approve, activate a tenant
- [ ] Tenant can log in only after activation
- [ ] Suspended tenant cannot use business APIs (automated proof)
- [ ] Vendor A cannot access Vendor B (automated proof)
- [ ] Self-registration cannot bypass approval
- [ ] Legacy token adapter removal date set
- [ ] **Approval recorded to start Phase 2**

## 1.14 Open decisions
| Decision | Default |
|---|---|
| 4-eyes on approval (approver ≠ creator) | On for production |
| Can one user belong to multiple tenants? | Yes (tenant selection at login) |
| KYC documents upload (PAN/GST certificate) | Yes, via pre-signed S3 upload, stored against tenant |
| Access-token lifetime | 10 min |
