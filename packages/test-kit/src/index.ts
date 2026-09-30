/**
 * Test kit: RSA key pair + token minting, in-process app runner (real HTTP on an ephemeral port),
 * in-memory broker helpers, and Postgres helpers for per-service test databases.
 */
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import { InMemoryBroker, signClaims, type OutboxRelay, type TokenClaims } from '@b2b/platform-kit';
import { PLATFORM_PERMISSION_CODES, TENANT_PERMISSION_CODES } from '@b2b/contracts';

export { InMemoryBroker };

/* ---- keys & tokens ------------------------------------------------------ */

export interface TestKeys {
  privateKeyPem: string;
  publicKeyPem: string;
  kid: string;
  issuer: string;
  audience: string;
}

let cachedKeys: TestKeys | null = null;

/** One RSA key pair per test process (generation is slow). */
export function testKeys(): TestKeys {
  if (cachedKeys) return cachedKeys;
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  cachedKeys = {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    kid: 'test-key-1',
    issuer: 'svc-auth',
    audience: 'b2b-inventory',
  };
  return cachedKeys;
}

export interface MintOptions {
  expiresInSec?: number;
  audience?: string;
}

export function mintToken(claims: Omit<TokenClaims, 'iat' | 'exp' | 'iss' | 'aud'>, options: MintOptions = {}): string {
  const keys = testKeys();
  return signClaims(claims, options.expiresInSec ?? 600, { privateKeyPem: keys.privateKeyPem, kid: keys.kid, issuer: keys.issuer, audience: options.audience ?? keys.audience });
}

export interface TenantTokenInput {
  userId?: string;
  tenantId: string;
  membershipId?: string;
  perms?: string[];
  pv?: number;
  email?: string;
  name?: string;
  /** null/undefined = all warehouses. */
  warehouseIds?: string[] | null;
}

/** Tenant token; defaults to every tenant permission (an OWNER). */
export function tenantToken(input: TenantTokenInput): string {
  return mintToken({
    sub: input.userId ?? randomUUID(),
    typ: 'tenant',
    tid: input.tenantId,
    mid: input.membershipId ?? randomUUID(),
    perms: input.perms ?? TENANT_PERMISSION_CODES,
    pv: input.pv ?? 1,
    wh: input.warehouseIds ?? null,
    sid: randomUUID(),
    email: input.email ?? 'user@test.local',
    name: input.name ?? 'Test User',
  });
}

export function platformToken(input: { userId?: string; perms?: string[]; email?: string; name?: string } = {}): string {
  return mintToken({ sub: input.userId ?? randomUUID(), typ: 'platform', perms: input.perms ?? PLATFORM_PERMISSION_CODES, sid: randomUUID(), email: input.email ?? 'admin@platform.local', name: input.name ?? 'Platform Admin' });
}

export function serviceToken(callingService: string, targetService: string): string {
  return mintToken({ sub: callingService, typ: 'service', svc: callingService }, { audience: targetService, expiresInSec: 300 });
}

/* ---- running apps -------------------------------------------------------- */

export interface RunningApp {
  url: string;
  port: number;
  close(): Promise<void>;
}

export function startApp(app: Express): Promise<RunningApp> {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

/* ---- event flow --------------------------------------------------------- */

/**
 * Deterministic event propagation for tests: publish everything relays have, deliver to consumers,
 * repeat until nothing moves (consumers usually produce new outbox rows).
 */
export async function settleEvents(broker: InMemoryBroker, relays: OutboxRelay[], maxRounds = 25): Promise<void> {
  for (let round = 0; round < maxRounds; round += 1) {
    let moved = 0;
    for (const relay of relays) {
      const r = await relay.runOnce({ includeDeferred: true });
      moved += r.published;
    }
    moved += await broker.drain();
    if (moved === 0) return;
  }
  throw new Error(`events did not settle after ${maxRounds} rounds`);
}

/* ---- misc --------------------------------------------------------------- */

export const uuid = () => randomUUID();

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@test.local`;
}

export async function expectStatus(res: { status: number; body: unknown }, status: number, label = ''): Promise<void> {
  if (res.status !== status) throw new Error(`${label} expected ${status} got ${res.status}: ${JSON.stringify(res.body)}`);
}
export * from './db.js';
