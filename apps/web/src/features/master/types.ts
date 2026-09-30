/** Shapes returned by svc-master (`/v1/master`). Mirrors master.service.ts serializers. */

export type ProductStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
export type ProductType = 'GOODS' | 'SERVICE';
export type MasterStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
export type WarehouseStatus = 'ACTIVE' | 'INACTIVE';

export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
}

/** Snapshot published in events and returned by the lookups endpoint. */
export interface ProductSnapshot {
  id: string;
  tenantId: string;
  sku: string;
  name: string;
  type: ProductType;
  trackInventory: boolean;
  isSerialized: boolean;
  requiresImei: boolean;
  serialPattern: string | null;
  qcRequired: boolean;
  unitCode: string;
  hsnCode: string | null;
  taxRate: number | null;
  status: ProductStatus;
  version: number;
}

export interface Product extends ProductSnapshot {
  description: string | null;
  categoryId: string | null;
  brandId: string | null;
  unitId: string;
  hsnId: string | null;
  taxRateId: string | null;
  defaultWarrantyId: string | null;
  purchasePrice: number | null;
  sellingPrice: number | null;
  reorderLevel: number | null;
  attributes: Record<string, unknown>;
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ProductDetail extends Product {
  referencedBy: string[];
  /** Fields frozen once the item has stock movements (isSerialized, trackInventory, unitId, type). */
  lockedFields: string[];
}

export interface ProductListParams {
  q?: string;
  status?: string;
  type?: string;
  categoryId?: string;
  brandId?: string;
  isSerialized?: string;
  trackInventory?: string;
  limit?: number;
  cursor?: string;
}

export interface ProductPayload {
  sku: string;
  name: string;
  description?: string | null;
  type: ProductType;
  trackInventory?: boolean;
  isSerialized: boolean;
  requiresImei: boolean;
  serialPattern?: string | null;
  qcRequired?: boolean;
  categoryId?: string | null;
  brandId?: string | null;
  unitId: string;
  hsnId?: string | null;
  taxRateId?: string | null;
  defaultWarrantyId?: string | null;
  purchasePrice?: number | null;
  sellingPrice?: number | null;
  reorderLevel?: number | null;
  activate?: boolean;
}
export type ProductPatch = Partial<Omit<ProductPayload, 'activate'>>;

export interface ImportResult {
  total: number;
  created: number;
  failed: number;
  results: { row: number; sku: string; status: 'CREATED' | 'FAILED'; id?: string; error?: string; details?: unknown }[];
}

/* ---- warehouses --------------------------------------------------------------- */

export interface WarehouseAddress {
  line1: string;
  line2?: string | null;
  city: string;
  state?: string | null;
  stateCode: string;
  pincode: string;
  country: string;
}

export interface Bin {
  id: string;
  code: string;
  capacity: number | null;
  status: WarehouseStatus;
}

export type LocationPurpose = 'RECEIVING' | 'QC' | 'STORAGE' | 'PACKING' | 'DISPATCH' | 'QUARANTINE';

export interface Location {
  id: string;
  code: string;
  name: string | null;
  purpose: LocationPurpose | null;
  status: WarehouseStatus;
  bins: Bin[];
}

export interface Warehouse {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  stateCode: string;
  gstin: string | null;
  address: Partial<WarehouseAddress>;
  isDefault: boolean;
  status: WarehouseStatus;
  version: number;
  locations: Location[];
}

export interface WarehousePayload {
  code: string;
  name: string;
  address: WarehouseAddress;
  stateCode?: string;
  gstin?: string | null;
  isDefault: boolean;
}
export type WarehousePatch = Partial<Omit<WarehousePayload, 'code'>>;

export interface LocationPayload {
  code: string;
  name?: string | null;
  purpose?: LocationPurpose | null;
}
export interface BinPayload {
  code: string;
  capacity?: number | null;
}

/* ---- simple masters ------------------------------------------------------------ */

export type SimpleKind = 'units' | 'tax-rates' | 'hsn-codes' | 'categories' | 'brands' | 'condition-grades' | 'warranty-policies' | 'payment-terms' | 'custom-fields';

export interface SimpleRow {
  id: string;
  status: MasterStatus;
  createdAt?: string;
  updatedAt?: string;
}
export interface Unit extends SimpleRow {
  code: string;
  name: string;
  decimals: number;
  uqc: string | null;
}
export interface TaxRate extends SimpleRow {
  name: string;
  gstRate: number | string;
  cessRate: number | string;
  effectiveFrom: string;
  effectiveTo: string | null;
}
export interface HsnCode extends SimpleRow {
  code: string;
  kind: 'HSN' | 'SAC';
  description: string | null;
  defaultTaxRateId: string | null;
}
export interface Category extends SimpleRow {
  name: string;
  parentId: string | null;
  path: string;
}
export interface Brand extends SimpleRow {
  name: string;
}
export interface ConditionGrade extends SimpleRow {
  code: string;
  name: string;
  sortOrder: number;
  sellable: boolean;
}
export interface WarrantyPolicy extends SimpleRow {
  name: string;
  durationMonths: number;
  startsOn: 'INVOICE_DATE' | 'DELIVERY_DATE';
  terms: string | null;
}
export interface PaymentTerm extends SimpleRow {
  name: string;
  days: number;
  isDefault: boolean;
}
export type CustomFieldEntity = 'PRODUCT' | 'SUPPLIER' | 'CUSTOMER' | 'PURCHASE_ORDER' | 'SALES_ORDER' | 'GRN';
export type CustomFieldDataType = 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT';
export interface CustomFieldDef extends SimpleRow {
  entity: CustomFieldEntity;
  key: string;
  label: string;
  dataType: CustomFieldDataType;
  options: string[] | null;
  required: boolean;
}

export interface SimpleRowMap {
  units: Unit;
  'tax-rates': TaxRate;
  'hsn-codes': HsnCode;
  categories: Category;
  brands: Brand;
  'condition-grades': ConditionGrade;
  'warranty-policies': WarrantyPolicy;
  'payment-terms': PaymentTerm;
  'custom-fields': CustomFieldDef;
}

/* ---- numbering ------------------------------------------------------------------- */

export const DOC_TYPES = ['PO', 'GRN', 'QC', 'ADJ', 'TRF', 'SO', 'DC', 'SHP', 'RMA', 'INV', 'BILL', 'CN', 'DN', 'PAY'] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  PO: 'Purchase Order',
  GRN: 'Goods Receipt',
  QC: 'QC Lot',
  ADJ: 'Stock Adjustment',
  TRF: 'Stock Transfer',
  SO: 'Sales Order',
  DC: 'Delivery Challan',
  SHP: 'Shipment',
  RMA: 'Return (RMA)',
  INV: 'Invoice',
  BILL: 'Bill',
  CN: 'Credit Note',
  DN: 'Debit Note',
  PAY: 'Payment',
};

export interface NumberingConfig {
  tenantId?: string;
  docType: DocType;
  prefixTemplate: string;
  padding: number;
  resetEachFy: boolean;
  lastFy?: string | null;
  lastSeq?: number | null;
}
export interface NumberingPayload {
  prefixTemplate: string;
  padding: number;
  resetEachFy: boolean;
}

/** Notified GST slabs accepted by svc-master (master.schema.ts GST_SLABS). */
export const GST_SLABS = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40] as const;

export const LOCATION_PURPOSES: LocationPurpose[] = ['RECEIVING', 'QC', 'STORAGE', 'PACKING', 'DISPATCH', 'QUARANTINE'];
export const CUSTOM_FIELD_ENTITIES: CustomFieldEntity[] = ['PRODUCT', 'SUPPLIER', 'CUSTOMER', 'PURCHASE_ORDER', 'SALES_ORDER', 'GRN'];
export const CUSTOM_FIELD_DATA_TYPES: CustomFieldDataType[] = ['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT'];
