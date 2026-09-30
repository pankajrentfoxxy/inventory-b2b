import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { loadEnv, serviceEnvSchema } from '@b2b/platform-kit';

const here = path.dirname(fileURLToPath(import.meta.url));

export const tenantEnvSchema = serviceEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(4102),
  AUDIT_URL: z.string().optional().or(z.literal('')),
  TENANT_FOUR_EYES: z.enum(['on', 'off']).default('on'),
  CAPTCHA_PROVIDER: z.enum(['none', 'turnstile']).default('none'),
  CAPTCHA_SECRET: z.string().optional(),
  APPLICATION_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(3),
});
export type TenantEnv = z.infer<typeof tenantEnvSchema>;

export function loadConfig(overrides: Partial<TenantEnv> = {}): TenantEnv {
  return { ...loadEnv(tenantEnvSchema, { dir: path.resolve(here, '..') }), ...overrides };
}
