import type { LaptopSpecs } from '../../components/LaptopSpecs';

/**
 * Response shapes of svc-procurement (`poView`, `grnView`) and the lookups the module needs from
 * svc-master / svc-party. Snapshots are stored on the document at creation time and never change.
 */

export const PO_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export const GRN_STATUSES = ['DRAFT', 'RECEIVED', 'POSTING_FAILED', 'QC_PENDING', 'QC_COMPLETED', 'CANCELLATION_PENDING', 'CANCELLED'] as const;
export type GrnStatus = (typeof GRN_STATUSES)[number];

/** Mirrors PO_TRANSITIONS in procurement.service.ts (from-status per command). */
export const PO_TRANSITIONS = {
  submit: ['DRAFT'],
  approve: ['PENDING_APPROVAL'],
  reject: ['PENDING_APPROVAL'],
  issue: ['APPROVED'],
  revise: ['ISSUED', 'PARTIALLY_RECEIVED'],
  cancel: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED'],
  'short-close': ['PARTIALLY_RECEIVED'],
  close: ['RECEIVED'],
} as const satisfies Record<string, readonly PoStatus[]>;
export type PoCommand = keyof typeof PO_TRANSITIONS;

export const PO_RECEIVABLE_STATUSES: readonly PoStatus[] = ['ISSUED', 'PARTIALLY_RECEIVED'];
/** GRN statuses where an async posting is in flight (poll the document). */
export const GRN_POSTING_STATUSES: readonly GrnStatus[] = ['RECEIVED', 'CANCELLATION_PENDING'];
export const GRN_CANCELLABLE_STATUSES: readonly GrnStatus[] = ['DRAFT', 'QC_PENDING', 'POSTING_FAILED'];

export type DiscountType = 'PERCENT' | 'AMOUNT';

/* ---- snapshots (from @b2b/contracts, copied as plain shapes) ------------------------------------ */

export interface SupplierSnapshot {
  id: string;
  code: string;
  legalName: string;
  displayName: string;
  gstTreatment: string;
  gstin: string | null;
  pan: string | null;
  stateCode: string | null;
  billingAddress: Record<string, unknown> | null;
  paymentTermId: string | null;
  status: string;
  blockedReason: string | null;
}

export interface WarehouseSnapshot {
  id: string;
  code: string;
  name: string;
  stateCode: string;
  gstin: string | null;
  address: Record<string, unknown>;
  isDefault: boolean;
  status: string;
}

export interface ProductSnapshot {
  id: string;
  sku: string;
  name: string;
  type: 'GOODS' | 'SERVICE';
  trackInventory: boolean;
  isSerialized: boolean;
  requiresImei: boolean;
  serialPattern: string | null;
  qcRequired: boolean;
  unitCode: string;
  hsnCode: string | null;
  taxRate: number | null;
  status: string;
  /** Laptop configurations only (the 8 specs); null / absent on legacy items. */
  specs?: LaptopSpecs | null;
}

/* ---- lookups ------------------------------------------------------------------------------------ */

export interface WarehouseLookup extends WarehouseSnapshot {
  locations?: { id: string; code: string; name: string; purpose: string; status: string; bins: BinLookup[] }[];
}
export interface BinLookup {
  id: string;
  code: string;
  capacity: number | null;
  status: string;
}
export interface PaymentTermLookup {
  id: string;
  name: string;
  days: number;
  isDefault: boolean;
  status: string;
}

/* ---- purchase orders ----------------------------------------------------------------------------- */

export interface TaxBreakupRow {
  label: 'CGST' | 'SGST' | 'IGST';
  rate: number;
  amount: number;
}

export interface PoLine {
  id: string;
  lineNo: number;
  itemId: string;
  item: ProductSnapshot;
  orderedQty: number;
  receivedQty: number;
  cancelledQty: number;
  remainingQty: number;
  unitPrice: number;
  taxRate: number;
  taxableAmount: number;
  taxAmount: number;
  lineTotal: number;
}

export interface PurchaseOrder {
  id: string;
  number: string;
  revision: number;
  status: PoStatus;
  statusReason: string | null;
  supplierId: string;
  supplier: SupplierSnapshot;
  shipToWarehouseId: string;
  shipTo: WarehouseSnapshot;
  orderDate: string;
  expectedDate: string | null;
  paymentTermId: string | null;
  currency: string;
  discountType: DiscountType;
  discountValue: number;
  intraState: boolean;
  subtotal: number;
  discountAmount: number;
  taxTotal: number;
  taxBreakup: TaxBreakupRow[];
  total: number;
  notes: string | null;
  terms: string | null;
  createdBy: string;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  issuedAt: string | null;
  cancelledAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  lines: PoLine[];
}

export interface PoApproval {
  id: string;
  poId: string;
  revision: number;
  decision: 'APPROVED' | 'REJECTED';
  actorId: string;
  comment: string | null;
  decidedAt: string;
}
export interface PoRevisionSummary {
  revision: number;
  reason: string;
  createdBy: string;
  createdAt: string;
}
export interface PoGrnSummary {
  id: string;
  number: string;
  status: GrnStatus;
  receivedDate: string;
  warehouseId: string;
}
export interface PurchaseOrderDetail extends PurchaseOrder {
  approvals: PoApproval[];
  revisions: PoRevisionSummary[];
  grns: PoGrnSummary[];
}
export interface PoRevisionSnapshot {
  id: string;
  poId: string;
  revision: number;
  snapshot: PurchaseOrder;
  reason: string;
  createdBy: string;
  createdAt: string;
}

export interface PoLineInput {
  poLineId?: string;
  itemId: string;
  orderedQty: number;
  unitPrice: number;
  taxRate?: number | null;
}
export interface PoInput {
  supplierId: string;
  shipToWarehouseId: string;
  orderDate: string;
  expectedDate?: string | null;
  paymentTermId?: string | null;
  discountType: DiscountType;
  discountValue: number;
  notes?: string | null;
  terms?: string | null;
  lines: PoLineInput[];
}
export type PoPatch = Partial<PoInput>;
export interface ReviseInput {
  reason: string;
  lines: PoLineInput[];
  expectedDate?: string | null;
  notes?: string | null;
}

export interface PoListParams {
  status?: string;
  supplierId?: string;
  q?: string;
  awaitingApproval?: 'true';
  limit?: number;
}

export interface ReceivableLines {
  poId: string;
  number: string;
  status: PoStatus;
  receivable: boolean;
  shipToWarehouseId: string;
  lines: PoLine[];
}

/* ---- goods receipts ------------------------------------------------------------------------------ */

export interface GrnSerial {
  serialNo: string;
  imei: string | null;
}
export interface GrnLine {
  id: string;
  lineNo: number;
  poLineId: string;
  itemId: string;
  item: ProductSnapshot;
  qty: number;
  unitCost: number;
  binId: string | null;
  conditionNote: string | null;
  qcStatus: string;
  qcPassQty: number;
  qcFailQty: number;
  lotId: string | null;
  serials: GrnSerial[];
}
export interface Grn {
  id: string;
  number: string;
  poId: string;
  poNumber: string | null;
  supplierId: string;
  supplier: SupplierSnapshot;
  warehouseId: string;
  warehouse: WarehouseSnapshot;
  receivedDate: string;
  supplierInvoiceNo: string | null;
  supplierInvoiceDate: string | null;
  deliveryNoteNo: string | null;
  vehicleNo: string | null;
  status: GrnStatus;
  statusReason: string | null;
  remarks: string | null;
  receiptPostingId: string | null;
  createdBy: string;
  receivedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  qcProgress: { total: number; done: number; passQty: number; failQty: number };
  lines: GrnLine[];
}

export interface GrnLineInput {
  poLineId: string;
  qty: number;
  unitCost?: number | null;
  binId?: string | null;
  conditionNote?: string | null;
  serials: { serialNo: string; imei?: string | null }[];
}
export interface GrnInput {
  poId: string;
  warehouseId?: string | null;
  receivedDate: string;
  supplierInvoiceNo?: string | null;
  supplierInvoiceDate?: string | null;
  deliveryNoteNo?: string | null;
  vehicleNo?: string | null;
  remarks?: string | null;
  lines: GrnLineInput[];
}
export interface GrnListParams {
  status?: string;
  poId?: string;
  warehouseId?: string;
  /** Matches GRN number, supplier invoice number or PO number. */
  q?: string;
  limit?: number;
}
/** grnLineId -> replacement serials for POST grns/:id/retry-posting. */
export type RetrySerials = Record<string, { serialNo: string; imei: string | null }[]>;

/* ---- settings and attachments -------------------------------------------------------------------- */

export interface ProcurementSettings {
  approverMustDiffer: boolean;
  approvalLimit: number | null;
  closeRequiresQc: boolean;
  overReceiptTolerancePct: number;
}

export type AttachmentEntity = 'PO' | 'GRN';
export interface Attachment {
  id: string;
  entityType: AttachmentEntity;
  entityId: string;
  objectKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
}
export interface PresignResult {
  attachmentId: string;
  objectKey: string;
  uploadUrl: string;
}
