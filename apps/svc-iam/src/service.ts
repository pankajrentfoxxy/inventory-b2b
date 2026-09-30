import type { Express } from 'express';
import { asKitClient, createOutboxRelay, createServiceApp, createServiceClient, wireService, type Broker, type Logger, type OutboxRelay, type WiringOverrides } from '@b2b/platform-kit';
import type { IamEnv } from './config.js';
import { createPrisma, type PrismaClient } from './db.js';
import { registerIamConsumers } from './modules/consumers.js';
import { createInternalIamRouter, createPlatformIamRouter, createTenantIamRouter } from './modules/iam.routes.js';
import { IamService, type IdentityProvider } from './modules/iam.service.js';

export interface IamRuntime {
  app: Express;
  prisma: PrismaClient;
  service: IamService;
  relay: OutboxRelay;
  broker: Broker;
  logger: Logger;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createIamRuntime(config: IamEnv, overrides: WiringOverrides & { prisma?: PrismaClient; identity?: IdentityProvider } = {}): Promise<IamRuntime> {
  const wiring = wireService('svc-iam', config, overrides);
  const prisma = overrides.prisma ?? createPrisma(config.DATABASE_URL, !wiring.isTest);
  const kit = asKitClient(prisma);
  const identity: IdentityProvider =
    overrides.identity ??
    (() => {
      if (!config.AUTH_URL || !wiring.serviceTokens) throw new Error('svc-iam: AUTH_URL and service credentials are required (identity provider)');
      const client = createServiceClient({ targetService: 'svc-auth', baseUrl: config.AUTH_URL, tokens: wiring.serviceTokens });
      return {
        async ensureUser(input, correlationId) {
          const res = await client.call<{ data: { userId: string; status: string } }>('/internal/v1/users:ensure', { body: input, correlationId });
          return res.data;
        },
      };
    })();
  const service = new IamService(prisma, identity, config.INVITATION_TTL_HOURS);
  const relay = createOutboxRelay({ client: kit, publisher: wiring.publisher, logger: wiring.logger, pollMs: config.OUTBOX_POLL_MS });
  const deps = { service, verifier: wiring.verifier, db: kit, logger: wiring.logger };
  const app = createServiceApp({
    service: 'svc-iam',
    logger: wiring.logger,
    isTest: wiring.isTest,
    corsOrigins: wiring.corsOrigins,
    healthChecks: { database: async () => { await prisma.$queryRaw`SELECT 1`; } },
    routes: (a) => {
      a.use('/api/v1/iam', createTenantIamRouter(deps));
      a.use('/api/v1/platform/iam', createPlatformIamRouter(deps));
      a.use('/internal/v1', createInternalIamRouter(deps));
    },
  });
  return {
    app, prisma, service, relay, broker: wiring.broker, logger: wiring.logger,
    async start() {
      await service.syncCatalog();
      await registerIamConsumers({ broker: wiring.broker, client: kit, logger: wiring.logger }, service);
      if (config.OUTBOX_RELAY === 'on' && !wiring.isTest) relay.start();
    },
    async stop() {
      await relay.stop();
      await wiring.broker.close();
      await prisma.$disconnect();
    },
  };
}
