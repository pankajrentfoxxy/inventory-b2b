import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InMemoryBroker, truncateAll } from '@b2b/test-kit';
import { loadEnv } from '@b2b/platform-kit';
import { authEnvSchema, toConfig, type AuthEnv } from '../src/config.js';
import { createAuthRuntime, type AuthRuntime } from '../src/service.js';
import type { TenantStatusSource } from '../src/modules/directory.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function testConfig(overrides: Partial<AuthEnv> = {}) {
  const env = loadEnv(authEnvSchema, { dir: path.resolve(here, '..') });
  return toConfig({ ...env, ...overrides });
}

/** Tenant status source under test control (svc-tenant is not running in these tests). */
export class FakeTenantStatus implements TenantStatusSource {
  readonly statuses = new Map<string, { status: string; version: number }>();
  set(tenantId: string, status: string, version = 1) {
    this.statuses.set(tenantId, { status, version });
  }
  async get(tenantId: string) {
    return this.statuses.get(tenantId) ?? null;
  }
}

export async function bootAuth(overrides: Partial<AuthEnv> = {}): Promise<{ runtime: AuthRuntime; broker: InMemoryBroker; tenantStatus: FakeTenantStatus; config: ReturnType<typeof testConfig> }> {
  const config = testConfig(overrides);
  await truncateAll(config.MIGRATE_DATABASE_URL!);
  const broker = new InMemoryBroker();
  const tenantStatus = new FakeTenantStatus();
  const runtime = await createAuthRuntime(config, { broker, tenantStatus });
  await runtime.start();
  return { runtime, broker, tenantStatus, config };
}
