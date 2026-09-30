import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { loadEnv, serviceEnvSchema } from '@b2b/platform-kit';

const here = path.dirname(fileURLToPath(import.meta.url));
export const qcEnvSchema = serviceEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(4110),
  MASTER_URL: z.string().optional().or(z.literal('')),
});
export type QcEnv = z.infer<typeof qcEnvSchema>;
export function loadConfig(overrides: Partial<QcEnv> = {}): QcEnv {
  return { ...loadEnv(qcEnvSchema, { dir: path.resolve(here, '..') }), ...overrides };
}
