/** Canonical permission catalogue. The DB `permissions` table is synced from this list at seed time. */
export const PERMISSIONS = [
  { code: 'vendor.view', module: 'vendor', description: 'View vendors' },
  { code: 'vendor.create', module: 'vendor', description: 'Create vendors' },
  { code: 'vendor.edit', module: 'vendor', description: 'Edit vendor information' },
  { code: 'vendor.delete', module: 'vendor', description: 'Delete (archive) vendors' },
  { code: 'vendor.status_update', module: 'vendor', description: 'Activate / deactivate vendors' },
  { code: 'vendor.bank_details_view', module: 'vendor', description: 'Reveal full vendor bank account numbers' },

  { code: 'item.view', module: 'item', description: 'View items' },
  { code: 'item.create', module: 'item', description: 'Create items' },
  { code: 'item.edit', module: 'item', description: 'Edit items and change their status' },
  { code: 'item.delete', module: 'item', description: 'Delete (archive) items' },

  { code: 'purchase_order.view', module: 'purchase_order', description: 'View purchase orders' },
  { code: 'purchase_order.create', module: 'purchase_order', description: 'Create purchase orders' },
  { code: 'purchase_order.edit', module: 'purchase_order', description: 'Edit purchase orders' },
  { code: 'purchase_order.issue', module: 'purchase_order', description: 'Issue, close and reopen purchase orders' },
  { code: 'purchase_order.cancel', module: 'purchase_order', description: 'Cancel purchase orders' },
  { code: 'purchase_order.delete', module: 'purchase_order', description: 'Delete draft purchase orders' },

  { code: 'purchase_receive.view', module: 'purchase_receive', description: 'View purchase receives (GRN)' },
  { code: 'purchase_receive.create', module: 'purchase_receive', description: 'Record purchase receives against purchase orders' },
  { code: 'purchase_receive.cancel', module: 'purchase_receive', description: 'Cancel purchase receives' },

  { code: 'settings.view', module: 'settings', description: 'View organization settings & masters' },
  { code: 'settings.manage', module: 'settings', description: 'Manage organization settings, masters, roles & members' },
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number]['code'];
export const PERMISSION_CODES = PERMISSIONS.map((p) => p.code) as PermissionCode[];

/** Default roles provisioned for every new organization. */
export const DEFAULT_ROLES: {
  code: string;
  name: string;
  description: string;
  permissions: PermissionCode[] | '*';
}[] = [
  { code: 'OWNER', name: 'Owner', description: 'Full access to everything in the organization', permissions: '*' },
  { code: 'ADMIN', name: 'Admin', description: 'Full access to all modules and settings', permissions: '*' },
  {
    code: 'PURCHASE_MANAGER',
    name: 'Purchase Manager',
    description: 'Manage vendors, items and the full purchasing cycle',
    permissions: [
      'vendor.view',
      'vendor.create',
      'vendor.edit',
      'vendor.status_update',
      'vendor.bank_details_view',
      'item.view',
      'item.create',
      'item.edit',
      'item.delete',
      'purchase_order.view',
      'purchase_order.create',
      'purchase_order.edit',
      'purchase_order.issue',
      'purchase_order.cancel',
      'purchase_order.delete',
      'purchase_receive.view',
      'purchase_receive.create',
      'purchase_receive.cancel',
      'settings.view',
    ],
  },
  {
    code: 'PURCHASE_EXECUTIVE',
    name: 'Purchase Executive',
    description: 'Create and edit vendors, items and purchase orders; record receives',
    permissions: [
      'vendor.view',
      'vendor.create',
      'vendor.edit',
      'item.view',
      'item.create',
      'item.edit',
      'purchase_order.view',
      'purchase_order.create',
      'purchase_order.edit',
      'purchase_receive.view',
      'purchase_receive.create',
      'settings.view',
    ],
  },
  {
    code: 'VIEWER',
    name: 'Viewer',
    description: 'Read-only access',
    permissions: ['vendor.view', 'item.view', 'purchase_order.view', 'purchase_receive.view', 'settings.view'],
  },
];
