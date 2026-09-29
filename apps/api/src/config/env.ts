import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load apps/api/.env by absolute path so the process cwd does not matter
// (the repo-root `npm run dev` starts us from a different directory).
const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
dotenv.config({ path: path.resolve(here, '../../', envFile) });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  APP_ENCRYPTION_KEY: z
    .string()
    .min(1, 'APP_ENCRYPTION_KEY is required (32 bytes, base64)')
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'APP_ENCRYPTION_KEY must decode to 32 bytes'),
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),

  // GST portal lookup provider (see modules/integrations/gst.service.ts)
  GST_PROVIDER: z.enum(['none', 'zoho-session']).default('none'),
  ZOHO_GST_BASE_URL: z.string().url().default('https://inventory.zoho.in'),
  ZOHO_GST_ORGANIZATION_ID: z.string().optional(),
  ZOHO_GST_COOKIE: z.string().optional(),
  ZOHO_GST_CSRF_TOKEN: z.string().optional(),
  ZOHO_GST_ROLE_ID: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  uploadDir: path.resolve(here, '../../', parsed.data.UPLOAD_DIR),
  isProd: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
};
export type Env = typeof env;
