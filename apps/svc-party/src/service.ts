import type { Express } from 'express';
import { asKitClient, createOutboxRelay, createSecretBox, createServiceApp, wireService, type Broker, type Logger, type OutboxRelay, type WiringOverrides } from '@b2b/platform-kit';
import type { PartyEnv } from './config.js';
import { createPrisma, type PrismaClient } from './db.js';
import { createInternalPartyRouter, createPartyRouter, registerPartyConsumers } from './modules/party.routes.js';
import { PartyService } from './modules/party.service.js';

export interface PartyRuntime {
  app: Express;
  prisma: PrismaClient;
  service: PartyService;
  relay: OutboxRelay;
  broker: Broker;
  logger: Logger;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createPartyRuntime(config: PartyEnv, overrides: WiringOverrides & { prisma?: PrismaClient } = {}): Promise<PartyRuntime> {
  const wiring = wireService('svc-party', config, overrides);
  const prisma = overrides.prisma ?? createPrisma(config.DATABASE_URL, !wiring.isTest);
  const kit = asKitClient(prisma);
  const service = new PartyService(prisma, createSecretBox(config.APP_ENCRYPTION_KEY));
  const relay = createOutboxRelay({ client: kit, publisher: wiring.publisher, logger: wiring.logger, pollMs: config.OUTBOX_POLL_MS });
  const deps = { service, verifier: wiring.verifier, db: kit, logger: wiring.logger };
  const app = createServiceApp({
    service: 'svc-party',
    logger: wiring.logger,
    isTest: wiring.isTest,
    corsOrigins: wiring.corsOrigins,
    correlation: { allowOnBehalfOfTenant: true },
    healthChecks: { database: async () => { await prisma.$queryRaw`SELECT 1`; } },
    routes: (a) => {
      a.use('/api/v1/party', createPartyRouter(deps));
      a.use('/internal/v1', createInternalPartyRouter(deps));
    },
  });
  return {
    app, prisma, service, relay, broker: wiring.broker, logger: wiring.logger,
    async start() {
      await registerPartyConsumers({ broker: wiring.broker, client: kit, logger: wiring.logger }, service);
      if (config.OUTBOX_RELAY === 'on' && !wiring.isTest) relay.start();
    },
    async stop() {
      await relay.stop();
      await wiring.broker.close();
      await prisma.$disconnect();
    },
  };
}
