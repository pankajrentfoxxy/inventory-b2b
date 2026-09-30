/**
 * Error envelope shared by every service (phase-plan/README.md 5.5). It is a superset of the legacy
 * API's envelope so today's web client keeps working:
 *   { success:false, message, error:{ code, message, details?, correlationId, retryable }, errors? }
 */
export interface ErrorDetail {
  path: string;
  message: string;
}

export interface ErrorMeta {
  correlationId?: string;
  retryable?: boolean;
}

export interface ErrorResponseBody {
  success: false;
  message: string;
  error: { code: string; message: string; details?: ErrorDetail[]; correlationId?: string; retryable?: boolean };
  errors?: Record<string, string>;
}

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

export const badRequest = (message: string, code = 'BAD_REQUEST', details?: ErrorDetail[]) => new HttpError(400, code, message, details);
export const unauthorized = (message = 'Authentication required', code = 'UNAUTHENTICATED') => new HttpError(401, code, message);
export const forbidden = (message = 'You do not have permission to do this', code = 'FORBIDDEN', details?: ErrorDetail[]) =>
  new HttpError(403, code, message, details);
export const notFound = (message = 'Resource not found', code = 'NOT_FOUND') => new HttpError(404, code, message);
export const conflict = (message: string, code = 'CONFLICT', details?: ErrorDetail[]) => new HttpError(409, code, message, details);
export const gone = (message: string, code = 'GONE') => new HttpError(410, code, message);
export const payloadTooLarge = (message: string, code = 'PAYLOAD_TOO_LARGE') => new HttpError(413, code, message);
export const validationError = (details: ErrorDetail[], message = 'Please fix the highlighted fields') =>
  new HttpError(422, 'VALIDATION_FAILED', message, details);
/** Business rule violation with its own code (README 5.5: 422). */
export const businessRuleError = (code: string, message: string, details?: ErrorDetail[]) => new HttpError(422, code, message, details);
export const tooManyRequests = (message = 'Too many requests. Please slow down.', code = 'RATE_LIMITED') =>
  new HttpError(429, code, message, undefined, true);
export const serviceUnavailable = (message = 'A dependency is unavailable. Please retry.', code = 'DEPENDENCY_UNAVAILABLE') =>
  new HttpError(503, code, message, undefined, true);
