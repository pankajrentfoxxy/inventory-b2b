import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { loadEnv, serviceEnvSchema } from '@b2b/platform-kit';

const here = path.dirname(fileURLToPath(import.meta.url));
export const procurementEnvSchema = serviceEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(4109),
  MASTER_URL: z.string().optional().or(z.literal('')),
  PARTY_URL: z.string().optional().or(z.literal('')),
  INVENTORY_URL: z.string().optional().or(z.literal('')),
});
export type ProcurementEnv = z.infer<typeof procurementEnvSchema>;
export function loadConfig(overrides: Partial<ProcurementEnv> = {}): ProcurementEnv {
  return { ...loadEnv(procurementEnvSchema, { dir: path.resolve(here, '..') }), ...overrides };
}
