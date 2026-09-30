import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { AppLayout } from './layout/AppLayout';
import { ProtectedRoute, type Area } from './router/ProtectedRoute';
import type { RouteDef } from './router/types';
import { EmptyState } from './components/ui';
import { LoginPage } from './features/auth/LoginPage';
import { AcceptInvitationPage, ForgotPasswordPage, ResetPasswordPage } from './features/auth/PasswordPages';
import { ApplyPage } from './features/auth/ApplyPage';
import { HomePage } from './features/home/HomePage';
import { iamRoutes } from './features/iam/routes';
import { platformRoutes } from './features/platform/routes';
import { masterRoutes } from './features/master/routes';
import { partiesRoutes } from './features/parties/routes';
import { inventoryRoutes } from './features/inventory/routes';
import { procurementRoutes } from './features/procurement/routes';
import { qcRoutes } from './features/qc/routes';
import { legacyRoutes } from './features/legacy.routes';

function Shell({ children, permission, area = 'tenant' }: { children: React.ReactNode; permission?: string | readonly string[]; area?: Area }) {
  return (
    <ProtectedRoute permission={permission} area={area}>
      <AppLayout variant={area}>{children}</AppLayout>
    </ProtectedRoute>
  );
}

const tenantRoutes: RouteDef[] = [...masterRoutes, ...partiesRoutes, ...inventoryRoutes, ...procurementRoutes, ...qcRoutes, ...iamRoutes, ...legacyRoutes];

function SupplierRedirect() {
  const { pathname, search } = useLocation();
  return <Navigate to={pathname.replace('/parties/suppliers', '/parties/vendors') + search} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/admin/login" element={<LoginPage portal="admin" />} />
      <Route path="/register" element={<Navigate to="/apply" replace />} />
      <Route path="/apply" element={<ApplyPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      {/* svc-notification links: owner invites (tenant activation) -> /accept-invite, member invites (IAM) -> /accept-invitation */}
      <Route path="/accept-invite" element={<AcceptInvitationPage defaultKind="owner" />} />
      <Route path="/accept-invitation" element={<AcceptInvitationPage defaultKind="member" />} />

      <Route path="/" element={<Shell><HomePage /></Shell>} />
      <Route path="/purchases" element={<Navigate to="/purchases/orders" replace />} />
      <Route path="/settings" element={<Navigate to="/settings/members" replace />} />
      <Route path="/masters" element={<Navigate to="/masters/products" replace />} />
      <Route path="/parties" element={<Navigate to="/parties/vendors" replace />} />
      {/* Suppliers were renamed to vendors: keep old links working */}
      <Route path="/parties/suppliers/*" element={<SupplierRedirect />} />
      <Route path="/inventory" element={<Navigate to="/inventory/stock" replace />} />
      <Route path="/qc" element={<Navigate to="/qc/lots" replace />} />
      {tenantRoutes.map((r) => (
        <Route key={r.path} path={r.path} element={<Shell permission={r.permission}>{r.element}</Shell>} />
      ))}

      {platformRoutes.map((r) => (
        <Route key={r.path} path={r.path} element={<Shell permission={r.permission} area="platform">{r.element}</Shell>} />
      ))}

      <Route path="*" element={<Shell><EmptyState icon={Compass} title="Page not found" hint="The page you are looking for does not exist." /></Shell>} />
    </Routes>
  );
}
