import type { Express } from 'express';
import { asKitClient, createOutboxRelay, createServiceApp, createServiceClient, wireService, type Broker, type Logger, type OutboxRelay, type WiringOverrides } from '@b2b/platform-kit';
import type { MasterEnv } from './config.js';
import { createPrisma, type PrismaClient } from './db.js';
import { registerMasterConsumers } from './modules/consumers.js';
import { createInternalMasterRouter, createMasterRouter } from './modules/master.routes.js';
import { MasterService, noMovements, type MovementSource } from './modules/master.service.js';

export interface MasterRuntime {
  app: Express;
  prisma: PrismaClient;
  service: MasterService;
  relay: OutboxRelay;
  broker: Broker;
  logger: Logger;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createMasterRuntime(config: MasterEnv, overrides: WiringOverrides & { prisma?: PrismaClient; movements?: MovementSource } = {}): Promise<MasterRuntime> {
  const wiring = wireService('svc-master', config, overrides);
  const prisma = overrides.prisma ?? createPrisma(config.DATABASE_URL, !wiring.isTest);
  const kit = asKitClient(prisma);
  let movements: MovementSource = overrides.movements ?? noMovements;
  if (!overrides.movements && config.INVENTORY_URL && wiring.serviceTokens) {
    const client = createServiceClient({ targetService: 'svc-inventory', baseUrl: config.INVENTORY_URL, tokens: wiring.serviceTokens });
    movements = {
      async hasMovements(tenantId, itemId) {
        const res = await client.call<{ data: { hasMovements: boolean } }>(`/internal/v1/items/${itemId}/has-movements`, { correlationId: `master-${itemId}`, onBehalfOfTenant: tenantId });
        return res.data.hasMovements;
      },
    };
  }
  const service = new MasterService(prisma, movements);
  const relay = createOutboxRelay({ client: kit, publisher: wiring.publisher, logger: wiring.logger, pollMs: config.OUTBOX_POLL_MS });
  const deps = { service, verifier: wiring.verifier, db: kit, logger: wiring.logger };
  const app = createServiceApp({
    service: 'svc-master',
    logger: wiring.logger,
    isTest: wiring.isTest,
    corsOrigins: wiring.corsOrigins,
    correlation: { allowOnBehalfOfTenant: true },
    healthChecks: { database: async () => { await prisma.$queryRaw`SELECT 1`; } },
    routes: (a) => {
      a.use('/api/v1/master', createMasterRouter(deps));
      a.use('/internal/v1', createInternalMasterRouter(deps));
    },
  });
  return {
    app, prisma, service, relay, broker: wiring.broker, logger: wiring.logger,
    async start() {
      await registerMasterConsumers({ broker: wiring.broker, client: kit, logger: wiring.logger }, service);
      if (config.OUTBOX_RELAY === 'on' && !wiring.isTest) relay.start();
    },
    async stop() {
      await relay.stop();
      await wiring.broker.close();
      await prisma.$disconnect();
    },
  };
}
