import type { RouteDef } from '../../router/types';
import { ProductListPage } from './pages/ProductListPage';
import { ProductDetailPage } from './pages/ProductDetailPage';
import { LaptopCreatePage } from './pages/LaptopCreatePage';
import { LaptopSpecsPage } from './pages/LaptopSpecsPage';
import { WarehousesPage } from './pages/WarehousesPage';
import { TaxPage } from './pages/TaxPage';
import { OtherMastersPage } from './pages/OtherMastersPage';
import { NumberingPage } from './pages/NumberingPage';

const PRODUCT_VIEW = ['master.view', 'purchase.view', 'sales.view', 'inventory.view'];

/** Master data (svc-master, `/v1/master`). Route permissions mirror the service's view guards. */
export const masterRoutes: RouteDef[] = [
  { path: '/masters/laptop-specs', permission: 'master.view', element: <LaptopSpecsPage /> },
  { path: '/masters/products', permission: PRODUCT_VIEW, element: <ProductListPage /> },
  { path: '/masters/products/new', permission: 'master.manage', element: <LaptopCreatePage /> },
  { path: '/masters/products/:id', permission: PRODUCT_VIEW, element: <ProductDetailPage /> },
  { path: '/masters/warehouses', permission: ['warehouse.view', 'master.view', 'inventory.view', 'grn.view'], element: <WarehousesPage /> },
  { path: '/masters/tax', permission: 'master.view', element: <TaxPage /> },
  { path: '/masters/other', permission: 'master.view', element: <OtherMastersPage /> },
  { path: '/masters/numbering', permission: ['settings.manage', 'master.view'], element: <NumberingPage /> },
];
