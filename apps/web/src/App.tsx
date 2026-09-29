import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './layout/AppLayout';
import { ProtectedRoute } from './router/ProtectedRoute';
import { LoginPage } from './features/auth/LoginPage';
import { RegisterPage } from './features/auth/RegisterPage';
import { VendorListPage } from './features/vendors/pages/VendorListPage';
import { VendorCreatePage } from './features/vendors/pages/VendorCreatePage';
import { VendorDetailPage } from './features/vendors/pages/VendorDetailPage';
import { VendorEditPage } from './features/vendors/pages/VendorEditPage';
import { ItemListPage } from './features/items/pages/ItemListPage';
import { PurchaseOrderListPage } from './features/purchase-orders/pages/PurchaseOrderListPage';
import { PurchaseOrderCreatePage } from './features/purchase-orders/pages/PurchaseOrderCreatePage';
import { PurchaseOrderDetailPage } from './features/purchase-orders/pages/PurchaseOrderDetailPage';
import { PurchaseOrderEditPage } from './features/purchase-orders/pages/PurchaseOrderEditPage';
import { PurchaseReceiveListPage } from './features/purchase-receives/pages/PurchaseReceiveListPage';
import { PurchaseReceiveCreatePage } from './features/purchase-receives/pages/PurchaseReceiveCreatePage';
import { PurchaseReceiveDetailPage } from './features/purchase-receives/pages/PurchaseReceiveDetailPage';
import { VendorFieldsSettingsPage } from './features/settings/VendorFieldsSettingsPage';
import { PurchaseSettingsPage } from './features/settings/PurchaseSettingsPage';
import { EmptyState } from './components/ui';
import { Compass } from 'lucide-react';

function Shell({ children, permission }: { children: React.ReactNode; permission?: Parameters<typeof ProtectedRoute>[0]['permission'] }) {
  return (
    <ProtectedRoute permission={permission}>
      <AppLayout>{children}</AppLayout>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/" element={<Navigate to="/purchases/purchase-orders" replace />} />
      <Route path="/purchases" element={<Navigate to="/purchases/purchase-orders" replace />} />

      <Route path="/items" element={<Shell permission="item.view"><ItemListPage /></Shell>} />

      <Route path="/purchases/vendors" element={<Shell permission="vendor.view"><VendorListPage /></Shell>} />
      <Route path="/purchases/vendors/new" element={<Shell permission="vendor.create"><VendorCreatePage /></Shell>} />
      <Route path="/purchases/vendors/:id" element={<Shell permission="vendor.view"><VendorDetailPage /></Shell>} />
      <Route path="/purchases/vendors/:id/edit" element={<Shell permission="vendor.edit"><VendorEditPage /></Shell>} />

      <Route path="/purchases/purchase-orders" element={<Shell permission="purchase_order.view"><PurchaseOrderListPage /></Shell>} />
      <Route path="/purchases/purchase-orders/new" element={<Shell permission="purchase_order.create"><PurchaseOrderCreatePage /></Shell>} />
      <Route path="/purchases/purchase-orders/:id" element={<Shell permission="purchase_order.view"><PurchaseOrderDetailPage /></Shell>} />
      <Route path="/purchases/purchase-orders/:id/edit" element={<Shell permission="purchase_order.edit"><PurchaseOrderEditPage /></Shell>} />

      <Route path="/purchases/purchase-receives" element={<Shell permission="purchase_receive.view"><PurchaseReceiveListPage /></Shell>} />
      <Route path="/purchases/purchase-receives/new" element={<Shell permission="purchase_receive.create"><PurchaseReceiveCreatePage /></Shell>} />
      <Route path="/purchases/purchase-receives/:id" element={<Shell permission="purchase_receive.view"><PurchaseReceiveDetailPage /></Shell>} />

      <Route path="/settings" element={<Navigate to="/settings/purchases" replace />} />
      <Route path="/settings/vendor-fields" element={<Shell permission={['settings.view', 'settings.manage']}><VendorFieldsSettingsPage /></Shell>} />
      <Route path="/settings/purchases" element={<Shell permission={['settings.view', 'settings.manage']}><PurchaseSettingsPage /></Shell>} />
      <Route path="*" element={<Shell><EmptyState icon={Compass} title="Page not found" hint="The page you are looking for does not exist." /></Shell>} />
    </Routes>
  );
}
