import { MESSAGES } from '@b2b/shared';

export interface ErrorDetail {
  path: string;
  message: string;
}

/**
 * Wire format for every non-2xx response. `error.details` is the ordered list the UI maps onto
 * form fields; `errors` is the same data keyed by path for clients that prefer a lookup table.
 */
export interface ErrorResponseBody {
  success: false;
  message: string;
  error: { code: string; message: string; details?: ErrorDetail[] };
  errors?: Record<string, string>;
}

/** Operational error that maps straight to an HTTP response. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ErrorDetail[];

  constructor(status: number, code: string, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
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

export function errorBody(code: string, message: string, details?: ErrorDetail[]): ErrorResponseBody {
  const body: ErrorResponseBody = { success: false, message, error: { code, message } };
  if (details && details.length) {
    body.error.details = details;
    body.errors = toFieldErrors(details);
  }
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
