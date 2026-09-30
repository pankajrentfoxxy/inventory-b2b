import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth';

/** Renders children only when the current member holds one of the permissions. */
export function PermissionGate({ permission, children, fallback = null }: { permission: string | readonly string[]; children: ReactNode; fallback?: ReactNode }) {
  const { hasPermission } = useAuth();
  return <>{hasPermission(permission) ? children : fallback}</>;
}
