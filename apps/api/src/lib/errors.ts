import { MESSAGES } from '@b2b/shared';

export interface ErrorDetail {
  path: string;
  message: string;
}

/** Request-scoped extras added by the error handler (phase-plan/README.md 5.5). */
export interface ErrorMeta {
  correlationId?: string;
  retryable?: boolean;
}

/**
 * Wire format for every non-2xx response. `error.details` is the ordered list the UI maps onto
 * form fields; `errors` is the same data keyed by path for clients that prefer a lookup table.
 * `error.correlationId` lets support match a toast to the gateway / API logs; `error.retryable`
 * tells clients whether repeating the same request (same Idempotency-Key) can succeed.
 */
export interface ErrorResponseBody {
  success: false;
  message: string;
  error: { code: string; message: string; details?: ErrorDetail[]; correlationId?: string; retryable?: boolean };
  errors?: Record<string, string>;
}

/** Operational error that maps straight to an HTTP response. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ErrorDetail[];
  readonly retryable: boolean;

  constructor(status: number, code: string, message: string, details?: ErrorDetail[], retryable = false) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }
}

/** First message per path, e.g. { mobile: "Mobile number must contain exactly 10 digits" }. */
export function toFieldErrors(details: ErrorDetail[] | undefined): Record<string, string> | undefined {
  if (!details || details.length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const d of details) {
    const key = d.path || '_form';
    if (!(key in out)) out[key] = d.message;
  }
  return out;
}

export function errorBody(code: string, message: string, details?: ErrorDetail[], meta: ErrorMeta = {}): ErrorResponseBody {
  const body: ErrorResponseBody = { success: false, message, error: { code, message } };
  if (details && details.length) {
    body.error.details = details;
    body.errors = toFieldErrors(details);
  }
  if (meta.correlationId) body.error.correlationId = meta.correlationId;
  if (meta.retryable !== undefined) body.error.retryable = meta.retryable;
  return body;
}

export const badRequest = (message: string, code = 'BAD_REQUEST', details?: ErrorDetail[]) =>
  new HttpError(400, code, message, details);
export const unauthorized = (message = 'Authentication required', code = 'UNAUTHORIZED') =>
  new HttpError(401, code, message);
export const forbidden = (message = 'You do not have permission to do this', code = 'FORBIDDEN') =>
  new HttpError(403, code, message);
export const notFound = (message = 'Resource not found', code = 'NOT_FOUND') =>
  new HttpError(404, code, message);
export const conflict = (message: string, code = 'CONFLICT', details?: ErrorDetail[]) =>
  new HttpError(409, code, message, details);
export const payloadTooLarge = (message: string, code = 'PAYLOAD_TOO_LARGE', details?: ErrorDetail[]) =>
  new HttpError(413, code, message, details);
export const validationError = (details: ErrorDetail[], message: string = MESSAGES.fixHighlighted) =>
  new HttpError(422, 'VALIDATION_ERROR', message, details);
/** Business rule violation with its own code (e.g. OVER_RECEIPT). Same 422 status as validation. */
export const businessRuleError = (code: string, message: string, details?: ErrorDetail[]) =>
  new HttpError(422, code, message, details);
export const serviceUnavailable = (message = 'A dependency is unavailable. Please retry.', code = 'DEPENDENCY_UNAVAILABLE') =>
  new HttpError(503, code, message, undefined, true);
