/**
 * Service tokens (README 5.1 rule 5): `typ=service`, `sub=<calling service>`, `aud=<target service>`.
 * Two sources: the remote one asks svc-auth with client credentials (production); the local one
 * signs with a private key (svc-auth itself, co-hosted development, tests).
 */
import type { ServiceTokenSource } from './service-client.js';
import { signClaims } from './auth.js';
import { ServiceUnavailableError } from './service-client.js';

interface CachedToken {
  token: string;
  expiresAt: number;
}

const REFRESH_MARGIN_MS = 30_000;

export interface RemoteServiceTokenOptions {
  authUrl: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}

export function createRemoteServiceTokenSource(options: RemoteServiceTokenOptions): ServiceTokenSource {
  const fetchImpl = options.fetchImpl ?? fetch;
  const cache = new Map<string, CachedToken>();
  return {
    async tokenFor(targetService) {
      const cached = cache.get(targetService);
      if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) return cached.token;
      let res: Response;
      try {
        res = await fetchImpl(`${options.authUrl}/internal/v1/service-tokens`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ clientId: options.clientId, clientSecret: options.clientSecret, audience: targetService }),
          signal: AbortSignal.timeout(3_000),
        });
      } catch (err) {
        throw new ServiceUnavailableError('svc-auth', err instanceof Error ? err.message : String(err));
      }
      if (!res.ok) throw new ServiceUnavailableError('svc-auth', `service token request answered ${res.status}`);
      const body = (await res.json()) as { accessToken: string; expiresIn: number };
      cache.set(targetService, { token: body.accessToken, expiresAt: Date.now() + body.expiresIn * 1000 });
      return body.accessToken;
    },
  };
}

export interface LocalServiceTokenOptions {
  serviceName: string;
  privateKeyPem: string;
  kid: string;
  issuer: string;
  ttlSec?: number;
}

export function createLocalServiceTokenSource(options: LocalServiceTokenOptions): ServiceTokenSource {
  const cache = new Map<string, CachedToken>();
  const ttl = options.ttlSec ?? 300;
  return {
    async tokenFor(targetService) {
      const cached = cache.get(targetService);
      if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) return cached.token;
      const token = signClaims({ sub: options.serviceName, typ: 'service', svc: options.serviceName }, ttl, {
        privateKeyPem: options.privateKeyPem,
        kid: options.kid,
        issuer: options.issuer,
        audience: targetService,
      });
      cache.set(targetService, { token, expiresAt: Date.now() + ttl * 1000 });
      return token;
    },
  };
}
