import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { loadEnv, serviceEnvSchema } from '@b2b/platform-kit';

const here = path.dirname(fileURLToPath(import.meta.url));
export const inventoryEnvSchema = serviceEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(4108),
  MASTER_URL: z.string().optional().or(z.literal('')),
});
export type InventoryEnv = z.infer<typeof inventoryEnvSchema>;
export function loadConfig(overrides: Partial<InventoryEnv> = {}): InventoryEnv {
  return { ...loadEnv(inventoryEnvSchema, { dir: path.resolve(here, '..') }), ...overrides };
}
