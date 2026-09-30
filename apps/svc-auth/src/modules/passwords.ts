/**
 * Password hashing: argon2id for everything new; bcrypt only to verify legacy hashes, which are
 * rehashed to argon2id on the next successful login (phase-01 step 1).
 */
import argon2 from 'argon2';
import bcrypt from 'bcryptjs';

export type PasswordAlgo = 'argon2id' | 'bcrypt';

const ARGON_OPTIONS: argon2.Options = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON_OPTIONS);
}

export async function verifyPassword(plain: string, hash: string, algo: PasswordAlgo): Promise<boolean> {
  try {
    if (algo === 'bcrypt') return await bcrypt.compare(plain, hash);
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** Dummy hash so a missing user costs the same time as a wrong password (no user enumeration by timing). */
let dummyHash: string | null = null;
export async function burnTime(plain: string): Promise<void> {
  if (!dummyHash) dummyHash = await hashPassword('not-a-real-password');
  await argon2.verify(dummyHash, plain).catch(() => false);
}

/** Password policy: 10+ chars with letters and digits. Kept simple and explicit; no regex needed. */
export function passwordProblem(plain: string): string | null {
  if (plain.length < 10) return 'Password must be at least 10 characters';
  if (plain.length > 128) return 'Password must be at most 128 characters';
  let hasLetter = false;
  let hasDigit = false;
  for (const ch of plain) {
    if (ch >= '0' && ch <= '9') hasDigit = true;
    else if (ch.toLowerCase() !== ch.toUpperCase()) hasLetter = true;
  }
  if (!hasLetter || !hasDigit) return 'Password must contain letters and digits';
  return null;
}
