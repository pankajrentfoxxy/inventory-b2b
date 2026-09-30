/**
 * Response shapes of svc-inventory (`/api/v1/inventory`) and the master lookups the module needs.
 * Mirrors apps/svc-inventory/src/modules/inventory.service.ts; do not invent fields here.
 */

export const BUCKETS = ['QC_HOLD', 'AVAILABLE', 'RESERVED', 'REJECTED', 'IN_TRANSIT', 'DELIVERED', 'EXT_SUPPLIER', 'EXT_CUSTOMER', 'EXT_OPENING', 'EXT_ADJUSTMENT', 'EXT_SCRAP'] as const;
export type Bucket = (typeof BUCKETS)[number];
/** Buckets that live in a warehouse balance row (stock grid filter). */
export const WAREHOUSE_BUCKETS = ['QC_HOLD', 'AVAILABLE', 'RESERVED', 'REJECTED', 'IN_TRANSIT'] as const;
export type WarehouseBucket = (typeof WAREHOUSE_BUCKETS)[number];

export const OPENING_BUCKETS = ['AVAILABLE', 'QC_HOLD'] as const;
export const ADJUSTMENT_BUCKETS = ['AVAILABLE', 'QC_HOLD', 'REJECTED'] as const;
export const BIN_MOVE_BUCKETS = ['AVAILABLE', 'QC_HOLD', 'RESERVED', 'REJECTED'] as const;

export const ADJUSTMENT_REASONS = ['COUNT_CORRECTION', 'DAMAGE', 'LOSS', 'FOUND', 'OPENING', 'OTHER'] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const ADJUSTMENT_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'POSTED', 'CANCELLED'] as const;
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];

/** Reference types the ledger / serial history link to a source document. */
export const REF_TYPES = ['OPENING', 'ADJUSTMENT', 'BIN_MOVE', 'GRN', 'QC_LOT', 'PO', 'SO', 'TRANSFER', 'RETURN', 'SHIPMENT'] as const;

/* ---- stock ---------------------------------------------------------------- */

export interface StockRow {
  itemId: string;
  warehouseId: string;
  sku: string;
  name: string;
  isSerialized: boolean;
  unitCode: string;
  warehouseCode: string;
  warehouseName: string;
  qcHold: number;
  available: number;
  reserved: number;
  rejected: number;
  inTransit: number;
  onHand: number;
  avgCost: number | null;
}

export interface StockQuery {
  warehouseId?: string;
  itemId?: string;
  bucket?: string;
  q?: string;
  limit?: number;
}

export interface StockItemSummary {
  id: string;
  sku: string;
  name: string;
  isSerialized: boolean;
  unitCode: string;
}
export interface StockByWarehouseRow {
  warehouseId: string;
  warehouseCode: string;
  bucket: Bucket;
  qty: number;
}
export interface StockByBinRow {
  warehouseId: string;
  binId: string | null;
  binCode: string | null;
  bucket: Bucket;
  qty: number;
}
export interface StockByGradeRow {
  warehouseId: string;
  bucket: Bucket;
  gradeCode: string | null;
  qty: number;
}
export interface DeliveredRow {
  partyId: string;
  qty: number;
}
export interface ItemCostRow {
  warehouseId: string;
  avgCost: number;
  qtyBasis: number;
}
export interface StockByItem {
  item: StockItemSummary;
  byWarehouse: StockByWarehouseRow[];
  byBin: StockByBinRow[];
  byGrade: StockByGradeRow[];
  delivered: DeliveredRow[];
  cost: ItemCostRow[];
}

/* ---- ledger --------------------------------------------------------------- */

export interface LedgerQuery {
  itemId?: string;
  warehouseId?: string;
  from?: string;
  to?: string;
  refType?: string;
  limit?: number;
}

export interface LedgerRow {
  id: string;
  postingId: string;
  postingType: string;
  refType: string;
  refId: string;
  refNumber: string | null;
  requestedBy: string;
  actorId: string | null;
  lineNo: number;
  itemId: string;
  sku: string;
  name: string;
  warehouseId: string | null;
  binId: string | null;
  partyId: string | null;
  bucket: Bucket;
  qty: number;
  unitCost: number | null;
  gradeCode: string | null;
  createdAt: string;
  /** Only populated when the ledger is filtered by item. */
  runningOnHand: number | null;
}

/* ---- serials -------------------------------------------------------------- */

export interface SerialsQuery {
  q?: string;
  itemId?: string;
  bucket?: string;
  warehouseId?: string;
  limit?: number;
}

export interface SerialUnit {
  id: string;
  itemId: string;
  serialNo: string;
  imei: string | null;
  bucket: Bucket;
  warehouseId: string | null;
  binId: string | null;
  partyId: string | null;
  gradeCode: string | null;
  qcStatus: string | null;
  unitCost: number | null;
  poId: string | null;
  grnId: string | null;
  qcLotId: string | null;
  soId: string | null;
  reservationId: string | null;
  dcId: string | null;
  shipmentId: string | null;
  warrantyEnd: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface SerialDetail extends SerialUnit {
  item: { sku: string; name: string } | null;
}
export interface SerialEvent {
  id: string;
  postingId: string;
  postingType: string;
  fromBucket: Bucket | null;
  toBucket: Bucket | null;
  warehouseId: string | null;
  binId: string | null;
  partyId: string | null;
  refType: string;
  refId: string;
  refNumber: string | null;
  actorId: string | null;
  occurredAt: string;
}

/* ---- opening stock -------------------------------------------------------- */

export interface OpeningSerialInput {
  serialNo: string;
  imei?: string | null;
  gradeCode?: string | null;
}
export interface OpeningLineInput {
  itemId: string;
  binId?: string | null;
  bucket: 'AVAILABLE' | 'QC_HOLD';
  qty: number;
  unitCost: number;
  gradeCode?: string | null;
  serials: OpeningSerialInput[];
}
export interface OpeningStockInput {
  warehouseId: string;
  notes?: string | null;
  lines: OpeningLineInput[];
}
export interface PostingLineResult {
  lineNo: number;
  itemId: string;
  warehouseId: string | null;
  binId: string | null;
  bucket: Bucket;
  qty: number;
  [key: string]: unknown;
}
export interface OpeningStockResult {
  postingId: string;
  refId: string;
  warehouseId: string;
  lines: PostingLineResult[];
  serials: number;
}
export type OpeningImportRow = OpeningLineInput & { warehouseId: string };
export interface OpeningImportRowResult {
  row: number;
  status: 'POSTED' | 'FAILED';
  postingId?: string;
  error?: { code: string; message: string };
}
export interface OpeningImportResult {
  total: number;
  posted: number;
  failed: number;
  results: OpeningImportRowResult[];
}

/* ---- adjustments ---------------------------------------------------------- */

export interface AdjustmentLineInput {
  itemId: string;
  binId?: string | null;
  bucket: 'AVAILABLE' | 'QC_HOLD' | 'REJECTED';
  qtyDelta: number;
  unitCost?: number | null;
  serialNumbers: string[];
}
export interface AdjustmentInput {
  warehouseId: string;
  reasonCode: AdjustmentReason;
  notes?: string | null;
  lines: AdjustmentLineInput[];
}
export interface AdjustmentLine {
  id: string;
  lineNo: number;
  itemId: string;
  binId: string | null;
  bucket: 'AVAILABLE' | 'QC_HOLD' | 'REJECTED';
  qtyDelta: number;
  unitCost: number | null;
  serialNumbers: string[];
}
export interface Adjustment {
  id: string;
  number: string;
  warehouseId: string;
  reasonCode: AdjustmentReason;
  notes: string | null;
  status: AdjustmentStatus;
  statusReason: string | null;
  totalValue: number;
  postingIds: string[];
  createdBy: string;
  submittedBy: string | null;
  approvedBy: string | null;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  lines: AdjustmentLine[];
}
export interface AdjustmentListQuery {
  status?: string;
  warehouseId?: string;
  limit?: number;
}

/* ---- bin moves ------------------------------------------------------------ */

export interface BinMoveInput {
  warehouseId: string;
  itemId: string;
  bucket: 'AVAILABLE' | 'QC_HOLD' | 'RESERVED' | 'REJECTED';
  fromBinId?: string | null;
  toBinId?: string | null;
  qty: number;
  serialNumbers: string[];
}
export interface BinMoveResult {
  postingId: string;
  refId: string;
  lines: PostingLineResult[];
  serials: number;
}

/* ---- settings / reconciliation ------------------------------------------- */

export interface InventorySettings {
  adjustmentApprovalThreshold: number;
}
export interface LedgerMismatch {
  itemId: string;
  warehouseId: string;
  binId: string;
  bucket: Bucket;
  ledgerQty: number;
  balanceQty: number;
}
export interface UnbalancedPosting {
  postingId: string;
  itemId: string;
  sum: number;
}
export interface SerialMismatch {
  itemId: string;
  warehouseId: string;
  binId: string;
  bucket: Bucket;
  serialCount: number;
  balanceQty: number;
}
export interface NegativeBalance {
  itemId: string;
  warehouseId: string;
  bucket: Bucket;
  qty: number;
}
export interface Reconciliation {
  checkedAt: string;
  ok: boolean;
  ledgerMismatches: LedgerMismatch[];
  unbalancedPostings: UnbalancedPosting[];
  serialMismatches: SerialMismatch[];
  negativeBalances: NegativeBalance[];
}

/* ---- master lookups (svc-master) ------------------------------------------ */

export interface WarehouseBin {
  id: string;
  code: string;
  capacity: number | null;
  status: string;
}
export interface WarehouseLocation {
  id: string;
  code: string;
  name: string | null;
  purpose: string | null;
  status: string;
  bins: WarehouseBin[];
}
export interface Warehouse {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  status: string;
  locations: WarehouseLocation[];
}
export interface ProductLookup {
  id: string;
  sku: string;
  name: string;
  trackInventory: boolean;
  isSerialized: boolean;
  requiresImei: boolean;
  serialPattern: string | null;
  unitCode: string;
  status: string;
}
