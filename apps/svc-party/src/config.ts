import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { loadEnv, serviceEnvSchema } from '@b2b/platform-kit';

const here = path.dirname(fileURLToPath(import.meta.url));
export const partyEnvSchema = serviceEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(4107),
  APP_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'APP_ENCRYPTION_KEY must decode to 32 bytes'),
});
export type PartyEnv = z.infer<typeof partyEnvSchema>;
export function loadConfig(overrides: Partial<PartyEnv> = {}): PartyEnv {
  return { ...loadEnv(partyEnvSchema, { dir: path.resolve(here, '..') }), ...overrides };
}
