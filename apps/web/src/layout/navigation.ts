import { BarChart3, Boxes, Building2, ClipboardCheck, FolderOpen, History, LayoutDashboard, Package, ScrollText, Settings, ShieldCheck, ShoppingBag, ShoppingCart, Users, type LucideIcon } from 'lucide-react';

export interface NavLeaf {
  label: string;
  to: string;
  /** One of these permissions shows the entry (legacy codes are accepted). */
  permission?: string | string[];
  /** False until the module ships: rendered muted and not clickable. Never a fake page. */
  available: boolean;
}

export interface NavModule {
  key: string;
  label: string;
  icon: LucideIcon;
  to?: string;
  permission?: string | string[];
  available: boolean;
  children?: NavLeaf[];
  /** Open by default in the sidebar. */
  defaultOpen?: boolean;
}

/** Tenant app (Phases 3-5 on the new services; legacy pages stay reachable until cut-over). */
export const NAVIGATION: NavModule[] = [
  { key: 'home', label: 'Home', icon: LayoutDashboard, to: '/', available: true },
  {
    key: 'masters',
    label: 'Masters',
    icon: Package,
    available: true,
    children: [
      { label: 'Laptop configurations', to: '/masters/products', permission: 'master.view', available: true },
      { label: 'Laptop specifications', to: '/masters/laptop-specs', permission: 'master.view', available: true },
      { label: 'Warehouses & Bins', to: '/masters/warehouses', permission: 'warehouse.view', available: true },
      { label: 'Tax & HSN', to: '/masters/tax', permission: 'master.view', available: true },
      { label: 'Terms, Grades & Fields', to: '/masters/other', permission: 'master.view', available: true },
      { label: 'Numbering', to: '/masters/numbering', permission: ['settings.manage', 'master.view'], available: true },
    ],
  },
  {
    key: 'parties',
    label: 'Parties',
    icon: Users,
    available: true,
    children: [
      { label: 'Vendors', to: '/parties/vendors', permission: 'supplier.view', available: true },
      { label: 'Customers', to: '/parties/customers', permission: 'customer.view', available: true },
    ],
  },
  {
    key: 'inventory',
    label: 'Inventory',
    icon: Boxes,
    available: true,
    children: [
      { label: 'Stock', to: '/inventory/stock', permission: 'inventory.view', available: true },
      { label: 'Stock Ledger', to: '/inventory/ledger', permission: 'inventory.view', available: true },
      { label: 'Serial Numbers', to: '/inventory/serials', permission: 'inventory.view', available: true },
      { label: 'Adjustments', to: '/inventory/adjustments', permission: 'inventory.view', available: true },
      { label: 'Opening Stock', to: '/inventory/opening-stock', permission: 'inventory.adjust', available: true },
      { label: 'Bin Moves', to: '/inventory/bin-moves', permission: 'inventory.transfer', available: true },
    ],
  },
  {
    key: 'purchases',
    label: 'Purchases',
    icon: ShoppingCart,
    available: true,
    defaultOpen: true,
    children: [
      { label: 'Purchase Orders', to: '/purchases/orders', permission: 'purchase.view', available: true },
      { label: 'Goods Receipts', to: '/purchases/receipts', permission: 'grn.view', available: true },
      { label: 'Bills', to: '/purchases/bills', available: false },
      { label: 'Payments Made', to: '/purchases/payments-made', available: false },
    ],
  },
  {
    key: 'quality',
    label: 'Quality',
    icon: ClipboardCheck,
    available: true,
    children: [
      { label: 'QC Lots', to: '/qc/lots', permission: 'qc.view', available: true },
      { label: 'Checklists & Defects', to: '/qc/checklists', permission: ['qc.view', 'qc.manage'], available: true },
    ],
  },
  { key: 'sales', label: 'Sales', icon: ShoppingBag, available: false },
  { key: 'reports', label: 'Reports', icon: BarChart3, available: false },
  { key: 'documents', label: 'Documents', icon: FolderOpen, available: false },
  {
    key: 'settings',
    label: 'Settings',
    icon: Settings,
    available: true,
    children: [
      { label: 'Members', to: '/settings/members', permission: 'iam.member.view', available: true },
      { label: 'Roles & Permissions', to: '/settings/roles', permission: 'iam.role.view', available: true },
      { label: 'Procurement', to: '/settings/procurement', permission: ['settings.manage', 'purchase.view'], available: true },
      { label: 'Inventory', to: '/settings/inventory', permission: ['inventory.adjust.approve', 'inventory.view'], available: true },
      { label: 'Audit Trail', to: '/settings/audit', permission: 'audit.view', available: true },
    ],
  },
  {
    key: 'legacy',
    label: 'Legacy',
    icon: History,
    available: true,
    children: [
      { label: 'Vendors', to: '/purchases/vendors', permission: 'vendor.view', available: true },
      { label: 'Items', to: '/items', permission: 'item.view', available: true },
      { label: 'Purchase Orders', to: '/purchases/purchase-orders', permission: 'purchase_order.view', available: true },
      { label: 'Purchase Receives', to: '/purchases/purchase-receives', permission: 'purchase_receive.view', available: true },
      { label: 'Purchase Settings', to: '/settings/purchases', permission: ['settings.view', 'settings.manage'], available: true },
      { label: 'Vendor Fields', to: '/settings/vendor-fields', permission: ['settings.view', 'settings.manage'], available: true },
    ],
  },
];

/** Platform console (Phase 1 + 2). */
export const PLATFORM_NAVIGATION: NavModule[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, to: '/admin', permission: 'platform.dashboard.view', available: true },
  { key: 'tenants', label: 'Tenants', icon: Building2, to: '/admin/tenants', permission: 'platform.tenant.view', available: true },
  { key: 'staff', label: 'Platform Staff', icon: ShieldCheck, to: '/admin/staff', permission: 'platform.iam.manage', available: true },
  { key: 'audit', label: 'Audit Trail', icon: ScrollText, to: '/admin/audit', permission: 'platform.audit.view', available: true },
];

export interface SearchScope {
  prefix: string;
  label: string;
  to: string;
  /** Query parameter the list reads (legacy lists use `search`, new lists use `q`). */
  param?: 'search' | 'q';
}

/** Which list the global search box targets, by route prefix (first match wins). */
export const SEARCH_SCOPES: SearchScope[] = [
  { prefix: '/purchases/purchase-orders', label: 'Legacy Purchase Orders', to: '/purchases/purchase-orders' },
  { prefix: '/purchases/purchase-receives', label: 'Legacy Purchase Receives', to: '/purchases/purchase-receives' },
  { prefix: '/purchases/vendors', label: 'Vendors', to: '/purchases/vendors' },
  { prefix: '/purchases/orders', label: 'Purchase Orders', to: '/purchases/orders', param: 'q' },
  { prefix: '/purchases/receipts', label: 'Goods Receipts', to: '/purchases/receipts', param: 'q' },
  { prefix: '/masters/products', label: 'Laptops', to: '/masters/products', param: 'q' },
  { prefix: '/parties/vendors', label: 'Vendors', to: '/parties/vendors', param: 'q' },
  { prefix: '/parties/customers', label: 'Customers', to: '/parties/customers', param: 'q' },
  { prefix: '/inventory/serials', label: 'Serial Numbers', to: '/inventory/serials', param: 'q' },
  { prefix: '/inventory/stock', label: 'Stock', to: '/inventory/stock', param: 'q' },
  { prefix: '/qc/lots', label: 'QC Lots', to: '/qc/lots', param: 'q' },
  { prefix: '/items', label: 'Items', to: '/items' },
];

export const PLATFORM_SEARCH_SCOPES: SearchScope[] = [{ prefix: '/admin/tenants', label: 'Tenants', to: '/admin/tenants', param: 'q' }];
