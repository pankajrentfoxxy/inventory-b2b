# Phase 2 - IAM / RBAC: verification and exit-gate status

Date: 2026-09-30. Backend + tests pass (UI follows in the UI pass).

## What was built

| Piece | Location | Notes |
|---|---|---|
| Permission catalogue + system roles | `packages/contracts/src/permissions.ts` | Tenant and platform scopes, 10 system roles with ranks and default sets, legacy code mapping, legacy role mapping |
| svc-iam | `apps/svc-iam` | `iam_db` under RLS; catalogue sync on start (deprecates removed codes, never deletes grants); system roles seeded per tenant on `tenant.tenant.activated`; OWNER membership from `auth.owner.invited`; custom roles (create/clone/edit with `If-Match`/delete); invitations (72 h, resend, revoke, accept creates the identity through svc-auth); member role changes, suspend/reactivate/remove, warehouse scope; platform staff roles; internal API for svc-auth |
| Anti-escalation | `iam.service.ts` | Rule 1 grant-only-what-you-hold, rule 2 strictly lower rank (equal rank allowed only for `iam.owner.transfer` holders, i.e. owners managing owners), rule 3 last active owner protected, rule 4 `platform.*` rejected in tenant roles, rule 5 no self role change |
| Permission version propagation | iam -> `iam.permissions.changed.v1` -> gateway cache (`permver:{mid}`) and auth refresh | Role permission edits bump every member holding the role; member role / scope changes bump that member |
| svc-auth integration | `apps/svc-auth/src/modules/directory.ts`, `platform-directory.ts` | With `IAM_URL` set, memberships, effective permissions and platform permissions come from svc-iam; refresh re-resolves them |
| Gateway | `apps/gateway/src/routes.ts`, `app.ts` | `/api/v1/iam` and `/api/v1/platform/iam` routed; invitation acceptance public; `PERMISSIONS_STALE` (401) when the cached version is newer than the token; `MEMBER_SUSPENDED` (403) from membership events |
| Legacy API | `apps/api/src/middleware/auth.ts` | Permissions from token `perms` mapped onto legacy codes; route-permission matrix documented and tested |
| Migration | `apps/svc-iam/scripts/migrate-bootstrap.ts` | Phase 1 bootstrap tables (auth_db) -> iam memberships and platform staff, idempotent, reconciled before commit |

## Test results

| Suite | Tests | Result |
|---|---|---|
| `npm run test -w @b2b/svc-iam` (unit + auth integration) | 11 | pass |
| `npm run test -w @b2b/svc-auth` | 19 | pass |
| `npm run test -w @b2b/gateway` | 11 | pass |
| `npm run test:api` (incl. route x role matrix, 10 roles x 14 routes) | 134 | pass |
| svc-tenant / svc-audit / svc-notification (regression) | 13 / 4 / 4 | pass |

Step 9 requirements:

| Requirement | Test |
|---|---|
| Route matrix: every route x every system role -> expected 2xx/403 | api `route-permission-matrix` |
| Escalation: manager creates a role -> 403; admin assigns OWNER -> 403; member edits own roles -> 403 | iam `a purchase manager cannot...` |
| Last owner protection | iam `protects the last active owner` (rule check + owner-to-owner flows) |
| Permission change effective on next request (stale token 401, refresh carries new perms) | gateway `enforces permission version...`; iam `auth-integration` (pv + 1 after promotion, new perms on refresh) |
| Suspended member blocked; reactivated regains access | gateway (`MEMBER_SUSPENDED`), iam `bumps permission versions...`, auth-integration (sessions revoked, login refused) |
| Invite: expired -> 410; accepted twice -> second fails; duplicate pending -> 409 | iam `invitations` |
| Tenant role APIs reject `platform.*` codes | iam `roles and anti-escalation` |
| Tenant isolation: roles/members of B invisible to A (API + raw SQL under RLS) | iam `tenant isolation` |
| Warehouse scope stored and exposed (`/me`, effective permissions) | iam `invitations`, `warehouse scope` |
| Warehouse-scoped user cannot read another warehouse's GRN | deferred to Phase 5 (GRNs gain a warehouse there); scope is carried in effective permissions now |

## Exit gate (2.13)

| Item | Status |
|---|---|
| Users access only permitted modules; backend blocks unauthorized APIs | done (matrix + permission guard in every service) |
| UI hides restricted actions | UI pass |
| Admin cannot grant platform permissions or escalate | done |
| Permission changes take effect on the next request | done (gateway cache + refresh) |
| Every route has an explicit permission (CI check) | every kit router uses `requirePermission` / `requireService` / explicit public routes; a lint that fails the build on a route without one is listed under follow-ups |
| Approval recorded to start Phase 3 | per the user's instruction of 2026-09-30, Phase 3 proceeds |

## Follow-ups

- CI lint for "route without an explicit permission or public marker".
- Ownership transfer endpoint (`iam.owner.transfer`) as an explicit command; today owners manage each other through the equal-rank relaxation.
- Invitation expiry job (`EXPIRED` is set lazily on acceptance attempts).
