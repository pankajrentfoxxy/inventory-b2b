# ADR-0011: Phase 0 gateway built with Express; NestJS adoption and the monorepo rename deferred

- Status: **Proposed** (needs approval before Phase 1 starts)
- Related: phase-plan/README.md section 2 (assumed stack), phase-00 step 8.1 and 8.5

## Context

The phase plan assumes NestJS (Fastify adapter), pnpm + Turborepo, and a restructure that moves
`apps/api` to `apps/legacy-api` and `apps/web` to `apps/web-app`. The repository today is Express +
npm workspaces. Phase 0's own rule is to confirm or replace the assumed stack via ADRs, and to
change no behaviour.

## Decision (proposed)

1. **Gateway in Express** (`apps/gateway`, about 250 lines): correlation ids, identity-header
   stripping, body cap, rate-limit skeleton, legacy-token verification, config-driven routing
   table, upstream failure envelope, health endpoints, all covered by tests without a database.
   Express was chosen because it is the stack the team already runs and reviews; every concern the
   gateway has is a plain middleware. If NestJS is adopted for the greenfield services, porting the
   gateway is mechanical (the routing table and middleware are framework-agnostic functions).
2. **NestJS decision deferred to Phase 1**, taken when the first greenfield service (`svc-auth`)
   is designed. The plan's arguments for NestJS (guards, interceptors, DI for the platform kit) are
   real; so is the cost of a second framework in a small team. Decide once, with `svc-auth` as the
   concrete case.
3. **Monorepo rename and pnpm/Turborepo deferred.** Renaming `apps/api` -> `apps/legacy-api` and
   `apps/web` -> `apps/web-app` is a zero-behaviour change that touches every import path, script,
   document and the team's local checkouts. It should be its own commit, done right before the
   first new service lands, not mixed into the Phase 0 diff that contains the race-condition fixes.
   npm workspaces stay until the number of packages makes Turborepo's caching worth the change.
4. **Platform kit lives in the legacy API for now** (`apps/api/src/lib/{outbox,inbox,idempotency,
   audit,ids}.ts`, `middleware/correlation.ts`, `modules/health`). These modules have no legacy
   business logic in them and are written to be lifted into `packages/platform-kit` unchanged
   when the first service needs them (Phase 1).

## Consequences

- Phase 0 ships a working, tested gateway and event pipeline today; the framework question does
  not block the race fixes or the audit stream.
- If NestJS is chosen in Phase 1, `packages/platform-kit` is written as NestJS modules wrapping the
  same functions; the legacy API keeps using the plain functions until it is retired.
- The rename is a Phase 1 entry task with its own PR and a note to every developer to re-clone or
  `git pull` before rebasing.
