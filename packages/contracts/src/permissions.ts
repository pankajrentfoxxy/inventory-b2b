/**
 * Permission catalogue for the platform (phase-02 section 2.5). Lives in code so services and the
 * UI compile against the same codes; svc-iam syncs it into `iam_db` on start (adds new codes,
 * marks removed ones deprecated, never deletes grants).
 */
export type PermissionScope = 'TENANT' | 'PLATFORM';

export interface PermissionDef {
  code: string;
  module: string;
  scope: PermissionScope;
  description: string;
  sensitive?: boolean;
}

const t = (module: string, action: string, description: string, sensitive = false): PermissionDef => ({
  code: `${module}.${action}`,
  module,
  scope: 'TENANT',
  description,
  sensitive,
});
const p = (module: string, action: string, description: string, sensitive = false): PermissionDef => ({
  code: `${module}.${action}`,
  module,
  scope: 'PLATFORM',
  description,
  sensitive,
});

export const PERMISSION_CATALOG: PermissionDef[] = [
  // purchasing
  t('purchase', 'view', 'View purchase orders'),
  t('purchase', 'create', 'Create and submit purchase orders'),
  t('purchase', 'edit', 'Edit and revise purchase orders'),
  t('purchase', 'approve', 'Approve, reject and short-close purchase orders', true),
  t('purchase', 'issue', 'Issue approved purchase orders to suppliers'),
  t('purchase', 'cancel', 'Cancel purchase orders'),
  t('grn', 'view', 'View goods receipts'),
  t('grn', 'create', 'Record goods receipts'),
  t('grn', 'cancel', 'Cancel goods receipts', true),
  // qc
  t('qc', 'view', 'View QC lots'),
  t('qc', 'inspect', 'Record inspection results'),
  t('qc', 'approve', 'Decide QC lots', true),
  t('qc', 'manage', 'Manage checklists and defect codes'),
  // inventory
  t('inventory', 'view', 'View stock, ledger and serial numbers'),
  t('inventory', 'adjust', 'Create stock adjustments and opening stock', true),
  t('inventory', 'adjust.approve', 'Approve large stock adjustments', true),
  t('inventory', 'transfer', 'Move stock between bins and warehouses'),
  t('inventory', 'reserve', 'Reserve stock for sales orders'),
  t('transfer', 'view', 'View warehouse transfers'),
  t('transfer', 'create', 'Create warehouse transfers'),
  t('transfer', 'receive', 'Receive warehouse transfers'),
  // masters
  t('master', 'view', 'View products and master data'),
  t('master', 'manage', 'Manage products and master data'),
  t('warehouse', 'view', 'View warehouses, locations and bins'),
  t('warehouse', 'manage', 'Manage warehouses, locations and bins'),
  t('supplier', 'view', 'View suppliers'),
  t('supplier', 'manage', 'Create, edit and block suppliers'),
  t('customer', 'view', 'View customers'),
  t('customer', 'manage', 'Create, edit and block customers'),
  // sales / dispatch (later phases)
  t('sales', 'view', 'View sales orders'),
  t('sales', 'create', 'Create sales orders'),
  t('sales', 'edit', 'Edit sales orders'),
  t('sales', 'confirm', 'Confirm sales orders (reserves stock)'),
  t('sales', 'cancel', 'Cancel sales orders'),
  t('dispatch', 'view', 'View delivery challans and shipments'),
  t('dispatch', 'create', 'Create delivery challans and pack'),
  t('dispatch', 'ship', 'Dispatch and deliver shipments'),
  t('returns', 'view', 'View returns'),
  t('returns', 'manage', 'Create and process returns'),
  // finance (later phases)
  t('billing', 'view', 'View bills and invoices'),
  t('billing', 'manage', 'Create bills, invoices, credit and debit notes', true),
  t('payment', 'view', 'View payments'),
  t('payment', 'manage', 'Record and allocate payments', true),
  t('reports', 'view', 'View reports'),
  t('reports', 'export', 'Export reports'),
  // tenant administration
  t('iam', 'member.view', 'View members and invitations'),
  t('iam', 'member.invite', 'Invite members, resend and revoke invitations'),
  t('iam', 'member.suspend', 'Suspend and reactivate members', true),
  t('iam', 'member.remove', 'Remove members', true),
  t('iam', 'member.manage', 'Change member warehouse scope'),
  t('iam', 'role.view', 'View roles and the permission catalogue'),
  t('iam', 'role.manage', 'Create, edit and delete custom roles', true),
  t('iam', 'role.assign', 'Assign roles to members', true),
  t('iam', 'owner.transfer', 'Transfer ownership', true),
  t('audit', 'view', 'View the audit trail'),
  t('settings', 'manage', 'Manage organisation settings and numbering'),
  // platform (never grantable in a tenant context)
  p('platform', 'dashboard.view', 'View the platform dashboard'),
  p('platform', 'tenant.view', 'View tenants'),
  p('platform', 'tenant.create', 'Create tenants'),
  p('platform', 'tenant.edit', 'Edit tenant profiles'),
  p('platform', 'tenant.approve', 'Approve or reject tenant applications', true),
  p('platform', 'tenant.activate', 'Activate tenants and send owner invites', true),
  p('platform', 'tenant.suspend', 'Suspend and reactivate tenants', true),
  p('platform', 'tenant.deactivate', 'Deactivate tenants', true),
  p('platform', 'audit.view', 'View the platform audit trail'),
  p('platform', 'iam.manage', 'Manage platform staff and roles', true),
];

export const PERMISSION_CODES = PERMISSION_CATALOG.map((d) => d.code);
export type PermissionCode = (typeof PERMISSION_CATALOG)[number]['code'];
export const TENANT_PERMISSION_CODES = PERMISSION_CATALOG.filter((d) => d.scope === 'TENANT').map((d) => d.code);
export const PLATFORM_PERMISSION_CODES = PERMISSION_CATALOG.filter((d) => d.scope === 'PLATFORM').map((d) => d.code);
export const isTenantPermission = (code: string) => TENANT_PERMISSION_CODES.includes(code);
export const isPlatformPermission = (code: string) => code.startsWith('platform.');

/* ---- default tenant roles (phase-02 table) --------------------------------- */

export interface SystemRoleDef {
  key: string;
  name: string;
  rank: number;
  description: string;
  /** Explicit codes, or a predicate over the tenant catalogue. */
  permissions: string[] | ((code: string) => boolean);
}

const byPrefix = (...prefixes: string[]) => (code: string) => prefixes.some((pf) => code === pf || code.startsWith(`${pf}.`));
const viewOnly = (code: string) => code.endsWith('.view');

export const SYSTEM_ROLES: SystemRoleDef[] = [
  { key: 'OWNER', name: 'Owner', rank: 100, description: 'Full access to everything in the organisation', permissions: () => true },
  { key: 'ADMIN', name: 'Admin', rank: 90, description: 'Full access except ownership transfer', permissions: (c) => c !== 'iam.owner.transfer' },
  {
    key: 'PURCHASE_MANAGER', name: 'Purchase Manager', rank: 50, description: 'Runs the purchasing cycle',
    permissions: (c) => byPrefix('purchase', 'grn', 'supplier')(c) || ['qc.view', 'inventory.view', 'master.view', 'warehouse.view'].includes(c),
  },
  {
    key: 'PURCHASE_EXECUTIVE', name: 'Purchase Executive', rank: 30, description: 'Creates purchase orders and receives goods',
    permissions: ['purchase.view', 'purchase.create', 'purchase.edit', 'grn.view', 'grn.create', 'supplier.view', 'master.view', 'warehouse.view'],
  },
  {
    key: 'INVENTORY_MANAGER', name: 'Inventory Manager', rank: 50, description: 'Owns stock, adjustments and warehouses',
    permissions: (c) => byPrefix('inventory', 'warehouse', 'transfer')(c) || ['grn.view', 'qc.view', 'master.view'].includes(c),
  },
  {
    key: 'QC_MANAGER', name: 'QC Manager', rank: 50, description: 'Inspects and decides QC lots',
    permissions: (c) => byPrefix('qc')(c) || ['grn.view', 'inventory.view', 'master.view'].includes(c),
  },
  {
    key: 'SALES_MANAGER', name: 'Sales Manager', rank: 50, description: 'Runs sales orders and customers',
    permissions: (c) => byPrefix('sales', 'customer')(c) || ['inventory.view', 'inventory.reserve', 'dispatch.view', 'master.view'].includes(c),
  },
  {
    key: 'DISPATCH_MANAGER', name: 'Dispatch Manager', rank: 50, description: 'Packs, dispatches and delivers',
    permissions: (c) => byPrefix('dispatch')(c) || ['sales.view', 'inventory.view', 'master.view', 'warehouse.view'].includes(c),
  },
  {
    key: 'FINANCE', name: 'Finance', rank: 50, description: 'Bills, invoices, payments and reports',
    permissions: (c) => byPrefix('billing', 'payment', 'reports')(c) || ['purchase.view', 'sales.view', 'supplier.view', 'customer.view'].includes(c),
  },
  { key: 'VIEWER', name: 'Viewer', rank: 10, description: 'Read-only access', permissions: viewOnly },
];

export function resolveRolePermissions(role: SystemRoleDef): string[] {
  if (Array.isArray(role.permissions)) return role.permissions.filter(isTenantPermission);
  const predicate = role.permissions;
  return TENANT_PERMISSION_CODES.filter(predicate);
}

/* ---- platform roles (phase-01, svc-auth; moves to svc-iam in Phase 2) ------- */

export const PLATFORM_ROLES: SystemRoleDef[] = [
  { key: 'PLATFORM_SUPER_ADMIN', name: 'Platform Super Admin', rank: 100, description: 'Everything on the platform', permissions: (c) => isPlatformPermission(c) },
  {
    key: 'PLATFORM_REVIEWER', name: 'Platform Reviewer', rank: 50, description: 'Reviews and approves tenant applications',
    permissions: ['platform.dashboard.view', 'platform.tenant.view', 'platform.tenant.create', 'platform.tenant.edit', 'platform.tenant.approve', 'platform.audit.view'],
  },
  { key: 'PLATFORM_SUPPORT', name: 'Platform Support', rank: 30, description: 'Read-only platform access', permissions: ['platform.dashboard.view', 'platform.tenant.view', 'platform.audit.view'] },
];

export function resolvePlatformRolePermissions(role: SystemRoleDef): string[] {
  if (Array.isArray(role.permissions)) return role.permissions.filter(isPlatformPermission);
  const predicate = role.permissions;
  return PLATFORM_PERMISSION_CODES.filter(predicate);
}

/* ---- legacy API mapping (Phase 2 step 8.7) --------------------------------- */

/** Legacy permission code -> new catalogue code(s). Any of the new codes satisfies the legacy check. */
export const LEGACY_PERMISSION_MAP: Record<string, string[]> = {
  'vendor.view': ['supplier.view'],
  'vendor.create': ['supplier.manage'],
  'vendor.edit': ['supplier.manage'],
  'vendor.delete': ['supplier.manage'],
  'vendor.status_update': ['supplier.manage'],
  'vendor.bank_details_view': ['supplier.manage'],
  'item.view': ['master.view'],
  'item.create': ['master.manage'],
  'item.edit': ['master.manage'],
  'item.delete': ['master.manage'],
  'purchase_order.view': ['purchase.view'],
  'purchase_order.create': ['purchase.create'],
  'purchase_order.edit': ['purchase.edit'],
  'purchase_order.issue': ['purchase.issue'],
  'purchase_order.cancel': ['purchase.cancel'],
  'purchase_order.delete': ['purchase.cancel'],
  'purchase_receive.view': ['grn.view'],
  'purchase_receive.create': ['grn.create'],
  'purchase_receive.cancel': ['grn.cancel'],
  'settings.view': ['master.view', 'settings.manage'],
  'settings.manage': ['settings.manage'],
};

/** Legacy role code -> new system role key (Phase 1/2 membership migration). */
export const LEGACY_ROLE_MAP: Record<string, string> = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  PURCHASE_MANAGER: 'PURCHASE_MANAGER',
  PURCHASE_EXECUTIVE: 'PURCHASE_EXECUTIVE',
  VIEWER: 'VIEWER',
};
