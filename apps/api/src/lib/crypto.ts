import crypto from 'node:crypto';
import { env } from '../config/env.js';

const key = Buffer.from(env.APP_ENCRYPTION_KEY, 'base64');
const ALGO = 'aes-256-gcm';
const VERSION = 'v1';

/** Returns `v1.<iv>.<tag>.<ciphertext>` (base64 parts). Versioned so keys can be rotated later. */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.');
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split('.');
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Unrecognised encrypted payload format');
  }
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}
