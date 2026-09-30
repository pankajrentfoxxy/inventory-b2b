import type { ApiError } from '../../lib/api';

/**
 * Anti-escalation errors (IAM_ESCALATION_DENIED, IAM_PLATFORM_PERMISSION_IN_TENANT) carry the
 * offending codes as `details[].message`; surface them with the headline so the toast is actionable.
 */
export function describeApiError(e: ApiError): string {
  const codes = e.details.map((d) => d.message).filter(Boolean);
  if (codes.length === 0 || codes.length > 6) return e.message;
  return `${e.message}: ${codes.join(', ')}`;
}
