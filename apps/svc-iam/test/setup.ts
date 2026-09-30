import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { StaticKeyProvider, loadEnv, uuidv7 } from '@b2b/platform-kit';
import { InMemoryBroker, testKeys, truncateAll } from '@b2b/test-kit';
import { iamEnvSchema, type IamEnv } from '../src/config.js';
import type { IdentityProvider } from '../src/modules/iam.service.js';
import { createIamRuntime, type IamRuntime } from '../src/service.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export class FakeIdentity implements IdentityProvider {
  readonly users = new Map<string, { userId: string; status: string }>();
  async ensureUser(input: { email: string; fullName: string; password?: string }) {
    const email = input.email.toLowerCase();
    let u = this.users.get(email);
    if (!u) {
      u = { userId: uuidv7(), status: input.password ? 'ACTIVE' : 'INVITED' };
      this.users.set(email, u);
    } else if (input.password) u.status = 'ACTIVE';
    return u;
  }
}

export function iamConfig(overrides: Partial<IamEnv> = {}): IamEnv {
  return { ...loadEnv(iamEnvSchema, { dir: path.resolve(here, '..') }), ...overrides };
}

export async function bootIam(overrides: Partial<IamEnv> = {}) {
  const config = iamConfig(overrides);
  await truncateAll(config.MIGRATE_DATABASE_URL!);
  const broker = new InMemoryBroker();
  const identity = new FakeIdentity();
  const runtime: IamRuntime = await createIamRuntime(config, { broker, keys: new StaticKeyProvider(testKeys().publicKeyPem), identity });
  await runtime.start();
  return { runtime, broker, identity, config };
}

export const newId = () => randomUUID();
