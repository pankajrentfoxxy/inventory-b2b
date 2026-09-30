import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4010),
  LOG_LEVEL: z.string().default('info'),
  // upstreams
  LEGACY_API_URL: z.string().url().default('http://localhost:4000'),
  AUTH_URL: z.string().url().default('http://localhost:4101'),
  TENANT_URL: z.string().url().default('http://localhost:4102'),
  AUDIT_URL: z.string().url().default('http://localhost:4103'),
  IAM_URL: z.string().url().optional(),
  MASTER_URL: z.string().url().optional(),
  PARTY_URL: z.string().url().optional(),
  INVENTORY_URL: z.string().url().optional(),
  PROCUREMENT_URL: z.string().url().optional(),
  QC_URL: z.string().url().optional(),
  // token verification (ADR-0003 / ADR-0004)
  AUTH_JWKS_URL: z.string().url().optional(),
  AUTH_JWT_PUBLIC_KEY: z.string().optional(),
  AUTH_ISSUER: z.string().default('svc-auth'),
  AUTH_AUDIENCE: z.string().default('b2b-inventory'),
  /** Legacy HS256 adapter; unset it at the Phase 1 cut-over. */
  LEGACY_JWT_SECRET: z.string().min(16).optional(),
  // service credentials for the tenant-status fallback
  SERVICE_CLIENT_ID: z.string().default('gateway'),
  SERVICE_CLIENT_SECRET: z.string().optional(),
  // caches / broker
  REDIS_URL: z.string().optional(),
  AMQP_URL: z.string().url().optional().or(z.literal('')),
  AMQP_EXCHANGE: z.string().default('domain.events'),
  TENANT_STATUS_TTL_SEC: z.coerce.number().int().positive().default(300),
  // limits
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_PER_IP: z.coerce.number().int().positive().default(600),
  RATE_LIMIT_PER_PRINCIPAL: z.coerce.number().int().positive().default(300),
  BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  PROXY_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
});

export type GatewayConfig = z.infer<typeof configSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const parsed = configSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid gateway configuration:\n${issues}`);
  }
  return parsed.data;
}

/** Loads apps/gateway/.env, then falls back to apps/api/.env for the legacy JWT secret. */
export function loadConfigFromDotenv(): GatewayConfig {
  const suffix = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
  dotenv.config({ path: path.resolve(here, '../', suffix) });
  const apiEnv = dotenv.config({ path: path.resolve(here, '../../api', suffix), processEnv: {} }).parsed ?? {};
  if (!process.env.LEGACY_JWT_SECRET && (process.env.JWT_SECRET || apiEnv.JWT_SECRET)) process.env.LEGACY_JWT_SECRET = process.env.JWT_SECRET ?? apiEnv.JWT_SECRET;
  if (!process.env.LOG_LEVEL && apiEnv.LOG_LEVEL) process.env.LOG_LEVEL = apiEnv.LOG_LEVEL;
  if (!process.env.AUTH_JWKS_URL && !process.env.AUTH_JWT_PUBLIC_KEY) process.env.AUTH_JWKS_URL = `${process.env.AUTH_URL ?? 'http://localhost:4101'}/.well-known/jwks.json`;
  return loadConfig();
}
