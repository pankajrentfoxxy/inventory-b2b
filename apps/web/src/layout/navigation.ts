import { BarChart3, Boxes, FolderOpen, Home, Package, ShoppingBag, ShoppingCart, type LucideIcon } from 'lucide-react';

export interface NavLeaf {
  label: string;
  to: string;
  permission?: string;
  /** False until the module ships: rendered muted and not clickable. Never a fake page. */
  available: boolean;
}

export interface NavModule {
  key: string;
  label: string;
  icon: LucideIcon;
  to?: string;
  permission?: string;
  available: boolean;
  children?: NavLeaf[];
}

/** Module tree in delivery order. Items, Vendors, Purchase Orders and Purchase Receives are live. */
export const NAVIGATION: NavModule[] = [
  { key: 'home', label: 'Home', icon: Home, to: '/', available: false },
  { key: 'items', label: 'Items', icon: Package, to: '/items', permission: 'item.view', available: true },
  { key: 'inventory', label: 'Inventory', icon: Boxes, available: false },
  { key: 'sales', label: 'Sales', icon: ShoppingBag, available: false },
  {
    key: 'purchases',
    label: 'Purchases',
    icon: ShoppingCart,
    available: true,
    children: [
      { label: 'Vendors', to: '/purchases/vendors', permission: 'vendor.view', available: true },
      { label: 'Purchase Orders', to: '/purchases/purchase-orders', permission: 'purchase_order.view', available: true },
      { label: 'Purchase Receives', to: '/purchases/purchase-receives', permission: 'purchase_receive.view', available: true },
      { label: 'Bills', to: '/purchases/bills', available: false },
      { label: 'Payments Made', to: '/purchases/payments-made', available: false },
      { label: 'Vendor Credits', to: '/purchases/vendor-credits', available: false },
    ],
  },
  { key: 'reports', label: 'Reports', icon: BarChart3, available: false },
  { key: 'documents', label: 'Documents', icon: FolderOpen, available: false },
];

/** Which list the global search box targets, by route prefix. */
export const SEARCH_SCOPES: { prefix: string; label: string; to: string }[] = [
  { prefix: '/purchases/purchase-orders', label: 'Purchase Orders', to: '/purchases/purchase-orders' },
  { prefix: '/purchases/purchase-receives', label: 'Purchase Receives', to: '/purchases/purchase-receives' },
  { prefix: '/purchases/vendors', label: 'Vendors', to: '/purchases/vendors' },
  { prefix: '/items', label: 'Items', to: '/items' },
];
