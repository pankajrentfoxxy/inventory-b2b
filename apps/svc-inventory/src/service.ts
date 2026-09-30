import type { Express } from 'express';
import { asKitClient, createMasterNumberingSource, createOutboxRelay, createServiceApp, createServiceClient, defaultNumberingSource, wireService, type Broker, type Logger, type NumberingSource, type OutboxRelay, type WiringOverrides } from '@b2b/platform-kit';
import type { InventoryEnv } from './config.js';
import { createPrisma, type PrismaClient } from './db.js';
import { registerInventoryConsumers } from './modules/consumers.js';
import { createInternalInventoryRouter, createInventoryRouter } from './modules/inventory.routes.js';
import { InventoryService } from './modules/inventory.service.js';

export interface InventoryRuntime {
  app: Express;
  prisma: PrismaClient;
  service: InventoryService;
  relay: OutboxRelay;
  broker: Broker;
  logger: Logger;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createInventoryRuntime(config: InventoryEnv, overrides: WiringOverrides & { prisma?: PrismaClient; numbering?: NumberingSource } = {}): Promise<InventoryRuntime> {
  const wiring = wireService('svc-inventory', config, overrides);
  const prisma = overrides.prisma ?? createPrisma(config.DATABASE_URL, !wiring.isTest);
  const kit = asKitClient(prisma);
  let numbering: NumberingSource = overrides.numbering ?? defaultNumberingSource;
  if (!overrides.numbering && config.MASTER_URL && wiring.serviceTokens) {
    numbering = createMasterNumberingSource(createServiceClient({ targetService: 'svc-master', baseUrl: config.MASTER_URL, tokens: wiring.serviceTokens }), wiring.logger);
  }
  const service = new InventoryService(prisma, numbering);
  const relay = createOutboxRelay({ client: kit, publisher: wiring.publisher, logger: wiring.logger, pollMs: config.OUTBOX_POLL_MS });
  const deps = { service, verifier: wiring.verifier, db: kit, logger: wiring.logger };
  const app = createServiceApp({
    service: 'svc-inventory',
    logger: wiring.logger,
    isTest: wiring.isTest,
    corsOrigins: wiring.corsOrigins,
    correlation: { allowOnBehalfOfTenant: true },
    healthChecks: { database: async () => { await prisma.$queryRaw`SELECT 1`; } },
    routes: (a) => {
      a.use('/api/v1/inventory', createInventoryRouter(deps));
      a.use('/internal/v1', createInternalInventoryRouter(deps));
    },
  });
  return {
    app, prisma, service, relay, broker: wiring.broker, logger: wiring.logger,
    async start() {
      await registerInventoryConsumers({ broker: wiring.broker, client: kit, logger: wiring.logger }, service);
      if (config.OUTBOX_RELAY === 'on' && !wiring.isTest) relay.start();
    },
    async stop() {
      await relay.stop();
      await wiring.broker.close();
      await prisma.$disconnect();
    },
  };
}
