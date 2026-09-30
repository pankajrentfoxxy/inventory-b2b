import type { RouteDef } from '../../router/types';
import { DashboardPage } from './pages/DashboardPage';
import { TenantListPage } from './pages/TenantListPage';
import { TenantCreatePage } from './pages/TenantCreatePage';
import { TenantDetailPage } from './pages/TenantDetailPage';
import { StaffPage } from './pages/StaffPage';
import { PlatformAuditPage } from './pages/PlatformAuditPage';

/** Platform console (Phase 1 tenants + Phase 2 platform IAM). Mounted with area="platform" in App.tsx. */
export const platformRoutes: RouteDef[] = [
  { path: '/admin', permission: 'platform.dashboard.view', element: <DashboardPage /> },
  { path: '/admin/tenants', permission: 'platform.tenant.view', element: <TenantListPage /> },
  { path: '/admin/tenants/new', permission: 'platform.tenant.create', element: <TenantCreatePage /> },
  { path: '/admin/tenants/:id', permission: 'platform.tenant.view', element: <TenantDetailPage /> },
  { path: '/admin/staff', permission: 'platform.iam.manage', element: <StaffPage /> },
  { path: '/admin/audit', permission: 'platform.audit.view', element: <PlatformAuditPage /> },
];
