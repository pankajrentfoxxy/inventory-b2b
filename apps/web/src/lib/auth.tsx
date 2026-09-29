import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PermissionCode } from '@b2b/shared';
import { api, onUnauthorized, storage } from './api';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}
export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  baseCurrency: string;
  countryCode: string;
  role: { id: string; code: string; name: string };
  isOwner: boolean;
}
interface OrgContext {
  organization: { id: string; name: string };
  role: { id: string; code: string };
  isOwner: boolean;
  permissions: string[];
}

interface AuthState {
  status: 'loading' | 'anonymous' | 'authenticated';
  user: AuthUser | null;
  organizations: OrgSummary[];
  currentOrg: OrgSummary | null;
  permissions: Set<string>;
  orgLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (input: { name: string; email: string; password: string; organizationName: string }) => Promise<void>;
  logout: () => void;
  switchOrganization: (orgId: string) => Promise<void>;
  hasPermission: (code: PermissionCode | PermissionCode[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface SessionPayload {
  token: string;
  user: AuthUser;
  organizations: OrgSummary[];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    user: null,
    organizations: [],
    currentOrg: null,
    permissions: new Set(),
    orgLoading: false,
  });

  const clearSession = useCallback(() => {
    storage.token = null;
    storage.orgId = null;
    activeOrgRef.current = null;
    queryClient.clear();
    setState({ status: 'anonymous', user: null, organizations: [], currentOrg: null, permissions: new Set(), orgLoading: false });
  }, [queryClient]);

  const activeOrgRef = useRef<string | null>(null);

  /** Loads role + permissions for an organization and makes it current. */
  const activateOrganization = useCallback(
    async (orgs: OrgSummary[], preferredId: string | null) => {
      const target = orgs.find((o) => o.id === preferredId) ?? orgs[0] ?? null;
      if (!target) {
        setState((s) => ({ ...s, currentOrg: null, permissions: new Set(), orgLoading: false }));
        return;
      }
      // Only a real tenant switch drops cached data. The initial load (which StrictMode runs
      // twice in development) must not clear queries that pages have already started.
      const switching = activeOrgRef.current !== null && activeOrgRef.current !== target.id;
      activeOrgRef.current = target.id;
      storage.orgId = target.id;
      setState((s) => ({ ...s, orgLoading: true }));
      const res = await api.get<OrgContext>('/organizations/current');
      if (switching) await queryClient.resetQueries();
      setState((s) => ({ ...s, currentOrg: target, permissions: new Set(res.data.permissions), orgLoading: false }));
    },
    [queryClient],
  );

  const applySession = useCallback(
    async (payload: SessionPayload) => {
      storage.token = payload.token;
      setState((s) => ({ ...s, status: 'authenticated', user: payload.user, organizations: payload.organizations }));
      await activateOrganization(payload.organizations, storage.orgId);
    },
    [activateOrganization],
  );

  useEffect(() => {
    const token = storage.token;
    if (!token) {
      setState((s) => ({ ...s, status: 'anonymous' }));
      return;
    }
    (async () => {
      try {
        const me = await api.get<{ user: AuthUser; organizations: OrgSummary[] }>('/auth/me');
        setState((s) => ({ ...s, status: 'authenticated', user: me.data.user, organizations: me.data.organizations }));
        await activateOrganization(me.data.organizations, storage.orgId);
      } catch {
        clearSession();
      }
    })();
  }, [activateOrganization, clearSession]);

  useEffect(() => {
    const off = onUnauthorized(() => clearSession());
    return () => {
      off();
    };
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login: async (email, password) => {
        const res = await api.post<SessionPayload>('/auth/login', { email, password });
        await applySession(res.data);
      },
      register: async (input) => {
        const res = await api.post<SessionPayload>('/auth/register', input);
        storage.orgId = null;
        await applySession(res.data);
      },
      logout: clearSession,
      switchOrganization: (orgId) => activateOrganization(state.organizations, orgId),
      hasPermission: (code) => {
        const codes = Array.isArray(code) ? code : [code];
        return codes.some((c) => state.permissions.has(c));
      },
    }),
    [state, applySession, clearSession, activateOrganization],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** UI affordance gate. The API enforces the same permissions server-side. */
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
