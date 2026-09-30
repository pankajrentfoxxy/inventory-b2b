import type { RouteDef } from '../router/types';
import { VendorListPage } from './vendors/pages/VendorListPage';
import { VendorCreatePage } from './vendors/pages/VendorCreatePage';
import { VendorDetailPage } from './vendors/pages/VendorDetailPage';
import { VendorEditPage } from './vendors/pages/VendorEditPage';
import { ItemListPage } from './items/pages/ItemListPage';
import { PurchaseOrderListPage } from './purchase-orders/pages/PurchaseOrderListPage';
import { PurchaseOrderCreatePage } from './purchase-orders/pages/PurchaseOrderCreatePage';
import { PurchaseOrderDetailPage } from './purchase-orders/pages/PurchaseOrderDetailPage';
import { PurchaseOrderEditPage } from './purchase-orders/pages/PurchaseOrderEditPage';
import { PurchaseReceiveListPage } from './purchase-receives/pages/PurchaseReceiveListPage';
import { PurchaseReceiveCreatePage } from './purchase-receives/pages/PurchaseReceiveCreatePage';
import { PurchaseReceiveDetailPage } from './purchase-receives/pages/PurchaseReceiveDetailPage';
import { VendorFieldsSettingsPage } from './settings/VendorFieldsSettingsPage';
import { PurchaseSettingsPage } from './settings/PurchaseSettingsPage';

/** Legacy API pages (vendors, items, POs, receives). They stay until the cut-over; permissions are legacy codes. */
export const legacyRoutes: RouteDef[] = [
  { path: '/items', permission: 'item.view', element: <ItemListPage /> },
  { path: '/purchases/vendors', permission: 'vendor.view', element: <VendorListPage /> },
  { path: '/purchases/vendors/new', permission: 'vendor.create', element: <VendorCreatePage /> },
  { path: '/purchases/vendors/:id', permission: 'vendor.view', element: <VendorDetailPage /> },
  { path: '/purchases/vendors/:id/edit', permission: 'vendor.edit', element: <VendorEditPage /> },
  { path: '/purchases/purchase-orders', permission: 'purchase_order.view', element: <PurchaseOrderListPage /> },
  { path: '/purchases/purchase-orders/new', permission: 'purchase_order.create', element: <PurchaseOrderCreatePage /> },
  { path: '/purchases/purchase-orders/:id', permission: 'purchase_order.view', element: <PurchaseOrderDetailPage /> },
  { path: '/purchases/purchase-orders/:id/edit', permission: 'purchase_order.edit', element: <PurchaseOrderEditPage /> },
  { path: '/purchases/purchase-receives', permission: 'purchase_receive.view', element: <PurchaseReceiveListPage /> },
  { path: '/purchases/purchase-receives/new', permission: 'purchase_receive.create', element: <PurchaseReceiveCreatePage /> },
  { path: '/purchases/purchase-receives/:id', permission: 'purchase_receive.view', element: <PurchaseReceiveDetailPage /> },
  { path: '/settings/vendor-fields', permission: ['settings.view', 'settings.manage'], element: <VendorFieldsSettingsPage /> },
  { path: '/settings/purchases', permission: ['settings.view', 'settings.manage'], element: <PurchaseSettingsPage /> },
];
