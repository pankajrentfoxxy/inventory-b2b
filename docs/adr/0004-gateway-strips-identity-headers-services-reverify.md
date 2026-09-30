# ADR-0004: The gateway strips identity headers; every service re-verifies the token

- Status: Accepted and implemented (Phase 0, 2026-09-30)
- Related: phase-plan/README.md 5.1 rules 1-3, `apps/gateway/src/routes.ts` (`STRIPPED_HEADERS`), `apps/api/src/middleware/correlation.ts`

## Context

A common shortcut is to let the gateway authenticate once and forward `x-user-id` /
`x-tenant-id` headers that services trust. Any path that reaches a service without passing the
gateway (misconfiguration, internal network access, a future service-to-service call) then lets a
caller impersonate anyone.

## Decision

- The gateway deletes `x-tenant-id`, `x-user-id`, `x-perms`, `x-membership-id` and
  `x-on-behalf-of-tenant` from every inbound request before proxying, verifies the bearer token
  for non-public routes, and forwards the **original** bearer token plus `x-correlation-id`.
- Every service re-verifies the token itself (defence in depth) and derives the tenant and the
  permissions from the token, never from headers. The legacy API additionally drops the same
  header list on entry.
- `X-Organization-Id` is not identity: it *selects* one of the caller's organizations and the API
  verifies the membership on every request. It disappears when tenant tokens (`tid`) arrive in
  Phase 1.
- Service-to-service calls (Phase 3+) use service tokens (`typ=service`, `aud=<target>`); the
  `x-on-behalf-of-tenant` header is accepted **only** together with a service token, which is why
  the gateway strips it from client traffic.

## Consequences

- Two signature verifications per request (gateway + service). With RS256 and cached JWKS this is
  microseconds; the security gain is large.
- Tests assert header stripping at the gateway (`apps/gateway/test/gateway.test.ts`) and that the
  API ignores the headers (`apps/api/test/purchases.concurrency.test.ts`).
