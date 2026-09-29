import type { ReactNode } from 'react';
import type { PermissionCode } from '@b2b/shared';
import { useAuth } from '../lib/auth';

/** Renders children only when the current member holds one of the permissions. */
export function PermissionGate({ permission, children, fallback = null }: { permission: PermissionCode | PermissionCode[]; children: ReactNode; fallback?: ReactNode }) {
  const { hasPermission } = useAuth();
  return <>{hasPermission(permission) ? children : fallback}</>;
}
