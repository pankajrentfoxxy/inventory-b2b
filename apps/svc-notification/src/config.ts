import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { loadEnv, serviceEnvSchema } from '@b2b/platform-kit';

const here = path.dirname(fileURLToPath(import.meta.url));
export const notificationEnvSchema = serviceEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(4104),
  APP_URL: z.string().url().default('http://localhost:5173'),
  ADMIN_URL: z.string().url().default('http://localhost:5174'),
  SMTP_URL: z.string().optional().or(z.literal('')),
  MAIL_FROM: z.string().default('B2B Inventory <no-reply@localhost>'),
});
export type NotificationEnv = z.infer<typeof notificationEnvSchema>;
export function loadConfig(overrides: Partial<NotificationEnv> = {}): NotificationEnv {
  return { ...loadEnv(notificationEnvSchema, { dir: path.resolve(here, '..') }), ...overrides };
}
