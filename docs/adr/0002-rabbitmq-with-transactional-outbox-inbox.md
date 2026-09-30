# ADR-0002: RabbitMQ with transactional outbox and inbox

- Status: Accepted (Phase 0, 2026-09-30)
- Related: phase-plan/README.md 5.8, phase-00 steps 4/6/8, `apps/api/src/lib/outbox.ts`, `apps/api/src/lib/inbox.ts`, `infra/rabbitmq/definitions.json`

## Context

Services must react to each other's state changes (GRN received -> QC lot, QC decided -> stock,
every action -> audit) without dual writes: a database commit that is not followed by a publish,
or a publish whose commit is rolled back, corrupts downstream state. NATS JetStream was the
alternative considered.

## Decision

- **Broker:** RabbitMQ (durable topic exchange `domain.events`, routing key
  `<eventType>.v<eventVersion>`, quorum queues, per-consumer queue `<svc>.<purpose>`, retry queues
  `10s / 60s / 10m` via TTL + dead-letter, then `<queue>.dlq`). Topology is declared in
  `infra/rabbitmq/definitions.json` so it is identical in every environment. Alert when any DLQ
  depth is above zero (`infra/observability/alerts.yml`).
- **Outbox (producer side):** the event envelope is inserted into `outbox_events` **in the same
  transaction** as the state change. A relay polls with `FOR UPDATE SKIP LOCKED`, publishes with
  publisher confirms, marks `published_at`, and backs off failed rows (`next_attempt_at`) using the
  same 10 s / 60 s / 10 min schedule. Delivery is therefore at-least-once.
- **Inbox (consumer side):** `processed_events (consumer, event_id)` is inserted in the same
  transaction as the consumer's side effects; a duplicate delivery is a no-op. This gives exactly-
  once *effect*.
- **Envelope:** as in README 5.8 (`eventId` UUIDv7, `eventType`, `eventVersion`, `tenantId`,
  `producer`, `correlationId`, `causationId`, `actor`, `aggregate{type,id,version}`, `payload`).
- Phase 0 proves the pipeline in the legacy API: every PO / GRN action emits `audit.recorded.v1`
  through the outbox, the relay publishes through `AmqpPublisher` when `AMQP_URL` is set and logs
  otherwise, and the inbox helper is exercised by tests. `svc-audit` (the consumer) is built on the
  same helpers in Phase 1.

## Consequences

- Every service database carries `outbox_events` and `processed_events` (standard tables).
- Consumers must be idempotent and must not rely on broker ordering; where order matters they
  compare `aggregate.version` and park out-of-order events for retry.
- The relay is an in-process worker in each service; several instances may run at once because of
  `SKIP LOCKED`. Publishing while holding the row lock is deliberate: it is the simplest way to
  avoid two relays publishing the same row.
- Changing the broker later (NATS) only touches the `EventPublisher` implementation and the
  topology file; producers and consumers do not change.
