import type { RouteDef } from '../../router/types';
import { MembersPage } from './pages/MembersPage';
import { RolesPage } from './pages/RolesPage';
import { AuditTrailPage } from './pages/AuditTrailPage';

/** Tenant settings: members & invitations, roles & permissions, audit trail (Phase 2 IAM). */
export const iamRoutes: RouteDef[] = [
  { path: '/settings/members', permission: 'iam.member.view', element: <MembersPage /> },
  { path: '/settings/roles', permission: 'iam.role.view', element: <RolesPage /> },
  { path: '/settings/audit', permission: 'audit.view', element: <AuditTrailPage /> },
];
