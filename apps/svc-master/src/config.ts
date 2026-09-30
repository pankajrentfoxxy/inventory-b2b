import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { loadEnv, serviceEnvSchema } from '@b2b/platform-kit';

const here = path.dirname(fileURLToPath(import.meta.url));
export const masterEnvSchema = serviceEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(4106),
  INVENTORY_URL: z.string().optional().or(z.literal('')),
});
export type MasterEnv = z.infer<typeof masterEnvSchema>;
export function loadConfig(overrides: Partial<MasterEnv> = {}): MasterEnv {
  return { ...loadEnv(masterEnvSchema, { dir: path.resolve(here, '..') }), ...overrides };
}
