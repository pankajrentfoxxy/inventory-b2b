import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ShieldOff, Loader2 } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { EmptyState } from '../components/ui';

export function FullPageSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center text-slate-500">
      <Loader2 className="w-6 h-6 animate-spin mr-2" /> {label}
    </div>
  );
}

export type Area = 'tenant' | 'platform';

/**
 * Guards a page: signed in, right portal (tenant app vs platform console) and, when given, one of
 * the permissions. Legacy permission codes are accepted (mapped inside hasPermission).
 */
export function ProtectedRoute({ permission, area = 'tenant', children }: { permission?: string | readonly string[]; area?: Area; children: ReactNode }) {
  const { status, session, hasPermission } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'anonymous' || !session) return <Navigate to={area === 'platform' ? '/admin/login' : '/login'} state={{ from: location }} replace />;
  if (area === 'tenant' && session.tokenType !== 'tenant') return <Navigate to="/admin" replace />;
  if (area === 'platform' && session.tokenType !== 'platform') return <Navigate to="/" replace />;
  if (area === 'tenant' && !session.tenant) {
    return <EmptyState icon={ShieldOff} title="No organisation" hint="Your account is not a member of any active organisation yet." />;
  }
  if (permission && !hasPermission(permission)) {
    return (
      <EmptyState
        icon={ShieldOff}
        title="You do not have access to this page"
        hint="Ask an administrator of your organisation to grant you the required permission."
      />
    );
  }
  return <>{children}</>;
}
