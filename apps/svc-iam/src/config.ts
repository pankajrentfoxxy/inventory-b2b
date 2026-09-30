import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { loadEnv, serviceEnvSchema } from '@b2b/platform-kit';

const here = path.dirname(fileURLToPath(import.meta.url));
export const iamEnvSchema = serviceEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(4105),
  INVITATION_TTL_HOURS: z.coerce.number().int().positive().default(72),
});
export type IamEnv = z.infer<typeof iamEnvSchema>;
export function loadConfig(overrides: Partial<IamEnv> = {}): IamEnv {
  return { ...loadEnv(iamEnvSchema, { dir: path.resolve(here, '..') }), ...overrides };
}
