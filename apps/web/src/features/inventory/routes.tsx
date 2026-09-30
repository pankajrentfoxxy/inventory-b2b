import type { RouteDef } from '../../router/types';
import { AdjustmentCreatePage } from './pages/AdjustmentCreatePage';
import { AdjustmentDetailPage } from './pages/AdjustmentDetailPage';
import { AdjustmentListPage } from './pages/AdjustmentListPage';
import { BinMovePage } from './pages/BinMovePage';
import { InventorySettingsPage } from './pages/InventorySettingsPage';
import { LedgerPage } from './pages/LedgerPage';
import { OpeningStockPage } from './pages/OpeningStockPage';
import { SerialDetailPage } from './pages/SerialDetailPage';
import { SerialListPage } from './pages/SerialListPage';
import { StockItemPage } from './pages/StockItemPage';
import { StockListPage } from './pages/StockListPage';

/** Inventory module (phase-04 UI). Backend: svc-inventory at /api/v1/inventory. */
export const inventoryRoutes: RouteDef[] = [
  { path: '/inventory/stock', permission: 'inventory.view', element: <StockListPage /> },
  { path: '/inventory/stock/:itemId', permission: 'inventory.view', element: <StockItemPage /> },
  { path: '/inventory/ledger', permission: 'inventory.view', element: <LedgerPage /> },
  { path: '/inventory/serials', permission: 'inventory.view', element: <SerialListPage /> },
  { path: '/inventory/serials/:id', permission: 'inventory.view', element: <SerialDetailPage /> },
  { path: '/inventory/adjustments', permission: 'inventory.view', element: <AdjustmentListPage /> },
  { path: '/inventory/adjustments/new', permission: 'inventory.adjust', element: <AdjustmentCreatePage /> },
  { path: '/inventory/adjustments/:id', permission: 'inventory.view', element: <AdjustmentDetailPage /> },
  { path: '/inventory/opening-stock', permission: 'inventory.adjust', element: <OpeningStockPage /> },
  { path: '/inventory/bin-moves', permission: 'inventory.transfer', element: <BinMovePage /> },
  { path: '/settings/inventory', permission: ['inventory.view', 'inventory.adjust.approve'], element: <InventorySettingsPage /> },
];
