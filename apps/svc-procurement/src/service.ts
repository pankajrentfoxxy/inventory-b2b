import type { Express } from 'express';
import { asKitClient, createMasterNumberingSource, createOutboxRelay, createServiceApp, createServiceClient, defaultNumberingSource, wireService, type Broker, type Logger, type NumberingSource, type OutboxRelay, type WiringOverrides } from '@b2b/platform-kit';
import type { ProcurementEnv } from './config.js';
import { createPrisma, type PrismaClient } from './db.js';
import { registerProcurementConsumers } from './modules/consumers.js';
import { createProcurementRouter } from './modules/procurement.routes.js';
import { ProcurementService, type StorageSource } from './modules/procurement.service.js';
import { createRemoteSources, emptySources, type ProcurementSources } from './modules/sources.js';

export interface ProcurementRuntime {
  app: Express;
  prisma: PrismaClient;
  service: ProcurementService;
  relay: OutboxRelay;
  broker: Broker;
  logger: Logger;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createProcurementRuntime(config: ProcurementEnv, overrides: WiringOverrides & { prisma?: PrismaClient; numbering?: NumberingSource; sources?: ProcurementSources; storage?: StorageSource } = {}): Promise<ProcurementRuntime> {
  const wiring = wireService('svc-procurement', config, overrides);
  const prisma = overrides.prisma ?? createPrisma(config.DATABASE_URL, !wiring.isTest);
  const kit = asKitClient(prisma);
  let numbering: NumberingSource = overrides.numbering ?? defaultNumberingSource;
  if (!overrides.numbering && config.MASTER_URL && wiring.serviceTokens) {
    numbering = createMasterNumberingSource(createServiceClient({ targetService: 'svc-master', baseUrl: config.MASTER_URL, tokens: wiring.serviceTokens }), wiring.logger);
  }
  let sources: ProcurementSources = overrides.sources ?? emptySources;
  if (!overrides.sources && config.MASTER_URL && config.PARTY_URL && config.INVENTORY_URL && wiring.serviceTokens) {
    sources = createRemoteSources({ master: config.MASTER_URL, party: config.PARTY_URL, inventory: config.INVENTORY_URL }, wiring.serviceTokens, wiring.logger);
  }
  const service = new ProcurementService(prisma, numbering, sources);
  if (overrides.storage) service.storage = overrides.storage;
  const relay = createOutboxRelay({ client: kit, publisher: wiring.publisher, logger: wiring.logger, pollMs: config.OUTBOX_POLL_MS });
  const app = createServiceApp({
    service: 'svc-procurement',
    logger: wiring.logger,
    isTest: wiring.isTest,
    corsOrigins: wiring.corsOrigins,
    healthChecks: { database: async () => { await prisma.$queryRaw`SELECT 1`; } },
    routes: (a) => {
      a.use('/api/v1/procurement', createProcurementRouter({ service, verifier: wiring.verifier, db: kit, logger: wiring.logger }));
    },
  });
  return {
    app, prisma, service, relay, broker: wiring.broker, logger: wiring.logger,
    async start() {
      await registerProcurementConsumers({ broker: wiring.broker, client: kit, logger: wiring.logger }, service);
      if (config.OUTBOX_RELAY === 'on' && !wiring.isTest) relay.start();
    },
    async stop() {
      await relay.stop();
      await wiring.broker.close();
      await prisma.$disconnect();
    },
  };
}
