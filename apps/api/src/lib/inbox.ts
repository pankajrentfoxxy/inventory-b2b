/**
 * Inbox (phase-plan/README.md 5.8): exactly-once *effect* on top of at-least-once delivery.
 * The `processed_events` row is inserted in the same transaction as the consumer's side effects,
 * so a redelivered event (same eventId) is a no-op. Concurrent duplicates block on the primary key
 * until the first transaction commits, then see the conflict.
 */
import { prisma, type PrismaTx } from './prisma.js';

export async function processOnce(consumer: string, eventId: string, handler: (tx: PrismaTx) => Promise<void>): Promise<boolean> {
  return prisma.$transaction(
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
