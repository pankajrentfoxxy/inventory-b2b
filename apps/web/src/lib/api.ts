import axios, { AxiosError } from 'axios';
import { normalizeSearch } from '@b2b/shared';

export const TOKEN_KEY = 'b2b.token';
export const ORG_KEY = 'b2b.orgId';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
  timeout: 30_000,
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

// Every request carries the bearer token and the selected tenant. List search terms are trimmed,
// collapsed and capped here so no page can send whitespace-only or oversized queries.
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
  return config;
});

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();
export function onUnauthorized(fn: UnauthorizedListener) {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

api.interceptors.response.use(
  (res) => res,
  (error: AxiosError) => {
    if (error.response?.status === 401) unauthorizedListeners.forEach((fn) => fn());
    return Promise.reject(error);
  },
);

export interface ApiErrorDetail {
  path: string;
  message: string;
}
export interface ApiError {
  status: number;
  code: string;
  message: string;
  /** Ordered field errors as sent by the API (path uses dot notation, e.g. "contacts.0.mobile"). */
  details: ApiErrorDetail[];
  /** The same errors keyed by path; first message wins. Mirrors the API `errors` object. */
  fieldErrors: Record<string, string>;
}

interface ApiErrorBody {
  success?: false;
  message?: string;
  error?: { code?: string; message?: string; details?: ApiErrorDetail[] };
  errors?: Record<string, string>;
}

function fieldErrorsFrom(details: ApiErrorDetail[], provided?: Record<string, string>): Record<string, string> {
  if (provided) return provided;
  const out: Record<string, string> = {};
  for (const d of details) if (d.path && !(d.path in out)) out[d.path] = d.message;
  return out;
}

/** Normalises axios / network / server errors into one shape the UI can render. */
export function toApiError(err: unknown): ApiError {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as ApiErrorBody | undefined;
    if (body?.error) {
      const details = body.error.details ?? [];
      return {
        status: err.response?.status ?? 0,
        code: body.error.code ?? 'ERROR',
        message: body.error.message ?? body.message ?? 'Something went wrong',
        details,
        fieldErrors: fieldErrorsFrom(details, body.errors),
      };
    }
    if (!err.response) {
      return { status: 0, code: 'NETWORK', message: 'Cannot reach the server. Check your connection and try again.', details: [], fieldErrors: {} };
    }
    return { status: err.response.status, code: 'HTTP_ERROR', message: err.message, details: [], fieldErrors: {} };
  }
  return { status: 0, code: 'UNKNOWN', message: err instanceof Error ? err.message : 'Something went wrong', details: [], fieldErrors: {} };
}
