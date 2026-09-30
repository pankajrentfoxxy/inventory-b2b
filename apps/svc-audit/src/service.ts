import type { Express } from 'express';
import { asKitClient, createOutboxRelay, createServiceApp, wireService, type Broker, type Logger, type OutboxRelay, type WiringOverrides } from '@b2b/platform-kit';
import type { AuditEnv } from './config.js';
import { createPrisma, type PrismaClient } from './db.js';
import { createAuditRouters, registerAuditConsumer } from './modules/audit.js';

export interface AuditRuntime {
  app: Express;
  prisma: PrismaClient;
  relay: OutboxRelay;
  broker: Broker;
  logger: Logger;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createAuditRuntime(config: AuditEnv, overrides: WiringOverrides & { prisma?: PrismaClient } = {}): Promise<AuditRuntime> {
  const wiring = wireService('svc-audit', config, overrides);
  const prisma = overrides.prisma ?? createPrisma(config.DATABASE_URL, !wiring.isTest);
  const kit = asKitClient(prisma);
  const relay = createOutboxRelay({ client: kit, publisher: wiring.publisher, logger: wiring.logger, pollMs: config.OUTBOX_POLL_MS });
  const { tenantRouter, internalRouter } = createAuditRouters(prisma, kit, wiring.verifier);
  const app = createServiceApp({
    service: 'svc-audit',
    logger: wiring.logger,
    isTest: wiring.isTest,
    corsOrigins: wiring.corsOrigins,
    healthChecks: { database: async () => { await prisma.$queryRaw`SELECT 1`; } },
    routes: (a) => {
      a.use('/api/v1/audit', tenantRouter);
      a.use('/internal/v1', internalRouter);
    },
  });
  return {
    app, prisma, relay, broker: wiring.broker, logger: wiring.logger,
    async start() {
      await registerAuditConsumer({ broker: wiring.broker, client: kit, logger: wiring.logger });
      if (config.OUTBOX_RELAY === 'on' && !wiring.isTest) relay.start();
    },
    async stop() {
      await relay.stop();
      await wiring.broker.close();
      await prisma.$disconnect();
    },
  };
}
