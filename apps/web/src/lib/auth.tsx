/**
 * Session state for the web app (Phase 1 + 2 UI). Signs in against svc-auth (`/api/v1/auth`):
 * credentials -> optional MFA -> optional tenant selection -> access token. Permissions come from
 * the token's `perms` claim (new codes such as `purchase.view`); legacy pages keep asking for legacy
 * codes (`purchase_order.view`) which are mapped through LEGACY_PERMISSION_MAP. The refresh token
 * is an httpOnly cookie handled by the api client.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LEGACY_PERMISSION_MAP } from '@b2b/contracts';
import { api, onTokenRefreshed, onUnauthorized, refreshAccessToken, storage, unwrap } from './api';
import { decodeJwt, isExpired, type AccessClaims } from './jwt';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}
export interface TenantSummary {
  id: string;
  name: string;
  roleKeys: string[];
}
/** Kept for the legacy pages that still read `currentOrg`. */
export interface OrgSummary {
  id: string;
  name: string;
  role: { code: string; name: string };
}

export type Portal = 'app' | 'admin';

export type PendingStep =
  | { kind: 'mfa'; mfaToken: string; enrolmentRequired: boolean; otpauthUrl: string | null; portal: Portal }
  | { kind: 'select'; selectionToken: string; tenants: TenantSummary[] };

interface Session {
  tokenType: 'tenant' | 'platform';
  user: AuthUser;
  tenant: { id: string; name: string } | null;
  membershipId: string | null;
  permissions: Set<string>;
  permissionVersion: number | null;
  /** null = every warehouse. */
  warehouseIds: string[] | null;
}

interface AuthState {
  status: 'loading' | 'anonymous' | 'authenticated';
  session: Session | null;
  pending: PendingStep | null;
  tenants: TenantSummary[];
}

interface TokensPayload {
  kind: 'tokens';
  tokenType: 'tenant' | 'platform';
  accessToken: string;
  expiresIn: number;
  tenant: { id: string; name: string | null } | null;
}
type LoginPayload = TokensPayload | { kind: 'mfa'; mfaToken: string; enrolmentRequired: boolean; otpauthUrl?: string } | { kind: 'select'; selectionToken: string; tenants: { id: string; name: string | null; roleKeys: string[] }[] };

export interface AuthContextValue extends AuthState {
  /** Convenience for existing pages. */
  user: AuthUser | null;
  tokenType: 'tenant' | 'platform' | null;
  currentOrg: OrgSummary | null;
  organizations: OrgSummary[];
  permissions: Set<string>;
  warehouseIds: string[] | null;
  orgLoading: boolean;
  login: (email: string, password: string, portal?: Portal) => Promise<PendingStep['kind'] | 'done'>;
  verifyMfa: (code: string) => Promise<PendingStep['kind'] | 'done'>;
  selectTenant: (tenantId: string) => Promise<void>;
  switchOrganization: (tenantId: string) => Promise<void>;
  cancelPending: () => void;
  logout: () => Promise<void>;
  hasPermission: (code: string | readonly string[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function sessionFromToken(token: string, tenantName: string | null = null): Session | null {
  const c: AccessClaims | null = decodeJwt(token);
  if (!c || (c.typ !== 'tenant' && c.typ !== 'platform')) return null;
  return {
    tokenType: c.typ,
    user: { id: c.sub, name: c.name ?? c.email ?? 'User', email: c.email ?? '' },
    tenant: c.tid ? { id: c.tid, name: tenantName ?? '' } : null,
    membershipId: c.mid ?? null,
    permissions: new Set(c.perms ?? []),
    permissionVersion: c.pv ?? null,
    warehouseIds: c.wh ?? null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: 'loading', session: null, pending: null, tenants: [] });

  const clearSession = useCallback(() => {
    storage.token = null;
    storage.orgId = null;
    queryClient.clear();
    setState({ status: 'anonymous', session: null, pending: null, tenants: [] });
  }, [queryClient]);

  const loadTenants = useCallback(async (session: Session): Promise<TenantSummary[]> => {
    if (session.tokenType !== 'tenant') return [];
    try {
      const rows = await api.get<{ data: { id: string; name: string | null; roleKeys: string[] }[] }>('/v1/auth/me/tenants').then(unwrap);
      return rows.map((t) => ({ id: t.id, name: t.name ?? 'Organisation', roleKeys: t.roleKeys }));
    } catch {
      return session.tenant ? [{ id: session.tenant.id, name: session.tenant.name, roleKeys: [] }] : [];
    }
  }, []);

  const applyTokens = useCallback(
    async (payload: TokensPayload, switching = false) => {
      const session = sessionFromToken(payload.accessToken, payload.tenant?.name ?? null);
      if (!session) throw new Error('Unexpected token');
      storage.token = payload.accessToken;
      storage.orgId = session.tenant?.id ?? null;
      if (switching) await queryClient.resetQueries();
      const tenants = await loadTenants(session);
      const named = session.tenant ? { ...session, tenant: { id: session.tenant.id, name: tenants.find((t) => t.id === session.tenant!.id)?.name ?? session.tenant.name } } : session;
      setState({ status: 'authenticated', session: named, pending: null, tenants });
    },
    [loadTenants, queryClient],
  );

  // Boot: reuse a stored token (refreshing it when expired) or stay anonymous.
  useEffect(() => {
    (async () => {
      let token = storage.token;
      if (!token) {
        setState((s) => ({ ...s, status: 'anonymous' }));
        return;
      }
      if (isExpired(decodeJwt(token))) token = await refreshAccessToken();
      if (!token) {
        clearSession();
        return;
      }
      const session = sessionFromToken(token);
      if (!session) {
        clearSession();
        return;
      }
      const tenants = await loadTenants(session);
      const named = session.tenant ? { ...session, tenant: { id: session.tenant.id, name: tenants.find((t) => t.id === session.tenant!.id)?.name ?? '' } } : session;
      setState({ status: 'authenticated', session: named, pending: null, tenants });
    })();
  }, [clearSession, loadTenants]);

  useEffect(() => {
    const off = onUnauthorized(() => clearSession());
    return () => {
      off();
    };
  }, [clearSession]);
  useEffect(() => {
    const off = onTokenRefreshed((token) => {
      const fresh = sessionFromToken(token);
      if (fresh) setState((s) => (s.session ? { ...s, session: { ...fresh, tenant: fresh.tenant ? { id: fresh.tenant.id, name: s.session.tenant?.name ?? '' } : null } } : s));
    });
    return () => {
      off();
    };
  }, []);

  const handleLogin = useCallback(
    async (payload: LoginPayload, portal: Portal): Promise<PendingStep['kind'] | 'done'> => {
      if (payload.kind === 'tokens') {
        await applyTokens(payload);
        return 'done';
      }
      if (payload.kind === 'mfa') {
        setState((s) => ({ ...s, pending: { kind: 'mfa', mfaToken: payload.mfaToken, enrolmentRequired: payload.enrolmentRequired, otpauthUrl: payload.otpauthUrl ?? null, portal } }));
        return 'mfa';
      }
      setState((s) => ({ ...s, pending: { kind: 'select', selectionToken: payload.selectionToken, tenants: payload.tenants.map((t) => ({ id: t.id, name: t.name ?? 'Organisation', roleKeys: t.roleKeys })) } }));
      return 'select';
    },
    [applyTokens],
  );

  const value = useMemo<AuthContextValue>(() => {
    const session = state.session;
    const hasPermission = (code: string | readonly string[]) => {
      if (!session) return false;
      const codes = Array.isArray(code) ? (code as readonly string[]) : [code as string];
      return codes.some((c) => {
        if (session.permissions.has(c)) return true;
        const mapped = LEGACY_PERMISSION_MAP[c];
        return mapped ? mapped.some((m) => session.permissions.has(m)) : false;
      });
    };
    const currentOrg: OrgSummary | null = session?.tenant ? { id: session.tenant.id, name: session.tenant.name, role: { code: state.tenants.find((t) => t.id === session.tenant!.id)?.roleKeys[0] ?? '', name: state.tenants.find((t) => t.id === session.tenant!.id)?.roleKeys.join(', ') ?? '' } } : null;
    return {
      ...state,
      user: session?.user ?? null,
      tokenType: session?.tokenType ?? null,
      currentOrg,
      organizations: state.tenants.map((t) => ({ id: t.id, name: t.name, role: { code: t.roleKeys[0] ?? '', name: t.roleKeys.join(', ') } })),
      permissions: session?.permissions ?? new Set<string>(),
      warehouseIds: session?.warehouseIds ?? null,
      orgLoading: false,
      login: async (email, password, portal = 'app') => {
        const res = await api.post<{ data: LoginPayload }>('/v1/auth/login', { email, password, portal }).then(unwrap);
        return handleLogin(res, portal);
      },
      verifyMfa: async (code) => {
        if (state.pending?.kind !== 'mfa') throw new Error('No MFA challenge in progress');
        const res = await api.post<{ data: LoginPayload }>('/v1/auth/mfa/verify', { mfaToken: state.pending.mfaToken, code }).then(unwrap);
        return handleLogin(res, state.pending.portal);
      },
      selectTenant: async (tenantId) => {
        const selectionToken = state.pending?.kind === 'select' ? state.pending.selectionToken : storage.token;
        if (!selectionToken) throw new Error('No session');
        const res = await api.post<{ data: LoginPayload }>('/v1/auth/select-tenant', { selectionToken, tenantId }).then(unwrap);
        if (res.kind !== 'tokens') throw new Error('Unexpected response');
        await applyTokens(res, Boolean(state.session));
      },
      switchOrganization: async (tenantId) => {
        const res = await api.post<{ data: LoginPayload }>('/v1/auth/select-tenant', { selectionToken: storage.token, tenantId }).then(unwrap);
        if (res.kind !== 'tokens') throw new Error('Unexpected response');
        await applyTokens(res, true);
      },
      cancelPending: () => setState((s) => ({ ...s, pending: null })),
      logout: async () => {
        try {
          await api.post('/v1/auth/logout');
        } catch {
          /* the local session is cleared regardless */
        }
        clearSession();
      },
      hasPermission,
    };
  }, [state, applyTokens, clearSession, handleLogin]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/**
 * UI affordance gate. The API enforces the same permissions server-side. Legacy booleans stay for
 * the legacy pages; new pages call `hasPermission('purchase.approve')` directly.
 */
export function usePermission() {
  const { hasPermission, permissions } = useAuth();
  return {
    hasPermission,
    permissions,
    canViewVendors: hasPermission('vendor.view'),
    canCreateVendor: hasPermission('vendor.create'),
    canEditVendor: hasPermission('vendor.edit'),
    canDeleteVendor: hasPermission('vendor.delete'),
    canChangeVendorStatus: hasPermission('vendor.status_update'),
    canViewBankDetails: hasPermission('vendor.bank_details_view'),
    canManageSettings: hasPermission('settings.manage'),
    canViewItems: hasPermission('item.view'),
    canCreateItem: hasPermission('item.create'),
    canEditItem: hasPermission('item.edit'),
    canDeleteItem: hasPermission('item.delete'),
    canViewPurchaseOrders: hasPermission('purchase_order.view'),
    canCreatePurchaseOrder: hasPermission('purchase_order.create'),
    canEditPurchaseOrder: hasPermission('purchase_order.edit'),
    canIssuePurchaseOrder: hasPermission('purchase_order.issue'),
    canCancelPurchaseOrder: hasPermission('purchase_order.cancel'),
    canDeletePurchaseOrder: hasPermission('purchase_order.delete'),
    canViewReceives: hasPermission('purchase_receive.view'),
    canCreateReceive: hasPermission('purchase_receive.create'),
    canCancelReceive: hasPermission('purchase_receive.cancel'),
  };
}
