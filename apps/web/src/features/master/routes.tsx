import type { RouteDef } from '../../router/types';
import { ProductListPage } from './pages/ProductListPage';
import { ProductDetailPage } from './pages/ProductDetailPage';
import { WarehousesPage } from './pages/WarehousesPage';
import { CatalogPage } from './pages/CatalogPage';
import { TaxPage } from './pages/TaxPage';
import { OtherMastersPage } from './pages/OtherMastersPage';
import { NumberingPage } from './pages/NumberingPage';

/** Master data (svc-master, `/v1/master`). Route permissions mirror the service's view guards. */
export const masterRoutes: RouteDef[] = [
  { path: '/masters/products', permission: ['master.view', 'purchase.view', 'sales.view', 'inventory.view'], element: <ProductListPage /> },
  { path: '/masters/products/:id', permission: ['master.view', 'purchase.view', 'sales.view', 'inventory.view'], element: <ProductDetailPage /> },
  { path: '/masters/warehouses', permission: ['warehouse.view', 'master.view', 'inventory.view', 'grn.view'], element: <WarehousesPage /> },
  { path: '/masters/catalog', permission: 'master.view', element: <CatalogPage /> },
  { path: '/masters/tax', permission: 'master.view', element: <TaxPage /> },
  { path: '/masters/other', permission: 'master.view', element: <OtherMastersPage /> },
  { path: '/masters/numbering', permission: ['settings.manage', 'master.view'], element: <NumberingPage /> },
];
