/**
 * Composition root. `createAuthService` wires config, database, keys, broker, relay and consumers;
 * tests call it with an in-memory broker and their own database URL.
 */
import type { Express } from 'express';
import {
  AmqpBroker,
  InMemoryBroker,
  LogPublisher,
  asKitClient,
  createLocalServiceTokenSource,
  createLogger,
  createOutboxRelay,
  createSecretBox,
  createServiceApp,
  type Broker,
  type Logger,
  type OutboxRelay,
} from '@b2b/platform-kit';
import type { AuthConfig } from './config.js';
import { createPrisma, type PrismaClient } from './db.js';
import { AuthService } from './modules/auth.service.js';
import { createAuthRouter, createInternalRouter } from './modules/auth.routes.js';
import { registerAuthConsumers } from './modules/consumers.js';
import { BootstrapDirectory, IamDirectory, ReplicaTenantStatus, type MembershipDirectory, type TenantStatusSource } from './modules/directory.js';
import { SigningKeys } from './modules/keys.js';
import { IamPlatformDirectory, LocalPlatformDirectory, type PlatformDirectory } from './modules/platform-directory.js';

export interface AuthRuntime {
  app: Express;
  prisma: PrismaClient;
  service: AuthService;
  keys: SigningKeys;
  relay: OutboxRelay;
  broker: Broker;
  logger: Logger;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface AuthRuntimeOptions {
  broker?: Broker;
  prisma?: PrismaClient;
  directory?: MembershipDirectory;
  tenantStatus?: TenantStatusSource;
  platformDirectory?: PlatformDirectory;
}

export async function createAuthRuntime(config: AuthConfig, options: AuthRuntimeOptions = {}): Promise<AuthRuntime> {
  const logger = createLogger({ service: 'svc-auth', level: config.LOG_LEVEL, pretty: !config.isProd, silent: config.isTest });
  const prisma = options.prisma ?? createPrisma(config.DATABASE_URL, !config.isTest);
  const box = createSecretBox(config.APP_ENCRYPTION_KEY);
  const keys = new SigningKeys(prisma, box);
  await keys.init();

  const tokens = createLocalServiceTokenSource({ serviceName: 'svc-auth', privateKeyPem: keys.signing.privateKeyPem, kid: keys.signing.kid, issuer: config.AUTH_ISSUER });
  const directory = options.directory ?? (config.IAM_URL ? new IamDirectory(config.IAM_URL, tokens) : new BootstrapDirectory(prisma));
  const tenantStatus = options.tenantStatus ?? new ReplicaTenantStatus(prisma, config.TENANT_URL || undefined, tokens);
  const platformDirectory = options.platformDirectory ?? (config.IAM_URL ? new IamPlatformDirectory(config.IAM_URL, tokens) : new LocalPlatformDirectory(prisma));
  const service = new AuthService({ prisma, config, keys, box, directory, tenantStatus, platformDirectory });

  const broker: Broker = options.broker ?? (config.AMQP_URL ? new AmqpBroker({ url: config.AMQP_URL, exchange: config.AMQP_EXCHANGE, logger }) : new InMemoryBroker(logger));
  const publisher = config.AMQP_URL || options.broker ? broker : new LogPublisher(logger);
  const kitClient = asKitClient(prisma);
  const relay = createOutboxRelay({ client: kitClient, publisher, logger, pollMs: config.OUTBOX_POLL_MS });

  const app = createServiceApp({
    service: 'svc-auth',
    logger,
    isTest: config.isTest,
    corsOrigins: config.corsOrigins,
    healthChecks: { database: async () => { await prisma.$queryRaw`SELECT 1`; } },
    routes: (a) => {
      a.get('/.well-known/jwks.json', (_req, res) => {
        res.setHeader('cache-control', 'public, max-age=600');
        res.json(keys.jwks());
      });
      a.use('/api/v1/auth', createAuthRouter(service, config));
      a.use('/internal/v1', createInternalRouter(service));
    },
  });

  return {
    app, prisma, service, keys, relay, broker, logger,
    async start() {
      await registerAuthConsumers({ broker, client: kitClient, logger }, prisma, service);
      if (config.OUTBOX_RELAY === 'on' && !config.isTest) relay.start();
    },
    async stop() {
      await relay.stop();
      await broker.close();
      await prisma.$disconnect();
    },
  };
}
