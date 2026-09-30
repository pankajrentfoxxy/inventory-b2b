import type { RouteDef } from '../../router/types';
import { PurchaseOrderListPage } from './pages/PurchaseOrderListPage';
import { PurchaseOrderEditorPage } from './pages/PurchaseOrderEditorPage';
import { PurchaseOrderDetailPage } from './pages/PurchaseOrderDetailPage';
import { GrnListPage } from './pages/GrnListPage';
import { GrnCreatePage } from './pages/GrnCreatePage';
import { GrnDetailPage } from './pages/GrnDetailPage';
import { ProcurementSettingsPage } from './pages/ProcurementSettingsPage';

/** Procurement (svc-procurement): purchase orders, goods receipts and their settings. */
export const procurementRoutes: RouteDef[] = [
  { path: '/purchases/orders', permission: 'purchase.view', element: <PurchaseOrderListPage /> },
  { path: '/purchases/orders/new', permission: 'purchase.create', element: <PurchaseOrderEditorPage /> },
  { path: '/purchases/orders/:id/edit', permission: ['purchase.edit', 'purchase.create'], element: <PurchaseOrderEditorPage /> },
  { path: '/purchases/orders/:id', permission: 'purchase.view', element: <PurchaseOrderDetailPage /> },
  { path: '/purchases/receipts', permission: 'grn.view', element: <GrnListPage /> },
  { path: '/purchases/receipts/new', permission: 'grn.create', element: <GrnCreatePage /> },
  { path: '/purchases/receipts/:id', permission: 'grn.view', element: <GrnDetailPage /> },
  { path: '/settings/procurement', permission: 'purchase.view', element: <ProcurementSettingsPage /> },
];
