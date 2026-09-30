# Phase 1 - Platform / Super Admin: verification and exit-gate status

Date: 2026-09-30. Branch: `phase-0-foundation`. Decisions taken with the user before starting:
Express + Phase 0 kit for every service (ADR-0011 accepted), one workspace and one database per
service co-hosted in development, backend and tests first with the UI as the next pass.

## What was built

| Piece | Location | Notes |
|---|---|---|
| Platform kit | `packages/platform-kit` | Phase 0 modules lifted and made database-agnostic (raw SQL on the standard tables), plus RS256/JWKS verification, tenant context, permission guard, service tokens, broker (RabbitMQ + in-memory), consumer with inbox + RLS context, service client, rate limiter, service chassis |
| Contracts | `packages/contracts` | Permission catalogue (tenant + platform, 10 system roles, legacy mapping), error codes, event registry with zod payloads |
| Test kit | `packages/test-kit` | RSA test keys and token minting, in-process app runner, deterministic event settling, per-service test databases with a `NOBYPASSRLS` runtime role |
| svc-auth | `apps/svc-auth` | Identities, argon2id (bcrypt verified and rehashed), RS256 keys + JWKS, login with lockout, TOTP MFA mandatory for platform admins, tenant selection, refresh rotation with reuse detection, password reset, owner invites, service tokens, tenant-event consumers, `admin:create` CLI, legacy identity migration |
| svc-tenant | `apps/svc-tenant` | Tenant lifecycle state machine (4-eyes, reasons, typed confirmation), profile edits with `If-Match`, settings, public application form (rate limit + captcha seam), dashboard, internal status endpoint, audit proxy |
| svc-audit | `apps/svc-audit` | Append-only `audit_events` under RLS, consumer of `audit.recorded.v1`, tenant and platform query APIs |
| svc-notification | `apps/svc-notification` | Templates for tenant lifecycle, owner invite, password reset, member invitation; log/SMTP transports; delivery log |
| Gateway | `apps/gateway` | RS256 via JWKS + legacy HS256 adapter, route table (auth, public, platform, audit, legacy; Phase 2-5 rows disabled), platform/tenant separation, tenant-status cache fed by events with svc-tenant fallback, permission-version and member-status hooks, legacy self-registration retired (410) |
| Legacy API | `apps/api` | Accepts RS256 tokens: tenant from `tid`, permissions from `perms` mapped onto legacy codes, membership still verified; HS256 keeps working during the overlap window |
| Infra / scripts | `scripts/test-db-setup.mts`, `npm run dev:platform` | Per-service test databases; one command runs API, auth, tenant, audit, notification, gateway and web |

## Test results

| Suite | Tests | Result |
|---|---|---|
| `npm run test -w @b2b/svc-auth` | 19 | pass |
| `npm run test -w @b2b/svc-tenant` | 13 | pass |
| `npm run test -w @b2b/svc-audit` | 4 | pass |
| `npm run test -w @b2b/svc-notification` | 4 | pass |
| `npm run test -w @b2b/gateway` | 11 | pass |
| `npm run test:api` (legacy API, incl. Phase 0 and the new RS256 tests) | 124 | pass |

Step 9 requirements and where they are proven:

| Requirement | Test |
|---|---|
| Every allowed transition + a forbidden one per state -> 409 | tenant `state machine` |
| Suspended tenant: business routes 403 on the next request; refresh 401; login shows a suspended message | gateway `tenant status enforcement`; auth `denies refresh once the tenant is suspended`, `refuses login for a suspended tenant` |
| Reactivation restores access without re-invite | auth `denies refresh once...` (restore), gateway reactivation |
| Platform token cannot call tenant routes; tenant token cannot call `/api/v1/platform/*` | gateway `platform / tenant separation`; tenant `authorization`; legacy API `rejects platform tokens` |
| Tenant A token + Tenant B ids -> 404 on legacy routes | Phase 0 sweep (still green); legacy API `cross-tenant token -> 403` |
| Refresh token reuse -> whole family revoked | auth `rotates on refresh, detects reuse...` |
| Login brute force -> lockout; forgot-password does not reveal existence | auth `locks the account...`, `password reset` |
| Duplicate `POST /vendors` with the same Idempotency-Key -> one tenant | tenant `replays the same Idempotency-Key` |
| Two admins approve simultaneously -> one 200, one 409 | tenant `two admins approving simultaneously` |
| Public application cannot become ACTIVE without admin actions | tenant `public application` |
| Migration: counts equal; migrated users log in | auth `legacy identity migration` |
| MFA mandatory for platform admins (enrolment forced, code required every login) | auth `platform administrators and MFA` |
| Audit rows per admin action with IP/UA; exactly-once recording | audit `recording`; tenant events carry ip/userAgent |
| Owner of an activated tenant receives an invite, sets a password, can sign in | auth `tenant lifecycle events`; notification `owner invite` |

## Exit gate (1.13)

| Item | Status |
|---|---|
| Main Admin can create, approve, activate a tenant | done (API level; `web-admin` UI is the next pass) |
| Tenant can log in only after activation | done (INVITED users cannot log in; invite issued on activation) |
| Suspended tenant cannot use business APIs (automated proof) | done at gateway and auth (refresh/login) |
| Vendor A cannot access Vendor B (automated proof) | done (Phase 0 sweep + RS256 membership check) |
| Self-registration cannot bypass approval | done: gateway answers 410 on the legacy register route; the legacy endpoint remains reachable only inside the network until the Phase 1 cut-over removes it |
| Legacy token adapter removal date set | proposal: remove `LEGACY_JWT_SECRET` from the gateway and `JWT_SECRET` verification from the legacy API two weeks after the web app switches to svc-auth login (UI pass) |
| Approval recorded to start Phase 2 | user instructed "start from phase 1 to phase 5" on 2026-09-30; Phase 2 proceeds |

## Deferred to the UI pass

`web-admin` (login with TOTP, dashboard, vendor list/detail/approval queue, platform audit) and the
`web-app` changes (svc-auth login with tenant selection, suspended screen, application form link).
The APIs they consume are complete and tested.

## Notes

- Redis-backed gateway cache (`REDIS_URL`) is implemented but exercised only with the in-memory
  cache in tests. RabbitMQ transport (`AmqpBroker`) reuses the Phase 0 publisher that was verified
  live; the consumer side is verified with the in-memory broker.
- KYC document upload to object storage (open decision in 1.14) is not implemented in this pass.
