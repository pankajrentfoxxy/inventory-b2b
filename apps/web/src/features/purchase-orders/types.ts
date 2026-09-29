import type { DeliveryAddressType, DiscountType, PurchaseOrderStatus, TaxBreakupRow, TaxDeductionType } from '@b2b/shared';

export type ReceiveState = 'NONE' | 'PARTIAL' | 'FULL';

export interface PoListItem {
  id: string;
  purchaseOrderNumber: string;
  referenceNumber: string | null;
  orderDate: string;
  expectedDeliveryDate: string | null;
  vendor: { id: string; displayName: string };
  status: PurchaseOrderStatus;
  receiveState: ReceiveState | null;
  currencyCode: string;
  subTotal: number;
  total: number;
  lineCount: number;
  receiveCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PoListResponse {
  data: PoListItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  counts: Record<string, number>;
}

export interface PoListParams {
  page: number;
  limit: number;
  search: string;
  status: string;
  vendorId: string;
  dateFrom: string;
  dateTo: string;
  sortBy: string;
  sortOrder: string;
}

export interface AddressSnapshot {
  name?: string | null;
  attention: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  postalCode: string | null;
  countryCode: string;
  phone: string | null;
}

export interface PoLine {
  id: string;
  lineNumber: number;
  itemId: string | null;
  item: { id: string; name: string; sku: string | null; unit: string; available: boolean } | null;
  name: string;
  sku: string | null;
  description: string | null;
  hsnCode: string | null;
  quantity: number;
  unit: string | null;
  rate: number;
  taxId: string | null;
  taxName: string | null;
  taxRate: number;
  amount: number;
  taxableAmount: number;
  taxAmount: number;
  total: number;
  receivedQuantity: number;
  remainingQuantity: number;
}

export interface PoDetail {
  id: string;
  organizationId: string;
  purchaseOrderNumber: string;
  referenceNumber: string | null;
  orderDate: string;
  expectedDeliveryDate: string | null;
  status: PurchaseOrderStatus;
  receiveState: ReceiveState;
  orderedQuantity: number;
  receivedQuantity: number;
  vendorId: string;
  vendor: {
    id: string;
    displayName: string;
    companyName: string | null;
    email: string | null;
    phone: string | null;
    gstin: string | null;
    status: string;
    gstTreatment: { id: string; name: string } | null;
    sourceOfSupply: { id: string; code: string; name: string } | null;
    billingAddress: AddressSnapshot | null;
  };
  locationId: string | null;
  location: { id: string; name: string } | null;
  deliveryType: DeliveryAddressType;
  deliveryLocationId: string | null;
  deliveryLocation: { id: string; name: string } | null;
  deliveryAddress: AddressSnapshot | null;
  sourceOfSupplyCode: string | null;
  placeOfSupplyCode: string | null;
  isIntraState: boolean;
  paymentTermId: string | null;
  paymentTerm: { id: string; name: string; days: number } | null;
  shipmentPreference: string | null;
  currencyCode: string;
  lines: PoLine[];
  discountType: DiscountType;
  discountValue: number;
  taxDeductionType: TaxDeductionType;
  taxDeductionRate: number;
  taxDeductionLabel: string | null;
  adjustment: number;
  adjustmentLabel: string | null;
  subTotal: number;
  discountAmount: number;
  taxTotal: number;
  taxBreakup: TaxBreakupRow[];
  taxDeductionAmount: number;
  total: number;
  notes: string | null;
  terms: string | null;
  customFields: { fieldId: string; key: string; label: string; fieldType: string; value: unknown }[];
  receives: { id: string; receiveNumber: string; receivedDate: string; totalQuantity: number; status: 'RECEIVED' | 'CANCELLED'; createdAt: string }[];
  counts: { documents: number; receives: number };
  issuedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PoFormOptions {
  locations: { id: string; name: string; type: string; attention: string | null; addressLine1: string | null; addressLine2: string | null; city: string | null; state: string | null; stateCode: string | null; postalCode: string | null; countryCode: string; phone: string | null; email: string | null; gstin: string | null; isPrimary: boolean; isActive: boolean }[];
  taxes: { id: string; name: string; rate: number; isDefault: boolean; isActive: boolean }[];
  paymentTerms: { id: string; name: string; days: number; isDefault: boolean }[];
  customFields: { id: string; key: string; label: string; fieldType: 'TEXT' | 'NUMBER' | 'DATE' | 'DROPDOWN' | 'BOOLEAN'; options: string[]; isRequired: boolean }[];
  nextNumber: { docType: string; prefix: string; nextNumber: number; padding: number; preview: string };
  countries: readonly { code: string; name: string; dialCode: string }[];
  indianStates: readonly { code: string; short: string; name: string }[];
  tdsPresets: readonly { label: string; rate: number }[];
  tcsPresets: readonly { label: string; rate: number }[];
}

export interface PoDocument {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByName: string | null;
  createdAt: string;
}

export interface PoActivityItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  userId: string | null;
  userName: string | null;
  summary: string | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  createdAt: string;
}

export interface Paginated<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}
