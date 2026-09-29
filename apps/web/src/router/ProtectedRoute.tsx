import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ShieldOff, Loader2 } from 'lucide-react';
import type { PermissionCode } from '@b2b/shared';
import { useAuth } from '../lib/auth';
import { EmptyState } from '../components/ui';

export function FullPageSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center text-slate-500">
      <Loader2 className="w-6 h-6 animate-spin mr-2" /> {label}
    </div>
  );
}

export function ProtectedRoute({ permission, children }: { permission?: PermissionCode | PermissionCode[]; children: ReactNode }) {
  const { status, orgLoading, currentOrg, hasPermission } = useAuth();
  const location = useLocation();

  if (status === 'loading' || (status === 'authenticated' && orgLoading)) return <FullPageSpinner />;
  if (status === 'anonymous') return <Navigate to="/login" state={{ from: location }} replace />;
  if (!currentOrg) {
    return <EmptyState icon={ShieldOff} title="No organization" hint="Your account is not a member of any organization yet." />;
  }
  if (permission && !hasPermission(permission)) {
    return (
      <EmptyState
        icon={ShieldOff}
        title="You do not have access to this page"
        hint="Ask an administrator of your organization to grant you the required permission."
      />
    );
  }
  return <>{children}</>;
}
