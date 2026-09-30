import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import { normalizeSearch } from '@b2b/shared';

export const TOKEN_KEY = 'b2b.token';
export const ORG_KEY = 'b2b.orgId';
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
export const CORRELATION_HEADER = 'x-correlation-id';

/**
 * One axios instance for everything. Base URL `/api`: the gateway routes `/api/v1/<service>` to the
 * services and legacy paths to the legacy API, so feature modules call `/v1/master/products` or
 * `/vendors` and never know where a request lands.
 */
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
  timeout: 30_000,
  withCredentials: true,
});

export const storage = {
  get token() {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set token(v: string | null) {
    try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
  },
  get orgId() {
    try { return localStorage.getItem(ORG_KEY); } catch { return null; }
  },
  set orgId(v: string | null) {
    try { v ? localStorage.setItem(ORG_KEY, v) : localStorage.removeItem(ORG_KEY); } catch { /* private mode */ }
  },
};

api.interceptors.request.use((config) => {
  const token = storage.token;
  const orgId = storage.orgId;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (orgId) config.headers['X-Organization-Id'] = orgId;
  const params = config.params as Record<string, unknown> | undefined;
  if (params && typeof params.search === 'string') {
    const clean = normalizeSearch(params.search);
    if (clean) params.search = clean;
    else delete params.search;
  }
  if (params && typeof params.q === 'string') {
    const clean = normalizeSearch(params.q);
    if (clean) params.q = clean;
    else delete params.q;
  }
  return config;
});

/** Request config that attaches an Idempotency-Key to a mutation (see hooks/useIdempotencyKey). */
export function withIdempotencyKey(key: string, config: AxiosRequestConfig = {}): AxiosRequestConfig {
  return { ...config, headers: { ...(config.headers ?? {}), [IDEMPOTENCY_HEADER]: key } };
}

/** `{ data: T }` unwrapping used by every service endpoint. */
export const unwrap = <T>(r: { data: { data: T } }): T => r.data.data;

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();
export function onUnauthorized(fn: UnauthorizedListener) {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}
type TokenListener = (token: string) => void;
const tokenListeners = new Set<TokenListener>();
export function onTokenRefreshed(fn: TokenListener) {
  tokenListeners.add(fn);
  return () => tokenListeners.delete(fn);
}

const AUTH_FLOW_PATHS = ['/v1/auth/login', '/v1/auth/refresh', '/v1/auth/mfa/verify', '/v1/auth/select-tenant', '/v1/auth/logout', '/v1/auth/password', '/v1/auth/invitations/accept', '/v1/iam/invitations/accept'];
let refreshing: Promise<string | null> | null = null;

/**
 * Silent refresh: the refresh token lives in an httpOnly cookie scoped to `/api/v1/auth`, so the
 * browser sends it and the response carries a new access token (with fresh permissions, which is
 * also how PERMISSIONS_STALE from the gateway resolves itself).
 */
export async function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = axios
      .post<{ data: { accessToken: string } }>(`${api.defaults.baseURL}/v1/auth/refresh`, {}, { withCredentials: true, timeout: 15_000 })
      .then((r) => {
        const token = r.data.data.accessToken;
        storage.token = token;
        tokenListeners.forEach((fn) => fn(token));
        return token;
      })
      .catch(() => null)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const config = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
    const url = config?.url ?? '';
    if (error.response?.status === 401 && config && !config._retried && !AUTH_FLOW_PATHS.some((p) => url.startsWith(p)) && storage.token) {
      config._retried = true;
      const token = await refreshAccessToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
        return api.request(config);
      }
      unauthorizedListeners.forEach((fn) => fn());
    }
    return Promise.reject(error);
  },
);

export interface ApiErrorDetail {
  path: string;
  message: string;
  [key: string]: unknown;
}
export interface ApiError {
  status: number;
  code: string;
  message: string;
  /** Ordered field errors as sent by the API (path uses dot notation, e.g. "contacts.0.mobile"). */
  details: ApiErrorDetail[];
  /** The same errors keyed by path; first message wins. Mirrors the API `errors` object. */
  fieldErrors: Record<string, string>;
  /** Support reference: matches the gateway / API logs for this request. */
  correlationId: string | null;
  /** The server says repeating the same request (same Idempotency-Key) may succeed. */
  retryable: boolean;
}

interface ApiErrorBody {
  success?: false;
  message?: string;
  error?: { code?: string; message?: string; details?: ApiErrorDetail[]; correlationId?: string; retryable?: boolean };
  errors?: Record<string, string>;
}

function fieldErrorsFrom(details: ApiErrorDetail[], provided?: Record<string, string>): Record<string, string> {
  if (provided) return provided;
  const out: Record<string, string> = {};
  for (const d of details) if (d.path && !(d.path in out)) out[d.path] = d.message;
  return out;
}

/** "Reference: c0f1abcd" suffix for errors where the user may need to contact support. */
function withReference(message: string, correlationId: string | null, status: number): string {
  if (!correlationId || (status > 0 && status < 500)) return message;
  return `${message} (Reference: ${correlationId.slice(0, 8)})`;
}

/** Normalises axios / network / server errors into one shape the UI can render. */
export function toApiError(err: unknown): ApiError {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as ApiErrorBody | undefined;
    const headerId = err.response?.headers?.[CORRELATION_HEADER];
    const correlationId = body?.error?.correlationId ?? (typeof headerId === 'string' ? headerId : null);
    const status = err.response?.status ?? 0;
    if (body?.error) {
      const details = body.error.details ?? [];
      return {
        status,
        code: body.error.code ?? 'ERROR',
        message: withReference(body.error.message ?? body.message ?? 'Something went wrong', correlationId, status),
        details,
        fieldErrors: fieldErrorsFrom(details, body.errors),
        correlationId,
        retryable: body.error.retryable ?? false,
      };
    }
    if (!err.response) {
      return { status: 0, code: 'NETWORK', message: 'Cannot reach the server. Check your connection and try again.', details: [], fieldErrors: {}, correlationId: null, retryable: true };
    }
    return { status, code: 'HTTP_ERROR', message: withReference(err.message, correlationId, status), details: [], fieldErrors: {}, correlationId, retryable: status >= 500 };
  }
  return { status: 0, code: 'UNKNOWN', message: err instanceof Error ? err.message : 'Something went wrong', details: [], fieldErrors: {}, correlationId: null, retryable: false };
}
