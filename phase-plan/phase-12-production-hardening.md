# Phase 12 — Production Hardening

> Prerequisite: Phase 11 COMPLETE. Many controls below exist in basic form since Phase 0; this phase makes them **complete, tested and operated**. Nothing here adds business features.

---

## 12.1 Goal & scope
Security audit, tenant penetration tests, RBAC/concurrency/load tests, event retry & DLQ tooling, idempotency coverage audit, monitoring/metrics/tracing/logs, object storage policies, backup & disaster recovery, indexing and query/API performance.

---

## 12.2 Step 1 — Understand (baseline)
- [ ] Inventory of every public route (from gateway config + OpenAPI) with permission, rate limit, idempotency support
- [ ] Current p50/p95/p99 per route, error rates, DLQ history, slow-query log top 20
- [ ] Current backup method and last successful restore test (if none: treat as zero)
- [ ] Secrets: where each lives; any in repo history (scan with gitleaks)

---

## 12.3 Workstreams

### A. Security
| Control | Target |
|---|---|
| Dependency & image scanning | `pnpm audit`/OSV + Trivy in CI; block on critical |
| Secret scanning | gitleaks pre-commit + CI; rotate anything found |
| Secrets management | Docker/K8s secrets or Vault/Doppler; no secrets in env files on disk in prod; JWT signing keys rotated every 90 days |
| Transport | TLS 1.2+ at edge; HSTS; internal traffic on private network; service tokens audience-scoped |
| Headers | CSP, X-Frame-Options DENY, Referrer-Policy, no `X-Powered-By` |
| Input | Schema validation on every route (CI check), body size limits, file-type sniffing on uploads, AV scan for uploaded documents (ClamAV sidecar) |
| AuthN | MFA available for all tenant users, enforced for OWNER/ADMIN (tenant setting); session listing & remote logout |
| OWASP ASVS L2 checklist | Completed and stored in `docs/security/` |

### B. Tenant penetration tests (automated, run in CI nightly)
- **IDOR sweep:** for every route with an id parameter, Tenant A token × Tenant B ids → expect 404 (generated from OpenAPI)
- **Header/body spoofing:** inject `tenant_id`, `x-tenant-id`, `userId`, `role`, `permissions` in body/query/headers → ignored
- **RLS proof:** raw SQL under each service role with `app.tenant_id` set to A cannot read B rows; missing setting → zero rows
- **File access:** presigned URL for Tenant B object not obtainable by Tenant A; expired URLs fail
- **Event injection:** consumer rejects envelope whose `tenantId` mismatches the aggregate's tenant
- **Suspended tenant / suspended member / stale permissions** regression
- External pen test by a third party before public launch

### C. RBAC tests
Route-permission matrix (Phase 2) re-generated for all services; every route × every system role; custom-role escalation attempts; platform vs tenant token separation.

### D. Concurrency tests (k6 + custom harness)
| Scenario | Invariant |
|---|---|
| 200 parallel reservations on 50 units | exactly 50 succeed; no negative balance |
| Parallel GRNs on same PO | never over-receive |
| Parallel dispatch retries | single DISPATCH posting |
| Parallel allocations on one payment / one invoice | never over-allocate |
| Parallel numbering | gap-free, unique |
After each run: all reconciliation jobs report zero mismatches.

### E. Load & performance
| Target (initial SLOs) | Value |
|---|---|
| Read APIs p95 | < 300 ms |
| Write APIs p95 (non-reporting) | < 500 ms |
| SO confirm incl. reservation p95 | < 800 ms |
| Event end-to-end lag p95 | < 5 s |
| Availability (monthly) | 99.5% initially |
- Load profile: 50 tenants, 20 concurrent users each, realistic mix; soak 4 h
- Index review: every query in slow log has a tenant-first index; `pg_stat_statements` top 20 optimized
- Connection pooling: PgBouncer (transaction mode — note `SET LOCAL` compatibility is fine; avoid session-level `SET`)
- N+1 detection in integration tests (query-count assertions on list endpoints)
- Partition `stock_movements`, `audit_events`, `rpt_stock_movements` by month; retention policies (event-archive objects move to cold storage after 90 days, never deleted)

### F. Resilience: events, retries, DLQ
- Retry policy verified per consumer (10 s / 60 s / 10 min → DLQ)
- **DLQ console** (web-admin, platform permission `platform.ops.dlq`): list, inspect payload, see error, replay single/bulk, discard with reason (audited)
- Outbox relay: lag metric, stuck-row alert (> 60 s unpublished)
- Saga watchdogs: GRN CANCELLATION_PENDING, SO CONFIRMING, DC DISPATCHING older than threshold → alert with runbook link
- Circuit breakers on all sync clients; timeouts; bulkheads (separate pools for reporting)
- Chaos drills: kill broker, kill inventory, Postgres failover — system recovers without manual data fixes

### G. Idempotency coverage audit
Script lists all POST routes lacking `Idempotency-Key` support or a natural unique key → must be empty for the brief's list (GRN, SO, reservations, dispatch, payments) and all financial endpoints. Key TTL cleanup job.

### H. Observability
| Signal | Implementation |
|---|---|
| Metrics | RED per route (rate, errors, duration), USE for DB/broker/Redis, business metrics (GRNs/day, reservation failures, QC reject rate, invoices without IRN) |
| Tracing | OpenTelemetry across gateway → services → broker (trace context propagated in envelope) |
| Logs | Structured JSON, correlation id, tenant id, no PII/secrets (redaction tests), centralized in Loki, 30-day retention |
| Alerts | SLO burn-rate alerts; DLQ > 0; projection lag; outbox lag; reconciliation mismatch > 0; cert expiry; disk > 80%; backup failure |
| Dashboards | Platform overview, per-service, per-tenant usage, event flow |
| Runbooks | One per alert in `docs/runbooks/` |

### I. Object storage
Bucket per environment; private by default; object keys tenant-prefixed; lifecycle rules (temp uploads 24 h, exports 7 days); versioning on documents; server-side encryption; CORS limited to portal origins; presign TTL 5 min.

### J. Backup & DR
| Item | Target |
|---|---|
| Postgres | pgBackRest: nightly full + continuous WAL archiving to off-site object storage; **RPO ≤ 15 min** |
| Restore | Automated monthly restore to a scratch host + reconciliation run; **RTO ≤ 4 h** documented and timed |
| RabbitMQ | Definitions exported; queues durable; outbox guarantees rebuild after broker loss |
| Object storage | Cross-region/off-site replication |
| Secrets & keys | Escrowed backup of signing keys & provider credentials |
| DR runbook | Step-by-step rebuild on a fresh VPS from IaC + backups; rehearsed twice a year |
| Per-tenant export | Tenant data export (all documents CSV/JSON) for offboarding and contractual needs |

### K. Infrastructure
- Docker images: non-root, read-only FS, pinned base images, health checks
- Environments: dev → staging (prod-like data volume, anonymized) → prod; migrations run as a separate job before deploy; expand/contract migrations only
- Zero-downtime deploys (rolling with readiness gates); rollback procedure tested
- Capacity plan: when a single VPS exceeds 70% sustained CPU/RAM, split stateful (Postgres, RabbitMQ) and stateless tiers across hosts before considering Kubernetes

---

## 12.4 Tests & verification summary
- [ ] Nightly security/tenant/RBAC suites green for 14 consecutive days
- [ ] Load test meets SLOs; soak shows no memory growth
- [ ] Chaos drills pass without manual data repair
- [ ] Restore drill completed within RTO; reconciliation zero mismatches on restored data
- [ ] Third-party pen test: no critical/high findings open
- [ ] Every alert has a runbook; on-call rota defined

## 12.5 Exit gate — Production readiness
- [ ] All workstreams A–K signed off
- [ ] Final regression of Phases 0–11 green
- [ ] Go-live checklist (DNS, TLS, backups verified, monitoring, support contacts, rollback plan) approved
- [ ] **Platform declared production-ready**
