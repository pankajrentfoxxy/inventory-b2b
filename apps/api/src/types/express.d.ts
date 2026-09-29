import type { RequestContext, AuthPrincipal } from '../middleware/auth.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth: the verified JWT subject. */
      auth?: AuthPrincipal;
      /** Set by requireOrganization: tenant + membership + resolved permissions. */
      ctx?: RequestContext;
    }
  }
}

export {};
