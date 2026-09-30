/**
 * RS256 signing keys (ADR-0003). Keys live in `signing_keys`, private part encrypted at rest. The
 * newest active key signs; every active key is published in the JWKS so rotation is seamless:
 * `rotate()` adds a key, the old one keeps verifying until `retire()`.
 */
import { createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { publicKeyToJwk, type Jwk, type KeyProvider, type SecretBox } from '@b2b/platform-kit';
import type { PrismaClient } from '../db.js';

export interface ActiveKey {
  kid: string;
  privateKeyPem: string;
  publicKeyPem: string;
}

export class SigningKeys implements KeyProvider {
  private current: ActiveKey | null = null;
  private publicKeys = new Map<string, KeyObject>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly box: SecretBox,
  ) {}

  /** Loads active keys, generating the first one when the table is empty. */
  async init(): Promise<void> {
    let rows = await this.prisma.signingKey.findMany({ where: { active: true }, orderBy: { createdAt: 'desc' } });
    if (rows.length === 0) {
      await this.rotate();
      rows = await this.prisma.signingKey.findMany({ where: { active: true }, orderBy: { createdAt: 'desc' } });
    }
    this.publicKeys = new Map(rows.map((r) => [r.kid, createPublicKey(r.publicKeyPem)]));
    const newest = rows[0];
    this.current = { kid: newest.kid, privateKeyPem: this.box.decrypt(newest.privateKeyEnc), publicKeyPem: newest.publicKeyPem };
  }

  async rotate(): Promise<ActiveKey> {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const kid = `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await this.prisma.signingKey.create({ data: { kid, privateKeyEnc: this.box.encrypt(privateKeyPem), publicKeyPem, active: true } });
    this.publicKeys.set(kid, createPublicKey(publicKeyPem));
    this.current = { kid, privateKeyPem, publicKeyPem };
    return this.current;
  }

  async retire(kid: string): Promise<void> {
    await this.prisma.signingKey.update({ where: { kid }, data: { active: false, retiredAt: new Date() } });
    this.publicKeys.delete(kid);
  }

  get signing(): ActiveKey {
    if (!this.current) throw new Error('signing keys not initialised');
    return this.current;
  }

  async getPublicKey(kid: string | undefined): Promise<KeyObject | null> {
    if (!kid) return this.current ? this.publicKeys.get(this.current.kid) ?? null : null;
    return this.publicKeys.get(kid) ?? null;
  }

  jwks(): { keys: Jwk[] } {
    return { keys: [...this.publicKeys.entries()].map(([kid, key]) => publicKeyToJwk(key, kid)) };
  }
}
