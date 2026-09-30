import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { loadEnv, serviceEnvSchema } from '@b2b/platform-kit';

const here = path.dirname(fileURLToPath(import.meta.url));
export const auditEnvSchema = serviceEnvSchema.extend({ PORT: z.coerce.number().int().positive().default(4103) });
export type AuditEnv = z.infer<typeof auditEnvSchema>;
export function loadConfig(overrides: Partial<AuditEnv> = {}): AuditEnv {
  return { ...loadEnv(auditEnvSchema, { dir: path.resolve(here, '..') }), ...overrides };
}
