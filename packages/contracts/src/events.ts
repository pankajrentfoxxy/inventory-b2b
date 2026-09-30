/**
 * Event registry (README section 7). Event type strings and zod payload schemas; producers validate
 * before enqueueing, consumers parse on receipt. Routing key = `<eventType>.v<eventVersion>`.
 */
import { z } from 'zod';

export const uuid = z.string().uuid();

export const EVENT_TYPES = {
  // Phase 0
  AUDIT_RECORDED: 'audit.recorded',
  PLATFORM_HEARTBEAT: 'platform.heartbeat',
  // Phase 1
  TENANT_CREATED: 'tenant.tenant.created',
  TENANT_APPROVED: 'tenant.tenant.approved',
  TENANT_REJECTED: 'tenant.tenant.rejected',
  TENANT_ACTIVATED: 'tenant.tenant.activated',
  TENANT_SUSPENDED: 'tenant.tenant.suspended',
  TENANT_REACTIVATED: 'tenant.tenant.reactivated',
  TENANT_DEACTIVATED: 'tenant.tenant.deactivated',
  TENANT_OWNER_INVITE_REQUESTED: 'tenant.owner_invite.requested',
  AUTH_LOGGED_IN: 'auth.user.logged_in',
  AUTH_LOGIN_FAILED: 'auth.user.login_failed',
  AUTH_OWNER_INVITED: 'auth.owner.invited',
  AUTH_PASSWORD_RESET_REQUESTED: 'auth.password.reset_requested',
  // Phase 2
  IAM_INVITATION_CREATED: 'iam.invitation.created',
  IAM_MEMBERSHIP_ACTIVATED: 'iam.membership.activated',
  IAM_MEMBERSHIP_SUSPENDED: 'iam.membership.suspended',
  IAM_MEMBERSHIP_REACTIVATED: 'iam.membership.reactivated',
  IAM_MEMBERSHIP_REMOVED: 'iam.membership.removed',
  IAM_PERMISSIONS_CHANGED: 'iam.permissions.changed',
  // Phase 3
  MASTER_PRODUCT_CREATED: 'master.product.created',
  MASTER_PRODUCT_UPDATED: 'master.product.updated',
  MASTER_PRODUCT_STATUS_CHANGED: 'master.product.status_changed',
  MASTER_WAREHOUSE_CREATED: 'master.warehouse.created',
  MASTER_WAREHOUSE_UPDATED: 'master.warehouse.updated',
  MASTER_BIN_CREATED: 'master.bin.created',
  MASTER_BIN_UPDATED: 'master.bin.updated',
  MASTER_GRADE_UPDATED: 'master.grade.updated',
  PARTY_SUPPLIER_CREATED: 'party.supplier.created',
  PARTY_SUPPLIER_UPDATED: 'party.supplier.updated',
  PARTY_SUPPLIER_BLOCKED: 'party.supplier.blocked',
  PARTY_CUSTOMER_CREATED: 'party.customer.created',
  PARTY_CUSTOMER_UPDATED: 'party.customer.updated',
  PARTY_CUSTOMER_BLOCKED: 'party.customer.blocked',
  // Phase 4
  INVENTORY_POSTING_RECORDED: 'inventory.posting.recorded',
  INVENTORY_ADJUSTMENT_POSTED: 'inventory.adjustment.posted',
  INVENTORY_STOCK_LOW: 'inventory.stock.low',
  // Phase 5
  PO_SUBMITTED: 'procurement.po.submitted',
  PO_APPROVED: 'procurement.po.approved',
  PO_REJECTED: 'procurement.po.rejected',
  PO_ISSUED: 'procurement.po.issued',
  PO_REVISED: 'procurement.po.revised',
  PO_CANCELLED: 'procurement.po.cancelled',
  PO_CLOSED: 'procurement.po.closed',
  PO_CREATED: 'procurement.po.created',
  PO_PARTIALLY_RECEIVED: 'procurement.po.partially_received',
  PO_RECEIVED: 'procurement.po.received',
  PO_RECEIPT_REVERSED: 'procurement.po.receipt_reversed',
  GRN_RECEIVED: 'procurement.grn.received',
  GRN_CANCELLATION_REQUESTED: 'procurement.grn.cancellation_requested',
  GRN_CANCELLED: 'procurement.grn.cancelled',
  GRN_QC_COMPLETED: 'procurement.grn.qc_completed',
  INVENTORY_RECEIPT_POSTED: 'inventory.receipt.posted',
  INVENTORY_RECEIPT_REJECTED: 'inventory.receipt.rejected',
  INVENTORY_RECEIPT_REVERSED: 'inventory.receipt.reversed',
  INVENTORY_RECEIPT_REVERSAL_REFUSED: 'inventory.receipt.reversal_refused',
  INVENTORY_QC_POSTING_RECORDED: 'inventory.qc_posting.recorded',
  QC_LOT_CREATED: 'qc.lot.created',
  QC_LOT_DECIDED: 'qc.lot.decided',
  QC_LOT_CANCELLED: 'qc.lot.cancelled',
  QC_LOT_CANCELLATION_REFUSED: 'qc.lot.cancellation_refused',
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];
export const rk = (type: EventType, version = 1) => `${type}.v${version}`;

/* ---- payload schemas ---------------------------------------------------- */

export const auditRecordedPayload = z.object({
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  summary: z.string().nullable().optional(),
  oldValue: z.unknown().nullable().optional(),
  newValue: z.unknown().nullable().optional(),
  reason: z.string().nullable().optional(),
  actorName: z.string().nullable().optional(),
  ip: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
});
export type AuditRecordedPayload = z.infer<typeof auditRecordedPayload>;

export const tenantLifecyclePayload = z.object({
  tenantId: uuid,
  code: z.string(),
  legalName: z.string(),
  displayName: z.string(),
  status: z.string(),
  previousStatus: z.string().nullable(),
  reason: z.string().nullable(),
  ownerName: z.string(),
  ownerEmail: z.string(),
  actorId: uuid.nullable(),
  occurredAt: z.string(),
  /** ADMIN_CREATED | APPLICATION | LEGACY_MIGRATION */
  source: z.string().optional(),
  stateCode: z.string().nullable().optional(),
  registeredAddress: z.record(z.unknown()).nullable().optional(),
});
export type TenantLifecyclePayload = z.infer<typeof tenantLifecyclePayload>;

export const authLoginPayload = z.object({ userId: uuid.nullable(), email: z.string(), tenantId: uuid.nullable(), ip: z.string().nullable(), userAgent: z.string().nullable(), reason: z.string().nullable().optional() });

export const iamInvitationCreatedPayload = z.object({
  invitationId: uuid,
  tenantId: uuid,
  email: z.string(),
  roleKeys: z.array(z.string()),
  invitedByName: z.string().nullable(),
  /** Raw token is only in the event so notification can build the link; never stored elsewhere. */
  acceptToken: z.string(),
  expiresAt: z.string(),
  tenantName: z.string().nullable().optional(),
});

export const iamMembershipPayload = z.object({
  membershipId: uuid,
  tenantId: uuid.nullable(),
  userId: uuid,
  status: z.string(),
  roleKeys: z.array(z.string()),
  permissionVersion: z.number().int(),
  reason: z.string().nullable().optional(),
});

export const iamPermissionsChangedPayload = z.object({
  tenantId: uuid.nullable(),
  memberships: z.array(z.object({ membershipId: uuid, permissionVersion: z.number().int() })),
  roleId: uuid.nullable(),
  roleKey: z.string().nullable(),
  reason: z.string(),
});

export const productSnapshot = z.object({
  id: uuid,
  tenantId: uuid,
  sku: z.string(),
  name: z.string(),
  type: z.enum(['GOODS', 'SERVICE']),
  trackInventory: z.boolean(),
  isSerialized: z.boolean(),
  requiresImei: z.boolean(),
  serialPattern: z.string().nullable(),
  qcRequired: z.boolean(),
  unitCode: z.string(),
  hsnCode: z.string().nullable(),
  taxRate: z.number().nullable(),
  status: z.string(),
  version: z.number().int(),
});
export type ProductSnapshot = z.infer<typeof productSnapshot>;

export const warehouseSnapshot = z.object({
  id: uuid,
  tenantId: uuid,
  code: z.string(),
  name: z.string(),
  stateCode: z.string(),
  gstin: z.string().nullable(),
  address: z.record(z.unknown()),
  isDefault: z.boolean(),
  status: z.string(),
  version: z.number().int(),
});
export type WarehouseSnapshot = z.infer<typeof warehouseSnapshot>;

export const binSnapshot = z.object({ id: uuid, tenantId: uuid, warehouseId: uuid, locationId: uuid, code: z.string(), status: z.string(), version: z.number().int() });

export const gradeSnapshot = z.object({ tenantId: uuid, grades: z.array(z.object({ code: z.string(), name: z.string(), sellable: z.boolean(), sortOrder: z.number().int() })) });

export const partySnapshot = z.object({
  id: uuid,
  tenantId: uuid,
  partyType: z.enum(['SUPPLIER', 'CUSTOMER']),
  code: z.string(),
  legalName: z.string(),
  displayName: z.string(),
  gstTreatment: z.string(),
  gstin: z.string().nullable(),
  pan: z.string().nullable(),
  stateCode: z.string().nullable(),
  billingAddress: z.record(z.unknown()).nullable(),
  paymentTermId: uuid.nullable(),
  status: z.string(),
  blockedReason: z.string().nullable(),
  version: z.number().int(),
});
export type PartySnapshot = z.infer<typeof partySnapshot>;

export const postingLine = z.object({
  lineNo: z.number().int(),
  itemId: uuid,
  warehouseId: uuid.nullable(),
  binId: uuid.nullable(),
  partyId: uuid.nullable(),
  bucket: z.string(),
  qty: z.number(),
  unitCost: z.number().nullable(),
  gradeCode: z.string().nullable(),
});

export const inventoryPostingRecordedPayload = z.object({
  postingId: uuid,
  postingType: z.string(),
  refType: z.string(),
  refId: uuid,
  refNumber: z.string().nullable(),
  idempotencyKey: z.string(),
  lines: z.array(postingLine),
  serials: z.array(z.object({ serialUnitId: uuid, serialNo: z.string(), itemId: uuid, toBucket: z.string() })),
});
export type InventoryPostingRecordedPayload = z.infer<typeof inventoryPostingRecordedPayload>;

export const grnReceivedPayload = z.object({
  grnId: uuid,
  grnNumber: z.string(),
  poId: uuid,
  poNumber: z.string(),
  supplierId: uuid,
  warehouseId: uuid,
  receivedDate: z.string(),
  lines: z.array(
    z.object({
      grnLineId: uuid,
      poLineId: uuid,
      itemId: uuid,
      itemSnapshot: productSnapshot.partial().extend({ sku: z.string(), name: z.string(), isSerialized: z.boolean(), qcRequired: z.boolean() }),
      qty: z.number(),
      unitCost: z.number(),
      binId: uuid.nullable(),
      serials: z.array(z.object({ serialNo: z.string(), imei: z.string().nullable() })),
    }),
  ),
});
export type GrnReceivedPayload = z.infer<typeof grnReceivedPayload>;

export const receiptPostedPayload = z.object({
  grnId: uuid,
  postingId: uuid,
  warehouseId: uuid,
  poId: uuid.nullable().optional(),
  grnNumber: z.string().nullable().optional(),
  lines: z.array(z.object({ grnLineId: uuid, itemId: uuid, qty: z.number(), unitCost: z.number().nullable().optional(), binId: uuid.nullable().optional(), qcRequired: z.boolean(), isSerialized: z.boolean(), serialUnitIds: z.array(uuid), serials: z.array(z.string()), itemSnapshot: z.record(z.unknown()) })),
});
export type ReceiptPostedPayload = z.infer<typeof receiptPostedPayload>;

export const receiptRejectedPayload = z.object({ grnId: uuid, reason: z.string(), code: z.string(), duplicates: z.array(z.string()) });

export const grnCancellationRequestedPayload = z.object({ grnId: uuid, grnNumber: z.string(), reason: z.string(), lineIds: z.array(uuid) });

export const qcLotDecidedPayload = z.object({
  lotId: uuid,
  lotNumber: z.string(),
  sourceType: z.string(),
  sourceId: uuid,
  sourceLineId: uuid,
  itemId: uuid,
  warehouseId: uuid,
  mode: z.enum(['QUANTITY', 'SERIAL']),
  binId: uuid.nullable().optional(),
  passQty: z.number(),
  failQty: z.number(),
  serials: z.array(z.object({ serialNo: z.string(), result: z.enum(['PASS', 'FAIL']), gradeCode: z.string().nullable(), defectCodes: z.array(z.string()) })),
  decidedBy: uuid.nullable(),
});
export type QcLotDecidedPayload = z.infer<typeof qcLotDecidedPayload>;

export const qcLotCancelledPayload = z.object({ lotId: uuid, grnId: uuid, grnLineId: uuid, itemId: uuid, warehouseId: uuid, qty: z.number(), serials: z.array(z.string()), lineCount: z.number().int().optional() });
export const qcCancellationRefusedPayload = z.object({ grnId: uuid, lotId: uuid, reason: z.string() });

export const qcPostingRecordedPayload = z.object({ lotId: uuid, grnId: uuid, grnLineId: uuid, postingIds: z.array(uuid), passQty: z.number(), failQty: z.number() });

export const receiptReversedPayload = z.object({ grnId: uuid, grnLineId: uuid.nullable(), postingId: uuid.nullable(), lotId: uuid.nullable() });
export const receiptReversalRefusedPayload = z.object({ grnId: uuid, lotId: uuid.nullable(), reason: z.string() });

export const poLifecyclePayload = z.object({
  poId: uuid,
  number: z.string(),
  revision: z.number().int(),
  status: z.string(),
  previousStatus: z.string().nullable(),
  supplierId: uuid,
  total: z.number(),
  reason: z.string().nullable(),
  lines: z.array(z.object({ poLineId: uuid, itemId: uuid, orderedQty: z.number() })).optional(),
});
