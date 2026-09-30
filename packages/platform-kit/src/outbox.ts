/**
 * Transactional outbox (README 5.8, ADR-0002), database-agnostic: raw SQL against the standard
 * `outbox_events` table every service database carries (see `standardTablesSql`).
 */
import type { SqlClient, TransactionalClient } from './db.js';
import type { EventActor, EventAggregate, EventEnvelope } from './events.js';
import { routingKeyFor } from './events.js';
import { uuidv7 } from './ids.js';
import type { Logger } from './logger.js';

export interface EnqueueInput<P> {
  eventType: string;
  eventVersion?: number;
  tenantId: string | null;
  aggregate: EventAggregate;
  actor: EventActor;
  correlationId: string;
  causationId?: string | null;
  payload: P;
  occurredAt?: Date;
}

/** Writes an envelope into `outbox_events` inside the caller's transaction. */
export async function enqueueEvent<P extends Record<string, unknown>>(tx: SqlClient, producer: string, input: EnqueueInput<P>): Promise<EventEnvelope<P>> {
  const envelope: EventEnvelope<P> = {
    eventId: uuidv7(),
    eventType: input.eventType,
    eventVersion: input.eventVersion ?? 1,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    tenantId: input.tenantId,
    producer,
    correlationId: input.correlationId,
    causationId: input.causationId ?? null,
    actor: input.actor,
    aggregate: input.aggregate,
    payload: input.payload,
  };
  await tx.$executeRaw`
    INSERT INTO "outbox_events" ("id", "tenant_id", "event_type", "event_version", "aggregate_type", "aggregate_id", "envelope")
    VALUES (${envelope.eventId}::uuid, ${envelope.tenantId}::uuid, ${envelope.eventType}, ${envelope.eventVersion},
            ${envelope.aggregate.type}, ${envelope.aggregate.id}::uuid, ${JSON.stringify(envelope)}::jsonb)`;
  return envelope;
}

export interface EventPublisher {
  publish(routingKey: string, envelope: EventEnvelope): Promise<void>;
  close?(): Promise<void>;
}

/** Development fallback: events are logged and marked published. */
export class LogPublisher implements EventPublisher {
  constructor(private readonly logger: Logger) {}
  async publish(routingKey: string, envelope: EventEnvelope): Promise<void> {
    this.logger.info({ routingKey, eventId: envelope.eventId, eventType: envelope.eventType, tenantId: envelope.tenantId }, 'outbox event (no broker configured)');
  }
}

/** README 5.8: 3 delayed retries (10 s, 60 s, 10 min); later attempts keep the 10 min spacing. */
export function backoffMs(attemptsSoFar: number): number {
  if (attemptsSoFar <= 1) return 10_000;
  if (attemptsSoFar === 2) return 60_000;
  return 600_000;
}

export interface OutboxRelayOptions {
  client: TransactionalClient;
  publisher: EventPublisher;
  logger: Logger;
  batchSize?: number;
  pollMs?: number;
}

export interface RelayRunResult {
  published: number;
  failed: number;
}

export interface OutboxRelay {
  runOnce(opts?: { includeDeferred?: boolean }): Promise<RelayRunResult>;
  start(): void;
  stop(): Promise<void>;
}

interface OutboxRow {
  id: string;
  envelope: unknown;
  attempts: number;
}

export function createOutboxRelay(options: OutboxRelayOptions): OutboxRelay {
  const { client, publisher, logger } = options;
  const batchSize = options.batchSize ?? 50;
  const pollMs = options.pollMs ?? 200;
  const FAILURE_BACKOFF_MS = 5_000;
  let timer: NodeJS.Timeout | null = null;
  let stopped = true;
  let inFlight: Promise<unknown> | null = null;
  let consecutiveFailures = 0;

  async function runOnce(opts: { includeDeferred?: boolean } = {}): Promise<RelayRunResult> {
    return client.$transaction(
      async (tx) => {
        const rows = opts.includeDeferred
          ? await tx.$queryRaw<OutboxRow[]>`
              SELECT "id", "envelope", "attempts" FROM "outbox_events"
              WHERE "published_at" IS NULL ORDER BY "created_at", "id" LIMIT ${batchSize} FOR UPDATE SKIP LOCKED`
          : await tx.$queryRaw<OutboxRow[]>`
              SELECT "id", "envelope", "attempts" FROM "outbox_events"
              WHERE "published_at" IS NULL AND "next_attempt_at" <= now()
              ORDER BY "created_at", "id" LIMIT ${batchSize} FOR UPDATE SKIP LOCKED`;
        let published = 0;
        let failed = 0;
        for (const row of rows) {
          const envelope = row.envelope as EventEnvelope;
          try {
            await publisher.publish(routingKeyFor(envelope), envelope);
            await tx.$executeRaw`UPDATE "outbox_events" SET "published_at" = now(), "attempts" = "attempts" + 1, "last_error" = NULL WHERE "id" = ${row.id}::uuid`;
            published += 1;
          } catch (err) {
            const attempts = row.attempts + 1;
            const message = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
            await tx.$executeRaw`
              UPDATE "outbox_events" SET "attempts" = ${attempts}, "last_error" = ${message},
                     "next_attempt_at" = ${new Date(Date.now() + backoffMs(attempts))}
               WHERE "id" = ${row.id}::uuid`;
            failed += 1;
            logger.warn({ eventId: row.id, eventType: envelope.eventType, attempts, err: message }, 'outbox publish failed');
          }
        }
        return { published, failed };
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  }

  function schedule(delay = pollMs) {
    if (stopped) return;
    timer = setTimeout(() => {
      inFlight = runOnce()
        .then(() => {
          if (consecutiveFailures > 0) logger.info({ afterFailures: consecutiveFailures }, 'outbox relay recovered');
          consecutiveFailures = 0;
          schedule();
        })
        .catch((err) => {
          consecutiveFailures += 1;
          if (consecutiveFailures === 1) {
            logger.error({ err: (err instanceof Error ? err.message : String(err)).trim() }, `outbox relay poll failed; retrying every ${FAILURE_BACKOFF_MS / 1000}s`);
          }
          schedule(FAILURE_BACKOFF_MS);
        })
        .finally(() => {
          inFlight = null;
        });
    }, delay);
    timer.unref();
  }

  return {
    runOnce,
    start() {
      if (!stopped) return;
      stopped = false;
      schedule();
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (inFlight) await inFlight;
    },
  };
}

/**
 * Standard tables every service database carries (phase-00 step 4 + README 5.6). Services paste this
 * into their first migration so the shapes never drift.
 */
export const standardTablesSql = `
CREATE TABLE IF NOT EXISTS "idempotency_keys" (
  "tenant_id"     UUID         NOT NULL,
  "scope"         TEXT         NOT NULL,
  "key"           UUID         NOT NULL,
  "request_hash"  CHAR(64)     NOT NULL,
  "status"        VARCHAR(20)  NOT NULL DEFAULT 'IN_PROGRESS',
  "response_code" INTEGER,
  "response_body" JSONB,
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at"    TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("tenant_id", "scope", "key")
);
CREATE INDEX IF NOT EXISTS "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

CREATE TABLE IF NOT EXISTS "outbox_events" (
  "id"              UUID         NOT NULL,
  "tenant_id"       UUID,
  "event_type"      TEXT         NOT NULL,
  "event_version"   INTEGER      NOT NULL,
  "aggregate_type"  TEXT         NOT NULL,
  "aggregate_id"    UUID         NOT NULL,
  "envelope"        JSONB        NOT NULL,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at"    TIMESTAMPTZ(6),
  "attempts"        INTEGER      NOT NULL DEFAULT 0,
  "last_error"      TEXT,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "outbox_unpublished" ON "outbox_events"("next_attempt_at", "created_at") WHERE "published_at" IS NULL;

CREATE TABLE IF NOT EXISTS "processed_events" (
  "consumer"     TEXT         NOT NULL,
  "event_id"     UUID         NOT NULL,
  "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "processed_events_pkey" PRIMARY KEY ("consumer", "event_id")
);
`;
