# B2B Inventory (Rentfoxxy)

Multi-tenant B2B inventory management. Built so far: **Suppliers** (the `Vendor` model),
**Items**, **Purchase Orders**, **Purchase Receives (GRN)**, organization masters and RBAC.
Next, per the phase plan: QC, Stock ledger, Transfers, Sales Orders, Dispatch, Invoicing/GST,
Payments, Reports.

The platform is being migrated phase by phase to the architecture in `phase-plan/README.md`.
Phase 0 (architecture foundation) is implemented on this branch: race-condition fixes, idempotent
GRN creation, outbox/inbox event pipeline, an edge gateway and the infra stack. Status, gaps and
open decisions: `docs/phase-0/verification.md` and `docs/adr/`.

## Stack

| Layer | Choice |
|---|---|
| Database | PostgreSQL 16, Prisma 6 (migrations in `apps/api/prisma/migrations`) |
| API (`apps/api`) | Node 22+, Express 4, TypeScript, zod validation, JWT auth. The plan calls this the "legacy API" |
| Gateway (`apps/gateway`) | Express edge: correlation ids, identity-header stripping, token check, rate limit, routing table |
| Web (`apps/web`) | Vite, React 18, TypeScript, Tailwind, TanStack Query, react-hook-form |
| Shared (`packages/shared`) | zod schemas, validators (GSTIN/PAN/IFSC), permission catalogue, PO arithmetic |
| Infra (`infra/`) | Docker Compose: Postgres (database per service), RabbitMQ, Redis, MinIO; optional observability profile |

## Prerequisites

- Node 22 or newer, npm 10+
- PostgreSQL 16 reachable from your machine. Either:
  - the team's shared container `laptop-erp-postgres` on port 5433 (what `.env.example` points at), or
  - `npm run db:up` for a dedicated container on port 5434, or
  - `npm run infra:up` for the full platform stack (Postgres on 5435 plus RabbitMQ, Redis, MinIO)
- Docker Desktop, only if you use one of the container options above

## Run the application (API + web)

```bash
npm install

# 1. Configure the API
cp apps/api/.env.example apps/api/.env
#    Edit apps/api/.env:
#      DATABASE_URL       -> your Postgres (see prerequisites)
#      JWT_SECRET         -> any string of 16+ characters
#      APP_ENCRYPTION_KEY -> node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 2. Create the schema and demo data
npm run db:migrate        # prisma migrate deploy (all migrations, including Phase 0)
npm run db:seed           # demo organizations + users (no suppliers)

# 3. Start
npm run dev               # every service + gateway + web on http://localhost:5173 (alias of dev:platform)
npm run dev:legacy        # legacy API :4000 + web only (legacy pages; the new sign-in needs the services)
```

Open http://localhost:5173 and sign in with one of the demo accounts (password `Password123!`):

| Email | Organization | Role |
|---|---|---|
| owner@demo.local | Rentfoxxy Demo | Owner (all permissions) |
| purchase@demo.local | Rentfoxxy Demo | Purchase Manager |
| executive@demo.local | Rentfoxxy Demo | Purchase Executive (no issue / cancel / bank reveal) |
| viewer@demo.local | Rentfoxxy Demo | Viewer (read-only) |
| owner2@demo.local | Second Tenant | Owner of a separate tenant |

Health checks: `GET http://localhost:4000/health/live` and `/health/ready`.

## Run through the gateway (Phase 0 topology)

```bash
npm run dev:all           # API :4000 + gateway :4010 + web :5173 (web proxies /api to the gateway)
```

The gateway reads `apps/gateway/.env` if present and otherwise takes `JWT_SECRET` from
`apps/api/.env`, so no extra file is needed for local development. To change gateway settings
(port, limits, upstream URL) copy `apps/gateway/.env.example` to `apps/gateway/.env`; keep
`JWT_SECRET` identical to the API's or every login will be rejected with 401.

If the browser gets a plain-text 500 from `/api/...` while using `dev:all`, the gateway pane
(magenta) has crashed; fix its error and it restarts. `npm run dev` (no gateway) is unaffected.

Or start pieces separately: `npm run dev:api`, `npm run dev:gateway`, and
`VITE_PROXY_TARGET=http://localhost:4010 npm run dev:web`. The gateway accepts both
`/api/v1/*` (rewritten to the legacy `/api/*`) and `/api/*`. Gateway health:
`http://localhost:4010/health/ready`.

## Run the platform services (Phases 1-5)

The migration extracts the business domains into services, each with its own workspace, database
and tests, wired by the platform kit (`packages/platform-kit`) and the contracts package
(`packages/contracts`). Ports and databases:

| Service | Port | Database (infra :5435 / tests :5433) | Owns |
|---|---|---|---|
| `apps/svc-auth` | 4101 | `auth_db` / `auth_test` | identities, sessions, RS256 tokens, JWKS |
| `apps/svc-tenant` | 4102 | `tenant_db` | tenant lifecycle, vendor applications |
| `apps/svc-audit` | 4103 | `audit_db` | append-only audit trail |
| `apps/svc-notification` | 4104 | `notification_db` | e-mail deliveries |
| `apps/svc-iam` | 4105 | `iam_db` | roles, permissions, memberships, invitations |
| `apps/svc-master` | 4106 | `master_db` | products, warehouses, tax, numbering formats |
| `apps/svc-party` | 4107 | `party_db` | suppliers, customers, GST validation, bank accounts |
| `apps/svc-inventory` | 4108 | `inventory_db` | double-entry stock ledger, serials, adjustments |
| `apps/svc-procurement` | 4109 | `procurement_db` | purchase orders, goods receipts |
| `apps/svc-qc` | 4110 | `qc_db` | QC lots, checklists, decisions |
| `apps/gateway` | 4010 | - | routing, token verification, tenant / permission caches |

```bash
npm run infra:up                       # Postgres :5435 with one database + roles per service, RabbitMQ, Redis, MinIO
for s in auth tenant audit notification iam master party inventory procurement qc; do cp -n apps/svc-$s/.env.example apps/svc-$s/.env; done
# svc-auth and svc-party encrypt secrets at rest: put a fresh 32-byte key in each .env
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   -> APP_ENCRYPTION_KEY=...
# and set IAM_URL=http://localhost:4105 in apps/svc-auth/.env so roles come from svc-iam
npm run db:generate:all                # prisma generate for every service
for s in auth tenant audit notification iam master party inventory procurement qc; do npm run db:migrate -w @b2b/svc-$s; done
npm run dev:platform                   # legacy api + every service + gateway + web (web proxies /api to the gateway); `npm run dev` is an alias
```

The gateway routes `/api/v1/auth`, `/api/v1/platform`, `/api/v1/iam`, `/api/v1/master`,
`/api/v1/party`, `/api/v1/inventory`, `/api/v1/procurement` and `/api/v1/qc` to the services and
everything else to the legacy API. Phase status and verification: `docs/phase-N/verification.md`;
decisions: `docs/adr/`.

## First sign-in on the new platform

The web app now signs in through svc-auth, so the demo accounts of the legacy seed do not exist
there until you migrate them. Two ways to get a working login:

```bash
# A. Fresh start: create a platform admin, then onboard a tenant from the console
npm run admin:create -w @b2b/svc-auth -- --email admin@rentfoxxy.com --name "Platform Admin" --password "Str0ngPassw0rd!"
#    open http://localhost:5173/admin/login, create a tenant (or approve an application from /apply), activate it;
#    the owner invitation e-mail is logged by svc-notification in dev (LogTransport) with the /accept-invite link.

# B. Bring the legacy demo users over (same ids; organisations become ACTIVE tenants)
npm run migrate:legacy -w @b2b/svc-auth        # identities + bootstrap memberships
npm run migrate:bootstrap -w @b2b/svc-iam      # memberships and roles into svc-iam
npm run migrate:legacy -w @b2b/svc-master      # items, taxes, locations, payment terms
npm run migrate:legacy -w @b2b/svc-party       # vendors -> suppliers (needs LEGACY_APP_ENCRYPTION_KEY)
npm run migrate:legacy -w @b2b/svc-procurement # POs / GRNs + opening-stock manifest
```

Development shortcut: set `MFA_DEV_BYPASS_CODE=123456` in `apps/svc-auth/.env` to accept that code as the
platform two-factor code before an authenticator is set up. Every use is audited
(`MFA_DEV_BYPASS_USED`), it does not count as an enrolment, and svc-auth refuses to start with it
when `NODE_ENV=production`. Remove it once staff have enrolled.

Sign-in flow: credentials -> two-factor code (platform staff) -> organisation choice (members of
several tenants) -> home. The organisation switcher in the top bar re-issues the session for
another tenant; the refresh token is an httpOnly cookie, so a page reload keeps you signed in.
What each screen does, which permission opens it and how the UI pass was verified:
`docs/phase-ui/verification.md`; conventions for new feature modules: `docs/UI_CONVENTIONS.md`.

## Run the platform infrastructure (optional)

```bash
npm run infra:up          # Postgres :5435 (one database + roles per service), RabbitMQ :5672 (UI :15672, b2b / b2b_dev),
                          # Redis :6380, MinIO :9020 (console :9021)
npm run infra:down

docker compose -f infra/docker-compose.yml --profile observability up -d   # + OTel collector, Prometheus :9090, Grafana :3001, Loki, Tempo
```

To publish audit events to RabbitMQ instead of logging them, set in `apps/api/.env`:

```
AMQP_URL=amqp://b2b:b2b_dev@localhost:5672
```

Smoke-test the event pipeline end to end (needs the infra stack running):

```bash
npm run events:smoke -w @b2b/api
```

## Tests

```bash
# once: create the legacy test database (b2b_inventory_test) and one <service>_test database per service on :5433
npm run test:setup               # api migrations + scripts/test-db-setup.mts (add --reset after changing a service migration)
npm test                         # API (134) + gateway (11) + every service suite
npm run test:api                 # legacy API only (node:test + supertest, serial, resets the test database)
npm run test:gateway             # gateway only (no database needed)
npm run test:services            # auth, tenant, audit, notification, iam, master, party, inventory, qc, procurement (incl. the Phase 5 end-to-end run)
npm run typecheck                # every workspace
```

The API suite includes `test/purchases.concurrency.test.ts`: the Phase 0 race-condition scenarios
(R1-R7), idempotency, outbox/inbox, correlation ids, health and a cross-tenant sweep.

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` / `dev:all` | API + web, or API + gateway + web |
| `npm run db:migrate` | apply migrations (`prisma migrate deploy`) |
| `npm run db:migrate:dev -w @b2b/api -- --name <change>` | create a new migration |
| `npm run db:seed` | demo organizations and users only |
| `npm run db:reset` | drop, migrate and seed the dev database |
| `npm run build` | build API, gateway and web |
| `npm run infra:up` / `infra:down` | platform infra stack |

## Layout

```
apps/api/src
  config/env.ts            validated environment (fail-fast)
  middleware/               correlation id, auth (requireAuth -> requireOrganization -> requirePermission), error handler
  lib/                      errors, http helpers, prisma, idempotency, outbox, inbox, audit, ids
  modules/auth              register / login / me
  modules/organizations     tenant provisioning, roles, members
  modules/vendors           supplier aggregate: contacts, addresses, bank accounts, notes, documents, audit
  modules/items             item master
  modules/settings          org masters: locations, taxes, GST treatments, payment terms, custom fields, tags, numbering
  modules/purchases         purchase orders, receives (GRN), numbering, activity + audit events
  modules/health            /health/live, /health/ready
  modules/integrations      GST portal lookup provider seam
apps/api/test               integration tests (vendors, purchases, concurrency, validation, gst)
apps/gateway/src            config, routing table, gateway app
apps/web/src
  lib/api.ts, lib/auth.tsx  tenant-aware axios client (Idempotency-Key, correlation reference), session + permissions
  components/ui             design-system primitives
  features/*                vendors, items, purchase-orders, purchase-receives, settings
packages/shared/src         schemas + validators used by both API and web
infra/                      docker-compose.yml, postgres init (database per service), rabbitmq topology, observability
docs/                       VENDOR_MODULE.md, PURCHASING_MODULE.md, VALIDATION.md, SYSTEM_AUDIT.md, phase-0/, adr/
phase-plan/                 the 13-phase platform plan (README = architecture contract)
```

## Conventions

Project rules for contributors and AI assistants are in `CLAUDE.md` (tenant scoping, backend
authorization, shared validation, error envelope, soft delete, audit, lock-then-check writes,
idempotency, outbox). Module references: `docs/VENDOR_MODULE.md`, `docs/PURCHASING_MODULE.md`.
