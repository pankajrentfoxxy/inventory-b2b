# B2B Inventory (Rentfoxxy)

Multi-tenant B2B inventory management. Module 1 (this repo state): **Vendor Management**,
built as the foundation for Items, Purchase Orders, GRN, QC, Stock, Sales, Dispatch, Invoicing,
Payments and Reports.

## Stack

| Layer | Choice |
|---|---|
| Database | PostgreSQL 16, Prisma 6 (migrations in `apps/api/prisma/migrations`) |
| API | Node 22, Express 4, TypeScript, zod validation, JWT auth |
| Web | Vite, React 18, TypeScript, Tailwind, TanStack Query, react-hook-form |
| Shared | `packages/shared` - zod schemas, validators (GSTIN/PAN/IFSC), permission catalogue, masters |

## Quick start

```bash
npm install
cp apps/api/.env.example apps/api/.env      # set DATABASE_URL, JWT_SECRET, APP_ENCRYPTION_KEY
npm run db:migrate                          # prisma migrate deploy
npm run db:seed                             # demo orgs + users (no vendors)
npm run dev                                 # API on :4000, web on :5173
```

Demo logins after seeding (password `Password123!`):

| Email | Organization | Role |
|---|---|---|
| owner@demo.local | Rentfoxxy Demo | Owner (all permissions) |
| purchase@demo.local | Rentfoxxy Demo | Purchase Manager |
| executive@demo.local | Rentfoxxy Demo | Purchase Executive (no status / bank reveal) |
| viewer@demo.local | Rentfoxxy Demo | Viewer (read-only) |
| owner2@demo.local | Second Tenant | Owner of a separate tenant |

A dedicated PostgreSQL container is available with `npm run db:up` (port 5434); the default
`.env.example` points at the team's shared local container on port 5433.

## Tests

```bash
npm run test:setup -w @b2b/api   # migrate the test database (apps/api/.env.test)
npm test                         # 38 API integration tests (node:test + supertest)
```

## Layout

```
apps/api/src
  config/env.ts            validated environment
  middleware/auth.ts       requireAuth -> requireOrganization (X-Organization-Id) -> requirePermission
  modules/auth             register / login / me
  modules/organizations    tenant provisioning, roles, members
  modules/vendors          vendor aggregate: service, repository, sub-resources, documents, audit
  modules/settings         org masters: GST treatments, sources of supply, payment terms, custom fields, tags
  modules/integrations     GST portal lookup provider seam (no provider bundled)
apps/web/src
  lib/api.ts, lib/auth.tsx tenant-aware axios client, session + permissions
  components/ui            design-system primitives
  features/vendors         list, form (tabs), details, activity, notes, documents
  features/settings        custom fields & reporting tags admin
packages/shared/src        schemas + validators used by both API and web
```

See `docs/VENDOR_MODULE.md` for the full module reference (API, schema, RBAC, validation rules).
