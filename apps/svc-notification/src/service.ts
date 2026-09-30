import type { Express } from 'express';
import { asKitClient, createOutboxRelay, createServiceApp, wireService, type Broker, type Logger, type OutboxRelay, type WiringOverrides } from '@b2b/platform-kit';
import type { NotificationEnv } from './config.js';
import { createPrisma, type PrismaClient } from './db.js';
import { createInternalRouter, registerDispatcher } from './modules/dispatcher.js';
import { LogTransport, SmtpTransport, type EmailTransport } from './modules/transport.js';

export interface NotificationRuntime {
  app: Express;
  prisma: PrismaClient;
  relay: OutboxRelay;
  broker: Broker;
  logger: Logger;
  transport: EmailTransport;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createNotificationRuntime(config: NotificationEnv, overrides: WiringOverrides & { prisma?: PrismaClient; transport?: EmailTransport } = {}): Promise<NotificationRuntime> {
  const wiring = wireService('svc-notification', config, overrides);
  const prisma = overrides.prisma ?? createPrisma(config.DATABASE_URL, !wiring.isTest);
  const kit = asKitClient(prisma);
  const transport = overrides.transport ?? (config.SMTP_URL ? new SmtpTransport(config.SMTP_URL) : new LogTransport(wiring.logger));
  const relay = createOutboxRelay({ client: kit, publisher: wiring.publisher, logger: wiring.logger, pollMs: config.OUTBOX_POLL_MS });
  const app = createServiceApp({
    service: 'svc-notification',
    logger: wiring.logger,
    isTest: wiring.isTest,
    corsOrigins: wiring.corsOrigins,
    healthChecks: { database: async () => { await prisma.$queryRaw`SELECT 1`; } },
    routes: (a) => {
      a.use('/internal/v1', createInternalRouter(prisma, wiring.verifier));
    },
  });
  return {
    app, prisma, relay, broker: wiring.broker, logger: wiring.logger, transport,
    async start() {
      await registerDispatcher({ broker: wiring.broker, client: kit, logger: wiring.logger }, { transport, from: config.MAIL_FROM, templates: { appUrl: config.APP_URL, adminUrl: config.ADMIN_URL }, logger: wiring.logger });
      if (config.OUTBOX_RELAY === 'on' && !wiring.isTest) relay.start();
    },
    async stop() {
      await relay.stop();
      await wiring.broker.close();
      await prisma.$disconnect();
    },
  };
}
