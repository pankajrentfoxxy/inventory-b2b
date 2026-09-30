import type { Express } from 'express';
import { asKitClient, createMasterNumberingSource, createOutboxRelay, createServiceApp, createServiceClient, defaultNumberingSource, wireService, type Broker, type Logger, type NumberingSource, type OutboxRelay, type WiringOverrides } from '@b2b/platform-kit';
import type { QcEnv } from './config.js';
import { createPrisma, type PrismaClient } from './db.js';
import { registerQcConsumers } from './modules/consumers.js';
import { createQcRouter } from './modules/qc.routes.js';
import { QcService } from './modules/qc.service.js';

export interface QcRuntime {
  app: Express;
  prisma: PrismaClient;
  service: QcService;
  relay: OutboxRelay;
  broker: Broker;
  logger: Logger;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createQcRuntime(config: QcEnv, overrides: WiringOverrides & { prisma?: PrismaClient; numbering?: NumberingSource } = {}): Promise<QcRuntime> {
  const wiring = wireService('svc-qc', config, overrides);
  const prisma = overrides.prisma ?? createPrisma(config.DATABASE_URL, !wiring.isTest);
  const kit = asKitClient(prisma);
  let numbering: NumberingSource = overrides.numbering ?? defaultNumberingSource;
  if (!overrides.numbering && config.MASTER_URL && wiring.serviceTokens) {
    numbering = createMasterNumberingSource(createServiceClient({ targetService: 'svc-master', baseUrl: config.MASTER_URL, tokens: wiring.serviceTokens }), wiring.logger);
  }
  const service = new QcService(prisma, numbering);
  const relay = createOutboxRelay({ client: kit, publisher: wiring.publisher, logger: wiring.logger, pollMs: config.OUTBOX_POLL_MS });
  const app = createServiceApp({
    service: 'svc-qc',
    logger: wiring.logger,
    isTest: wiring.isTest,
    corsOrigins: wiring.corsOrigins,
    healthChecks: { database: async () => { await prisma.$queryRaw`SELECT 1`; } },
    routes: (a) => {
      a.use('/api/v1/qc', createQcRouter({ service, verifier: wiring.verifier, db: kit, logger: wiring.logger }));
    },
  });
  return {
    app, prisma, service, relay, broker: wiring.broker, logger: wiring.logger,
    async start() {
      await registerQcConsumers({ broker: wiring.broker, client: kit, logger: wiring.logger }, service);
      if (config.OUTBOX_RELAY === 'on' && !wiring.isTest) relay.start();
    },
    async stop() {
      await relay.stop();
      await wiring.broker.close();
      await prisma.$disconnect();
    },
  };
}
