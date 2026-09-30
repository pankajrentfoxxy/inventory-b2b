# ADR-0003: RS256 JWT with embedded permissions and permission-version revocation

- Status: Accepted for the target platform (Phase 1); Phase 0 runs the interim adapter described below
- Related: phase-plan/README.md 5.1, ADR-0004, phase-01

## Context

Today every request loads the caller's membership, role and permissions from the database
(`apps/api/src/middleware/auth.ts`), which gives instant revocation but couples every service to
the identity tables. Tokens are HS256 signed with one shared secret, 12 h expiry, no refresh, no
revocation list.

## Decision

- `svc-auth` (Phase 1) issues **RS256** access tokens (10 min) with the claims in README 5.1:
  `sub`, `typ` (tenant | platform | service), `tid`, `mid`, `perms`, `pv` (permission version),
  `sid`. Public keys are served at `/.well-known/jwks.json`; refresh tokens rotate.
- Revocation without a database hit per request: the gateway checks `permver:{mid}` (Redis) equals
  the token's `pv`, `tenant-status:{tid}` is `ACTIVE`, and `session-revoked:{sid}` is absent.
  Role or permission changes bump `pv`; suspensions set the Redis keys. Worst-case staleness is the
  10-minute token lifetime for anything the cache misses.
- Every service re-verifies the signature (ADR-0004) and builds `TenantContext` from the claims
  only; `tenant_id` / `user_id` / `permissions` are never read from bodies, queries or headers.

### Interim (Phase 0)

The gateway verifies the **existing HS256 legacy tokens** with the API's `JWT_SECRET`
(`apps/gateway/src/app.ts`, "legacy token adapter"). This gives edge authentication today without
changing the login flow. Removal date: the Phase 1 cut-over to `svc-auth`, after which the shared
secret is deleted from the gateway.

## Consequences

- Services become stateless with respect to identity; `svc-iam` owns memberships and roles.
- Permission changes are visible within one token lifetime unless the gateway cache catches them
  first; the UI must handle 401/403 mid-session gracefully.
- Key rotation is a JWKS concern (two keys published during rotation).
