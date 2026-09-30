import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';
const VERSION = 'v1';

/** AES-256-GCM with a 32-byte key (base64 in config). Output `v1.<iv>.<tag>.<ciphertext>`. */
export function createSecretBox(keyBase64: string) {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('Encryption key must decode to 32 bytes');
  return {
    encrypt(plain: string): string {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv(ALGO, key, iv);
      const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
    },
    decrypt(payload: string): string {
      const [version, ivB64, tagB64, dataB64] = payload.split('.');
      if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) throw new Error('Unrecognised encrypted payload format');
      const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
      decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
    },
  };
}
export type SecretBox = ReturnType<typeof createSecretBox>;

/** Constant-time string comparison for secrets / tokens. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
