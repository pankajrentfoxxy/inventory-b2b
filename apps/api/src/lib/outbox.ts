/**
 * Transactional outbox (phase-plan/README.md 5.8).
 *
 * - `enqueueEvent` writes an envelope into `outbox_events` inside the caller's transaction, so an
 *   event exists if and only if the state change committed.
 * - `createOutboxRelay` publishes unpublished rows through an `EventPublisher` using
 *   `FOR UPDATE SKIP LOCKED`, so several API processes can relay concurrently without duplicates.
 *   Publishing is at-least-once; consumers deduplicate with the inbox (`lib/inbox.ts`).
 * - Failed publishes back off 10 s -> 60 s -> 10 min (README 5.8 retry policy) and are retried
 *   forever; alerting keys off `attempts` and DLQ depth.
 */
import type { Prisma } from '@prisma/client';
import { prisma, type PrismaTx } from './prisma.js';
import { logger } from './logger.js';
import { uuidv7 } from './ids.js';

export const PRODUCER = 'legacy-api';

export interface EventActor {
  type: 'user' | 'service' | 'system';
  id: string | null;
  name?: string | null;
}

export interface EventAggregate {
  type: string;
  id: string;
  version: number | null;
}

export interface EventEnvelope<P = Record<string, unknown>> {
  eventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  tenantId: string | null;
  producer: string;
  correlationId: string;
  causationId: string | null;
  actor: EventActor;
  aggregate: EventAggregate;
  payload: P;
}

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

export function routingKeyFor(envelope: Pick<EventEnvelope, 'eventType' | 'eventVersion'>): string {
  return `${envelope.eventType}.v${envelope.eventVersion}`;
}

/** Must be called with the transaction that performs the state change. */
export async function enqueueEvent<P extends Record<string, unknown>>(tx: PrismaTx, input: EnqueueInput<P>): Promise<EventEnvelope<P>> {
  const envelope: EventEnvelope<P> = {
    eventId: uuidv7(),
    eventType: input.eventType,
    eventVersion: input.eventVersion ?? 1,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    tenantId: input.tenantId,
    producer: PRODUCER,
    correlationId: input.correlationId,
    causationId: input.causationId ?? null,
    actor: input.actor,
    aggregate: input.aggregate,
    payload: input.payload,
  };
  await tx.outboxEvent.create({
    data: {
      id: envelope.eventId,
      tenantId: envelope.tenantId,
      eventType: envelope.eventType,
      eventVersion: envelope.eventVersion,
      aggregateType: envelope.aggregate.type,
      aggregateId: envelope.aggregate.id,
      envelope: envelope as unknown as Prisma.InputJsonValue,
    },
  });
  return envelope;
}

/* ---- publishers ------------------------------------------------------------ */

export interface EventPublisher {
  publish(routingKey: string, envelope: EventEnvelope): Promise<void>;
  close?(): Promise<void>;
}

/** Test double: records publishes and can simulate a broker outage. */
export class InMemoryPublisher implements EventPublisher {
  readonly published: { routingKey: string; envelope: EventEnvelope }[] = [];
  failing = false;

  async publish(routingKey: string, envelope: EventEnvelope): Promise<void> {
    if (this.failing) throw new Error('broker unavailable (simulated)');
    this.published.push({ routingKey, envelope });
  }
}

/** Development fallback when no broker is configured: events are logged and marked published. */
export class LogPublisher implements EventPublisher {
  async publish(routingKey: string, envelope: EventEnvelope): Promise<void> {
    logger.info({ routingKey, eventId: envelope.eventId, eventType: envelope.eventType, tenantId: envelope.tenantId }, 'outbox event (no broker configured)');
  }
}

/* ---- relay ----------------------------------------------------------------- */

/** README 5.8: 3 delayed retries (10 s, 60 s, 10 min); later attempts keep the 10 min spacing. */
export function backoffMs(attemptsSoFar: number): number {
  if (attemptsSoFar <= 1) return 10_000;
  if (attemptsSoFar === 2) return 60_000;
  return 600_000;
}

export interface OutboxRelayOptions {
  publisher: EventPublisher;
  /** Rows per poll. */
  batchSize?: number;
  /** Poll interval when running in the background. */
  pollMs?: number;
}

export interface RelayRunResult {
  published: number;
  failed: number;
}

export interface OutboxRelay {
  /** Publishes one batch. `includeDeferred` ignores the retry backoff (tests, manual replay). */
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
  const batchSize = options.batchSize ?? 50;
  const pollMs = options.pollMs ?? 200;
  let timer: NodeJS.Timeout | null = null;
  let stopped = true;
  let inFlight: Promise<unknown> | null = null;

  async function runOnce(opts: { includeDeferred?: boolean } = {}): Promise<RelayRunResult> {
    return prisma.$transaction(
      async (tx) => {
        const rows = opts.includeDeferred
          ? await tx.$queryRaw<OutboxRow[]>`
              SELECT "id", "envelope", "attempts" FROM "outbox_events"
              WHERE "published_at" IS NULL
              ORDER BY "created_at", "id" LIMIT ${batchSize} FOR UPDATE SKIP LOCKED`
          : await tx.$queryRaw<OutboxRow[]>`
              SELECT "id", "envelope", "attempts" FROM "outbox_events"
              WHERE "published_at" IS NULL AND "next_attempt_at" <= now()
              ORDER BY "created_at", "id" LIMIT ${batchSize} FOR UPDATE SKIP LOCKED`;
        let published = 0;
        let failed = 0;
        for (const row of rows) {
          const envelope = row.envelope as EventEnvelope;
          try {
            await options.publisher.publish(routingKeyFor(envelope), envelope);
            await tx.outboxEvent.update({ where: { id: row.id }, data: { publishedAt: new Date(), attempts: { increment: 1 }, lastError: null } });
            published += 1;
          } catch (err) {
            const attempts = row.attempts + 1;
            const message = err instanceof Error ? err.message : String(err);
            await tx.outboxEvent.update({
              where: { id: row.id },
              data: { attempts, lastError: message.slice(0, 1000), nextAttemptAt: new Date(Date.now() + backoffMs(attempts)) },
            });
            failed += 1;
            logger.warn({ eventId: row.id, eventType: envelope.eventType, attempts, err: message }, 'outbox publish failed');
          }
        }
        return { published, failed };
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  }

  // A failing poll (database down, migration not applied) backs off to 5 s and logs once per
  // failure streak instead of once every pollMs.
  const FAILURE_BACKOFF_MS = 5_000;
  let consecutiveFailures = 0;

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
            const message = err instanceof Error ? err.message : String(err);
            logger.error({ err: message.trim() }, `outbox relay poll failed; retrying every ${FAILURE_BACKOFF_MS / 1000}s until it succeeds`);
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
      await options.publisher.close?.();
    },
  };
}
