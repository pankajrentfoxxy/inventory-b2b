/**
 * Live smoke test for the event pipeline (phase-plan/phase-00 step 6): enqueue an
 * `audit.recorded.v1` envelope through the outbox, relay it to RabbitMQ with `AmqpPublisher`, then
 * consume it back from the `audit.recorded` and `platform.event-archive` queues.
 *
 *   npm run events:smoke -w @b2b/api            # needs infra/docker-compose.yml running
 *   AMQP_URL=amqp://user:pass@host:5672 npm run events:smoke -w @b2b/api
 *
 * Exits non-zero when the event does not arrive in both queues. Uses the database from the
 * current environment (.env.test by default) and leaves one published outbox row behind.
 */
import { randomUUID } from 'node:crypto';
import amqp from 'amqplib';
import { prisma } from '../src/lib/prisma.js';
import { createOutboxRelay, enqueueEvent } from '../src/lib/outbox.js';
import { AmqpPublisher } from '../src/lib/amqpPublisher.js';

const AMQP_URL = process.env.AMQP_URL ?? 'amqp://b2b:b2b_dev@localhost:5672';
const EXCHANGE = process.env.AMQP_EXCHANGE ?? 'domain.events';
const QUEUES = ['audit.recorded', 'platform.event-archive'];

async function drain(channel: amqp.Channel, queue: string): Promise<string[]> {
  const ids: string[] = [];
  for (;;) {
    const msg = await channel.get(queue, { noAck: true });
    if (!msg) break;
    ids.push(JSON.parse(msg.content.toString()).eventId as string);
  }
  return ids;
}

async function main() {
  const connection = await amqp.connect(AMQP_URL);
  const channel = await connection.createChannel();
  for (const q of QUEUES) {
    await channel.checkQueue(q);
    await drain(channel, q);
  }

  const envelope = await prisma.$transaction((tx) =>
    enqueueEvent(tx, {
      eventType: 'audit.recorded',
      tenantId: randomUUID(),
      correlationId: `smoke-${randomUUID()}`,
      actor: { type: 'system', id: null, name: 'outbox-smoke' },
      aggregate: { type: 'purchase_order', id: randomUUID(), version: 1 },
      payload: { action: 'PO_CREATED', entityType: 'PURCHASE_ORDER', summary: 'outbox smoke test' },
    }),
  );

  const publisher = new AmqpPublisher(AMQP_URL, EXCHANGE);
  const relay = createOutboxRelay({ publisher, batchSize: 100 });
  const relayed = await relay.runOnce({ includeDeferred: true });
  await relay.stop();

  const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: envelope.eventId } });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const received: Record<string, boolean> = {};
  for (const q of QUEUES) received[q] = (await drain(channel, q)).includes(envelope.eventId);

  await channel.close();
  await connection.close();
  await prisma.$disconnect();

  const ok = Boolean(row.publishedAt) && Object.values(received).every(Boolean);
  console.log(JSON.stringify({ eventId: envelope.eventId, relayed, publishedAt: row.publishedAt, attempts: row.attempts, received, ok }, null, 2));
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
