import type { SqlClient, TransactionalClient } from './db.js';

/**
 * Inbox (README 5.8): exactly-once effect on top of at-least-once delivery. The `processed_events`
 * row is inserted in the same transaction as the consumer's side effects; a redelivery is a no-op.
 * Returns false when the event was already processed.
 */
export async function processOnce(client: TransactionalClient, consumer: string, eventId: string, handler: (tx: SqlClient) => Promise<void>): Promise<boolean> {
  return client.$transaction(
    async (tx) => {
      const inserted = await tx.$executeRaw`
        INSERT INTO "processed_events" ("consumer", "event_id") VALUES (${consumer}, ${eventId}::uuid)
        ON CONFLICT DO NOTHING`;
      if (inserted === 0) return false;
      await handler(tx);
      return true;
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

/** Variant for handlers that already run inside a transaction (e.g. together with RLS context). */
export async function claimEvent(tx: SqlClient, consumer: string, eventId: string): Promise<boolean> {
  const inserted = await tx.$executeRaw`
    INSERT INTO "processed_events" ("consumer", "event_id") VALUES (${consumer}, ${eventId}::uuid)
    ON CONFLICT DO NOTHING`;
  return inserted === 1;
}
