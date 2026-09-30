# Platform infrastructure (Phase 0)

```bash
npm run infra:up          # postgres :5435, rabbitmq :5672 (+ :15672 UI), redis :6380, minio :9020 (+ :9021 console)
docker compose -f infra/docker-compose.yml --profile observability up -d   # otel :4317/4318, prometheus :9090, grafana :3001, loki :3100, tempo :3200
npm run infra:down
```

| Piece | File | Purpose |
|---|---|---|
| Database-per-service bootstrap | `postgres/init/00-create-dbs.sh` | `<svc>_db`, `<svc>_migrator` (DDL), `<svc>_role` (DML, `NOBYPASSRLS`), cross-database access revoked (ADR-0001) |
| Broker topology | `rabbitmq/definitions.json` | exchange `domain.events` (topic), `audit.recorded` queue + `retry.10s/60s/10m` + `.dlq`, `platform.event-archive` bound to `#`, `platform.heartbeat` (ADR-0002) |
| Alerts | `observability/alerts.yml` | DLQ depth > 0 pages; outbox backlog warns |
| Collector / dashboards | `observability/*.yaml`, `grafana/provisioning` | OTLP in, traces to Tempo, metrics to Prometheus, logs to Loki; Loki derives `correlationId` from JSON logs |

Credentials in these files are development defaults. Production values come from the deployment's
secret store; never commit them.

The legacy API talks to its existing database (`apps/api/.env`) and publishes events when
`AMQP_URL=amqp://b2b:b2b_dev@localhost:5672` is set; without it, events are logged.

Not exercised in this repository's automated tests: bringing the stack up requires Docker, which
CI does in the `infra` job (`.github/workflows/ci.yml`).
