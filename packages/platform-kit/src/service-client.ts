/**
 * Synchronous service-to-service calls (README 5.9): 3 s timeout, service token, correlation id,
 * optional on-behalf-of tenant, retries only when the caller marks the call idempotent.
 */
import { HttpError } from './errors.js';

export interface ServiceTokenSource {
  /** Returns a service token whose audience is `targetService`. */
  tokenFor(targetService: string): Promise<string>;
}

export interface ServiceCallOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  correlationId: string;
  onBehalfOfTenant?: string | null;
  idempotencyKey?: string;
  timeoutMs?: number;
  /** Retries on 503 / network errors (only for idempotent calls). */
  retries?: number;
}

export interface ServiceClient {
  call<T>(path: string, options: ServiceCallOptions): Promise<T>;
}

export interface ServiceClientOptions {
  targetService: string;
  baseUrl: string;
  tokens: ServiceTokenSource;
  fetchImpl?: typeof fetch;
}

export class ServiceUnavailableError extends HttpError {
  constructor(service: string, cause: string) {
    super(503, 'DEPENDENCY_UNAVAILABLE', `The ${service} service is unavailable (${cause})`, undefined, true);
  }
}

export function createServiceClient(options: ServiceClientOptions): ServiceClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async call<T>(path: string, callOptions: ServiceCallOptions): Promise<T> {
      const attempts = 1 + (callOptions.retries ?? 0);
      let lastError: unknown;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          const token = await options.tokens.tokenFor(options.targetService);
          const headers: Record<string, string> = {
            authorization: `Bearer ${token}`,
            'x-correlation-id': callOptions.correlationId,
            accept: 'application/json',
          };
          if (callOptions.body !== undefined) headers['content-type'] = 'application/json';
          if (callOptions.onBehalfOfTenant) headers['x-on-behalf-of-tenant'] = callOptions.onBehalfOfTenant;
          if (callOptions.idempotencyKey) headers['idempotency-key'] = callOptions.idempotencyKey;
          const res = await fetchImpl(`${options.baseUrl}${path}`, {
            method: callOptions.method ?? (callOptions.body !== undefined ? 'POST' : 'GET'),
            headers,
            body: callOptions.body !== undefined ? JSON.stringify(callOptions.body) : undefined,
            signal: AbortSignal.timeout(callOptions.timeoutMs ?? 3_000),
          });
          const text = await res.text();
          const json = text ? (JSON.parse(text) as unknown) : null;
          if (res.ok) return json as T;
          const body = json as { error?: { code?: string; message?: string; details?: { path: string; message: string }[]; retryable?: boolean } } | null;
          const err = new HttpError(res.status, body?.error?.code ?? 'UPSTREAM_ERROR', body?.error?.message ?? `${options.targetService} answered ${res.status}`, body?.error?.details, body?.error?.retryable ?? res.status === 503);
          if (res.status === 503 && attempt < attempts) {
            lastError = err;
            continue;
          }
          throw err;
        } catch (err) {
          if (err instanceof HttpError) throw err;
          lastError = err;
          if (attempt >= attempts) throw new ServiceUnavailableError(options.targetService, err instanceof Error ? err.message : String(err));
        }
      }
      throw lastError instanceof Error ? lastError : new ServiceUnavailableError(options.targetService, 'unknown');
    },
  };
}
