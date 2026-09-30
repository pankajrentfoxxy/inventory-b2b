import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { baseEnvSchema, loadEnv, splitList } from '@b2b/platform-kit';

const here = path.dirname(fileURLToPath(import.meta.url));

export const authEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(4101),
  MIGRATE_DATABASE_URL: z.string().optional(),
  APP_ENCRYPTION_KEY: z
    .string()
    .min(1, 'APP_ENCRYPTION_KEY is required (32 bytes, base64)')
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'APP_ENCRYPTION_KEY must decode to 32 bytes'),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(600),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(14),
  LOCKOUT_THRESHOLD: z.coerce.number().int().positive().default(10),
  LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  LOGIN_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(5),
  PLATFORM_MFA_REQUIRED: z.enum(['on', 'off']).default('on'),
  /**
   * DEVELOPMENT ONLY. A fixed 6-digit code accepted as the platform two-factor code, so staff can sign
   * in before they set up an authenticator. Refused at boot when NODE_ENV=production. Every use is audited.
   */
  MFA_DEV_BYPASS_CODE: z.string().regex(/^d{6}$/, 'MFA_DEV_BYPASS_CODE must be 6 digits').optional().or(z.literal('')),
  COOKIE_SECURE: z.enum(['on', 'off']).default('off'),
  SERVICE_CLIENTS: z.string().default(''),
  TENANT_URL: z.string().optional().or(z.literal('')),
  IAM_URL: z.string().optional().or(z.literal('')),
});

export type AuthEnv = z.infer<typeof authEnvSchema>;

export interface AuthConfig extends AuthEnv {
  isTest: boolean;
  isProd: boolean;
  corsOrigins: string[];
  serviceClients: Map<string, string>;
}

export function toConfig(env: AuthEnv): AuthConfig {
  if (env.MFA_DEV_BYPASS_CODE && env.NODE_ENV === 'production') {
    throw new Error('MFA_DEV_BYPASS_CODE must not be set when NODE_ENV=production');
  }
  const serviceClients = new Map<string, string>();
  for (const pair of splitList(env.SERVICE_CLIENTS)) {
    const idx = pair.indexOf(':');
    if (idx > 0) serviceClients.set(pair.slice(0, idx), pair.slice(idx + 1));
  }
  return { ...env, isTest: env.NODE_ENV === 'test', isProd: env.NODE_ENV === 'production', corsOrigins: splitList(env.CORS_ORIGINS), serviceClients };
}

export function loadConfig(overrides: Partial<AuthEnv> = {}): AuthConfig {
  const env = loadEnv(authEnvSchema, { dir: path.resolve(here, '..') });
  return toConfig({ ...env, ...overrides });
}
