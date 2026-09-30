import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z, type ZodTypeAny } from 'zod';

/** Env variables every service has. Services extend this schema. */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive(),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /** Broker; empty = events are logged (development) or routed in-memory (tests). */
  AMQP_URL: z.string().url().optional().or(z.literal('')),
  AMQP_EXCHANGE: z.string().default('domain.events'),
  OUTBOX_RELAY: z.enum(['on', 'off']).default('on'),
  OUTBOX_POLL_MS: z.coerce.number().int().positive().default(200),
  /** RS256 public key (PEM) of svc-auth, or a JWKS URL. One of them is required to verify tokens. */
  AUTH_JWT_PUBLIC_KEY: z.string().optional(),
  AUTH_JWKS_URL: z.string().url().optional(),
  AUTH_ISSUER: z.string().default('svc-auth'),
  AUTH_AUDIENCE: z.string().default('b2b-inventory'),
});
export type BaseEnv = z.infer<typeof baseEnvSchema>;

export interface LoadEnvOptions {
  /** Directory holding .env / .env.test (usually the service root). */
  dir: string;
  source?: NodeJS.ProcessEnv;
}

/**
 * Fail-fast configuration: loads `<dir>/.env` (or `.env.test` under NODE_ENV=test) without
 * overriding variables already in the environment, then validates with zod.
 */
export function loadEnv<T extends ZodTypeAny>(schema: T, options: LoadEnvOptions): z.infer<T> {
  const source = options.source ?? process.env;
  const isTest = source.NODE_ENV === 'test';
  const file = path.resolve(options.dir, isTest ? '.env.test' : '.env');
  const fromFile: Record<string, string> = fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {};
  // Servers: the real environment wins over the file. Tests: the service's .env.test wins, so several
  // services can boot in one process without one service's DATABASE_URL leaking into the next.
  // process.env is never mutated.
  const merged = isTest ? { ...source, ...fromFile } : { ...fromFile, ...source };
  const parsed = schema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const splitList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
