import fs from 'node:fs';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { createOutboxRelay, LogPublisher, type EventPublisher } from './lib/outbox.js';
import { AmqpPublisher } from './lib/amqpPublisher.js';
import { createApp } from './app.js';

fs.mkdirSync(env.uploadDir, { recursive: true });

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API listening');
});

// Outbox relay: publishes audit / domain events written by request transactions.
const publisher: EventPublisher = env.AMQP_URL ? new AmqpPublisher(env.AMQP_URL, env.AMQP_EXCHANGE) : new LogPublisher();
const relay = createOutboxRelay({ publisher, pollMs: env.OUTBOX_POLL_MS });
if (env.OUTBOX_RELAY === 'on' && !env.isTest) {
  relay.start();
  logger.info({ broker: env.AMQP_URL ? 'amqp' : 'log', exchange: env.AMQP_EXCHANGE }, 'Outbox relay started');
}

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  server.close(async () => {
    await relay.stop();
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
