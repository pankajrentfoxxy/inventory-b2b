# Gateway (Phase 0)

Single entry point in front of the legacy API. Zero behaviour change for the web app; adds the
cross-cutting guarantees from `phase-plan/README.md` section 5.

```
browser -> gateway :4010 -> legacy API :4000
```

What it does, in order (`src/app.ts`):

1. Accepts or mints `x-correlation-id`, echoes it, forwards it upstream.
2. Deletes `x-tenant-id`, `x-user-id`, `x-perms`, `x-membership-id`, `x-on-behalf-of-tenant`.
3. Rejects bodies above `BODY_LIMIT_BYTES` (413) before proxying.
4. Rate limits per authenticated principal (JWT `sub`) or per IP (429, `retryable: true`).
5. Verifies the legacy HS256 bearer token for every `/api` path except login / register
   (401 `UNAUTHENTICATED`). Phase 1 swaps this for RS256 + JWKS (ADR-0003).
6. Routes by prefix (`src/routes.ts`): `/api/v1/*` is rewritten to the legacy `/api/*`; `/api/*`
   passes through; `/api/v1/platform/*` is present but disabled until Phase 1 (404).
7. Answers 503 `UPSTREAM_UNAVAILABLE` (retryable) when the upstream is down; upstream responses
   otherwise pass through untouched (the legacy API already emits the standard error envelope with
   `correlationId`).

Health: `GET /health/live`, `GET /health/ready` (probes the legacy API).

## Run

```bash
npm run dev:gateway                               # :4010; JWT_SECRET is taken from apps/api/.env when apps/gateway/.env is absent
cp apps/gateway/.env.example apps/gateway/.env    # optional: override port, limits, upstream (keep JWT_SECRET equal to the API's)
npm run dev:all                                   # api + gateway + web (web proxies /api to the gateway)
npm run test -w @b2b/gateway
```

Not yet here (by design, later phases): Redis-backed rate limits and tenant-status / permission-
version checks (Phase 1), OpenTelemetry spans (Phase 0 observability profile is provisioned, the
SDK is wired when the platform kit is extracted), request/response size metrics on `/metrics`.
