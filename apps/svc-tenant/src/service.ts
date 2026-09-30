import type { Express } from 'express';
import { asKitClient, createOutboxRelay, createServiceApp, wireService, type Broker, type Logger, type OutboxRelay, type WiringOverrides } from '@b2b/platform-kit';
import type { TenantEnv } from './config.js';
import { createPrisma, type PrismaClient } from './db.js';
import { noCaptcha, turnstileCaptcha } from './modules/captcha.js';
import { createInternalRouter, createPlatformRouter, createPublicRouter } from './modules/tenant.routes.js';
import { TenantService } from './modules/tenant.service.js';

export interface TenantRuntime {
  app: Express;
  prisma: PrismaClient;
  service: TenantService;
  relay: OutboxRelay;
  broker: Broker;
  logger: Logger;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createTenantRuntime(config: TenantEnv, overrides: WiringOverrides & { prisma?: PrismaClient } = {}): Promise<TenantRuntime> {
  const wiring = wireService('svc-tenant', config, overrides);
  const prisma = overrides.prisma ?? createPrisma(config.DATABASE_URL, !wiring.isTest);
  const kit = asKitClient(prisma);
  const service = new TenantService(prisma, { fourEyes: config.TENANT_FOUR_EYES === 'on' });
  const relay = createOutboxRelay({ client: kit, publisher: wiring.publisher, logger: wiring.logger, pollMs: config.OUTBOX_POLL_MS });
  const captcha = config.CAPTCHA_PROVIDER === 'turnstile' && config.CAPTCHA_SECRET ? turnstileCaptcha(config.CAPTCHA_SECRET) : noCaptcha;
  const deps = { service, verifier: wiring.verifier, db: kit, logger: wiring.logger, config, serviceTokens: wiring.serviceTokens, captcha };

  const app = createServiceApp({
    service: 'svc-tenant',
    logger: wiring.logger,
    isTest: wiring.isTest,
    corsOrigins: wiring.corsOrigins,
    healthChecks: { database: async () => { await prisma.$queryRaw`SELECT 1`; } },
    routes: (a) => {
      a.use('/api/v1/platform', createPlatformRouter(deps));
      a.use('/api/v1/public', createPublicRouter(deps));
      a.use('/internal/v1', createInternalRouter(deps));
    },
  });

  return {
    app, prisma, service, relay, broker: wiring.broker, logger: wiring.logger,
    async start() {
      if (config.OUTBOX_RELAY === 'on' && !wiring.isTest) relay.start();
    },
    async stop() {
      await relay.stop();
      await wiring.broker.close();
      await prisma.$disconnect();
    },
  };
}
