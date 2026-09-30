/**
 * Common wiring for a service built on the kit: config -> logger, key provider, verifier, broker,
 * service-token source. Keeps every service's composition root short.
 */
import { z } from 'zod';
import { JwksKeyProvider, StaticKeyProvider, createTokenVerifier, type KeyProvider, type TokenVerifier } from './auth.js';
import { AmqpBroker, InMemoryBroker, type Broker } from './broker.js';
import { baseEnvSchema, splitList } from './config.js';
import { createLogger, type Logger } from './logger.js';
import { LogPublisher, type EventPublisher } from './outbox.js';
import type { ServiceTokenSource } from './service-client.js';
import { createRemoteServiceTokenSource } from './service-tokens.js';

export const serviceEnvSchema = baseEnvSchema.extend({
  MIGRATE_DATABASE_URL: z.string().optional(),
  AUTH_URL: z.string().optional().or(z.literal('')),
  SERVICE_CLIENT_ID: z.string().optional(),
  SERVICE_CLIENT_SECRET: z.string().optional(),
});
export type ServiceEnv = z.infer<typeof serviceEnvSchema>;

export interface ServiceWiring {
  logger: Logger;
  isTest: boolean;
  isProd: boolean;
  corsOrigins: string[];
  keys: KeyProvider | null;
  verifier: TokenVerifier;
  broker: Broker;
  publisher: EventPublisher;
  /** Null when no AUTH_URL / client credentials are configured (tests inject their own). */
  serviceTokens: ServiceTokenSource | null;
}

export interface WiringOverrides {
  broker?: Broker;
  keys?: KeyProvider;
  serviceTokens?: ServiceTokenSource;
  logger?: Logger;
}

export function wireService(serviceName: string, env: ServiceEnv, overrides: WiringOverrides = {}): ServiceWiring {
  const isTest = env.NODE_ENV === 'test';
  const isProd = env.NODE_ENV === 'production';
  const logger = overrides.logger ?? createLogger({ service: serviceName, level: env.LOG_LEVEL, pretty: !isProd, silent: isTest });
  const keys = overrides.keys ?? (env.AUTH_JWT_PUBLIC_KEY ? new StaticKeyProvider(env.AUTH_JWT_PUBLIC_KEY) : env.AUTH_JWKS_URL ? new JwksKeyProvider(env.AUTH_JWKS_URL) : null);
  if (!keys) throw new Error(`${serviceName}: AUTH_JWT_PUBLIC_KEY or AUTH_JWKS_URL is required to verify tokens`);
  const verifier = createTokenVerifier({ keys, issuer: env.AUTH_ISSUER, audience: env.AUTH_AUDIENCE });
  const broker: Broker = overrides.broker ?? (env.AMQP_URL ? new AmqpBroker({ url: env.AMQP_URL, exchange: env.AMQP_EXCHANGE, logger }) : new InMemoryBroker(logger));
  const publisher: EventPublisher = env.AMQP_URL || overrides.broker ? broker : new LogPublisher(logger);
  const serviceTokens =
    overrides.serviceTokens ?? (env.AUTH_URL && env.SERVICE_CLIENT_ID && env.SERVICE_CLIENT_SECRET ? createRemoteServiceTokenSource({ authUrl: env.AUTH_URL, clientId: env.SERVICE_CLIENT_ID, clientSecret: env.SERVICE_CLIENT_SECRET }) : null);
  return { logger, isTest, isProd, corsOrigins: splitList(env.CORS_ORIGINS), keys, verifier, broker, publisher, serviceTokens };
}
