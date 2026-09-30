/** Reads the claims of a JWT without verifying it (the gateway verifies; the UI only needs the data). */
export interface AccessClaims {
  sub: string;
  typ: 'tenant' | 'platform';
  tid?: string;
  mid?: string;
  perms?: string[];
  pv?: number;
  wh?: string[] | null;
  sid?: string;
  email?: string;
  name?: string;
  exp?: number;
}

export function decodeJwt(token: string): AccessClaims | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    return JSON.parse(json) as AccessClaims;
  } catch {
    return null;
  }
}

export function isExpired(claims: AccessClaims | null, skewSec = 30): boolean {
  if (!claims?.exp) return false;
  return claims.exp * 1000 <= Date.now() + skewSec * 1000;
}
