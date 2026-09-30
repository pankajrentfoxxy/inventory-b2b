/**
 * Config-driven routing table (phase-00 step 3, phase-01 step 8.3). Later phases flip one row at a
 * time. `access` says who may call the prefix: public (no token), tenant (tenant tokens), platform
 * (platform tokens), any (both token types; the upstream decides).
 */
export type TargetName = 'legacy-api' | 'svc-auth' | 'svc-tenant' | 'svc-audit' | 'svc-iam' | 'svc-master' | 'svc-party' | 'svc-inventory' | 'svc-procurement' | 'svc-qc';
export type Access = 'public' | 'tenant' | 'platform' | 'any';

export interface RouteRule {
  prefix: string;
  target: TargetName | null;
  enabled: boolean;
  access: Access;
  /** Rewrites the incoming path for the upstream (legacy has no /v1 segment). */
  rewrite?: (path: string) => string;
  /** Answer this status instead of proxying (e.g. 410 for retired routes). */
  gone?: string;
  note?: string;
}

const stripV1 = (p: string) => p.replace(/^\/api\/v1(?=\/|$)/, '/api');

export const ROUTES: RouteRule[] = [
  { prefix: '/.well-known/jwks.json', target: 'svc-auth', enabled: true, access: 'public' },
  { prefix: '/api/v1/auth', target: 'svc-auth', enabled: true, access: 'public', note: 'svc-auth applies its own checks (refresh cookie, mfa/select tokens)' },
  { prefix: '/api/v1/public', target: 'svc-tenant', enabled: true, access: 'public', note: 'vendor applications' },
  { prefix: '/api/v1/platform/iam', target: 'svc-iam', enabled: true, access: 'platform' },
  { prefix: '/api/v1/platform', target: 'svc-tenant', enabled: true, access: 'platform' },
  { prefix: '/api/v1/audit', target: 'svc-audit', enabled: true, access: 'tenant' },
  { prefix: '/api/v1/iam/invitations/accept', target: 'svc-iam', enabled: true, access: 'public', note: 'invitee has no token yet' },
  { prefix: '/api/v1/iam', target: 'svc-iam', enabled: true, access: 'tenant' },
  { prefix: '/api/v1/master', target: 'svc-master', enabled: true, access: 'tenant' },
  { prefix: '/api/v1/party', target: 'svc-party', enabled: true, access: 'tenant' },
  { prefix: '/api/v1/inventory', target: 'svc-inventory', enabled: true, access: 'tenant' },
  { prefix: '/api/v1/procurement', target: 'svc-procurement', enabled: true, access: 'tenant' },
  { prefix: '/api/v1/qc', target: 'svc-qc', enabled: true, access: 'tenant' },
  { prefix: '/api/v1', target: 'legacy-api', enabled: true, access: 'tenant', rewrite: stripV1, note: 'legacy business API' },
  { prefix: '/api/auth/register', target: null, enabled: true, access: 'public', gone: 'Self-registration is closed. Apply at /api/v1/public/vendor-applications.', note: 'Phase 1 step 9' },
  { prefix: '/api/auth', target: 'legacy-api', enabled: true, access: 'public', note: 'legacy login/me during the overlap window' },
  { prefix: '/api/public/gst', target: 'legacy-api', enabled: true, access: 'public', note: 'GSTIN prefill on the public application form; rate limited by the legacy API' },
  { prefix: '/api', target: 'legacy-api', enabled: true, access: 'tenant', note: 'legacy paths used by web-app until it moves to /api/v1' },
];

/** Identity is never taken from client headers (README 5.1 rule 1). */
export const STRIPPED_HEADERS = ['x-tenant-id', 'x-user-id', 'x-perms', 'x-membership-id', 'x-on-behalf-of-tenant'] as const;

export function matchRoute(pathname: string, routes: RouteRule[] = ROUTES): RouteRule | null {
  for (const rule of routes) {
    if (pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`)) return rule;
  }
  return null;
}
