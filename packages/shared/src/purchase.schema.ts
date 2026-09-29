import { z } from 'zod';
import { DEFAULT_COUNTRY_CODE } from './constants.js';
import {
  amountField,
  dateField,
  gstinField,
  hsnField,
  integerField,
  nonNegativeQuantityField,
  optionalAmountField,
  optionalCode,
  optionalDateField,
  optionalEmail,
  optionalNotes,
  optionalText,
  optionalUuid,
  paginationFields,
  percentageField,
  phoneField,
  postalCodeField,
  quantityField,
  refineDateOrder,
  refineDateRangeQuery,
  refineIndianPostalCode,
  requiredBusinessName,
  requiredText,
  searchField,
  sortOrderField,
  uuidField,
} from './validation/fields.js';
import { MESSAGES } from './validation/messages.js';

/* ====================================================================
 * Constants for Items, Purchase Orders and Purchase Receives
 * ==================================================================== */

export const ITEM_TYPES = ['GOODS', 'SERVICE'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export const ITEM_TYPE_LABELS: Record<ItemType, string> = { GOODS: 'Goods', SERVICE: 'Service' };

/** Suggested units; the field is free text so organizations can add their own. */
export const ITEM_UNITS = ['pcs', 'nos', 'unit', 'set', 'pair', 'box', 'pack', 'kg', 'g', 'ltr', 'ml', 'm', 'cm', 'hrs', 'days'] as const;
export const DEFAULT_ITEM_UNIT = 'pcs';

export const LOCATION_TYPES = ['WAREHOUSE', 'OFFICE', 'STORE', 'OTHER'] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];
export const LOCATION_TYPE_LABELS: Record<LocationType, string> = { WAREHOUSE: 'Warehouse', OFFICE: 'Office', STORE: 'Store', OTHER: 'Other' };

export const PURCHASE_ORDER_STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];
export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  PARTIALLY_RECEIVED: 'Partially Received',
  RECEIVED: 'Received',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};
/** Statuses in which a PO still accepts edits. */
export const PURCHASE_ORDER_EDITABLE_STATUSES: PurchaseOrderStatus[] = ['DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED'];
/** Statuses in which goods can still be received against the PO. */
export const PURCHASE_ORDER_RECEIVABLE_STATUSES: PurchaseOrderStatus[] = ['ISSUED', 'PARTIALLY_RECEIVED'];

export const PURCHASE_RECEIVE_STATUSES = ['RECEIVED', 'CANCELLED'] as const;
export type PurchaseReceiveStatus = (typeof PURCHASE_RECEIVE_STATUSES)[number];

export const DISCOUNT_TYPES = ['PERCENT', 'AMOUNT'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const TAX_DEDUCTION_TYPES = ['NONE', 'TDS', 'TCS'] as const;
export type TaxDeductionType = (typeof TAX_DEDUCTION_TYPES)[number];

export const DELIVERY_ADDRESS_TYPES = ['LOCATION', 'CUSTOM'] as const;
export type DeliveryAddressType = (typeof DELIVERY_ADDRESS_TYPES)[number];

export const DOCUMENT_TYPES = ['PURCHASE_ORDER', 'PURCHASE_RECEIVE'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Seeded per organization; editable under Settings. */
export const DEFAULT_TAXES = [
  { name: 'GST0', rate: 0, isDefault: false },
  { name: 'GST5', rate: 5, isDefault: false },
  { name: 'GST12', rate: 12, isDefault: false },
  { name: 'GST18', rate: 18, isDefault: true },
  { name: 'GST28', rate: 28, isDefault: false },
] as const;

export const DEFAULT_LOCATION_NAME = 'Head Office';

export const DEFAULT_DOCUMENT_SEQUENCES: { docType: DocumentType; prefix: string; padding: number }[] = [
  { docType: 'PURCHASE_ORDER', prefix: 'PO-', padding: 5 },
  { docType: 'PURCHASE_RECEIVE', prefix: 'GRN-', padding: 5 },
];

/** Common TDS sections for purchases; organizations may type any label/rate. */
export const TDS_PRESETS = [
  { label: '194C - Contractors (1%)', rate: 1 },
  { label: '194C - Contractors (2%)', rate: 2 },
  { label: '194J - Professional Fees (10%)', rate: 10 },
  { label: '194H - Commission (5%)', rate: 5 },
  { label: '194Q - Purchase of Goods (0.1%)', rate: 0.1 },
] as const;
export const TCS_PRESETS = [{ label: '206C(1H) - Sale of Goods (0.1%)', rate: 0.1 }] as const;

export const PURCHASE_ORDER_ACTIVITY_ACTIONS = [
  'PO_CREATED',
  'PO_UPDATED',
  'PO_ISSUED',
  'PO_CANCELLED',
  'PO_CLOSED',
  'PO_REOPENED',
  'PO_DELETED',
  'RECEIVE_CREATED',
  'RECEIVE_CANCELLED',
  'DOCUMENT_UPLOADED',
  'DOCUMENT_REMOVED',
] as const;
export type PurchaseOrderActivityAction = (typeof PURCHASE_ORDER_ACTIVITY_ACTIONS)[number];

/* ====================================================================
 * Field helpers shared by the schemas below
 * ==================================================================== */

const countryField = z.string().trim().length(2, 'Select a country').toUpperCase().default(DEFAULT_COUNTRY_CODE);
/** GST state code such as "27". */
const stateCodeField = (label: string) => optionalText(5, {}, label);

/* ====================================================================
 * Items
 * ==================================================================== */

export const itemSchema = z.object({
  name: requiredBusinessName('Item name', { max: 200 }),
  sku: optionalCode('SKU', 60),
  type: z.enum(ITEM_TYPES).default('GOODS'),
  unit: optionalText(20, {}, 'Unit').transform((v) => v ?? DEFAULT_ITEM_UNIT),
  description: optionalNotes(1000, 'Description'),
  hsnCode: hsnField(),
  purchaseRate: optionalAmountField('Purchase rate'),
  sellingRate: optionalAmountField('Selling rate'),
  taxId: optionalUuid,
  preferredVendorId: optionalUuid,
  trackInventory: z.boolean().default(true),
  reorderLevel: optionalAmountField('Reorder level', { decimals: 3 }),
  isActive: z.boolean().default(true),
});
export type ItemPayload = z.output<typeof itemSchema>;
export type ItemFormInput = z.input<typeof itemSchema>;

export const ITEM_SORT_FIELDS = ['name', 'sku', 'purchaseRate', 'createdAt', 'updatedAt'] as const;

export const itemListQuerySchema = z.object({
  ...paginationFields,
  search: searchField(),
  status: z.union([z.literal('ACTIVE'), z.literal('INACTIVE'), z.literal('ALL'), z.literal('')]).optional().default('ALL'),
  type: z.union([z.enum(ITEM_TYPES), z.literal('')]).optional().default(''),
  sortBy: z.enum(ITEM_SORT_FIELDS).default('name'),
  sortOrder: sortOrderField('asc'),
});
export type ItemListQuery = z.output<typeof itemListQuerySchema>;

/* ====================================================================
 * Locations, taxes, document numbering (org masters)
 * ==================================================================== */

export const locationSchema = z
  .object({
    name: requiredBusinessName('Location name', { max: 120 }),
    type: z.enum(LOCATION_TYPES).default('WAREHOUSE'),
    attention: optionalText(120, {}, 'Attention'),
    addressLine1: optionalText(255, {}, 'Address line 1'),
    addressLine2: optionalText(255, {}, 'Address line 2'),
    city: optionalText(120, {}, 'City'),
    state: optionalText(120, {}, 'State'),
    stateCode: stateCodeField('State code'),
    postalCode: postalCodeField(),
    countryCode: countryField,
    phone: phoneField(),
    email: optionalEmail(),
    gstin: gstinField(),
    isPrimary: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .superRefine((l, ctx) => refineIndianPostalCode(ctx, l.countryCode, l.postalCode));
export type LocationPayload = z.output<typeof locationSchema>;

export const taxSchema = z.object({
  name: requiredText('Tax name', 50),
  rate: percentageField('Rate'),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export type TaxPayload = z.output<typeof taxSchema>;

export const documentSequenceSchema = z.object({
  prefix: optionalText(20, {}, 'Prefix').transform((v) => v ?? ''),
  nextNumber: integerField('Next number', { min: 1, max: 999_999_999 }),
  padding: integerField('Digits', { min: 0, max: 10, default: 5 }),
});
export type DocumentSequencePayload = z.output<typeof documentSequenceSchema>;

/* ====================================================================
 * Purchase orders
 * ==================================================================== */

export const deliveryAddressSchema = z.object({
  attention: optionalText(120, {}, 'Attention'),
  addressLine1: optionalText(255, {}, 'Address line 1'),
  addressLine2: optionalText(255, {}, 'Address line 2'),
  city: optionalText(120, {}, 'City'),
  state: optionalText(120, {}, 'State'),
  stateCode: stateCodeField('State code'),
  postalCode: postalCodeField(),
  countryCode: countryField,
  phone: phoneField(),
});
export type DeliveryAddressPayload = z.output<typeof deliveryAddressSchema>;

export const purchaseOrderLineSchema = z.object({
  id: optionalUuid,
  itemId: uuidField('item'),
  description: optionalNotes(1000, 'Description'),
  quantity: quantityField('Quantity'),
  unit: optionalText(20, {}, 'Unit'),
  rate: amountField('Rate'),
  taxId: optionalUuid,
});
export type PurchaseOrderLinePayload = z.output<typeof purchaseOrderLineSchema>;
export type PurchaseOrderLineInput = z.input<typeof purchaseOrderLineSchema>;

export const purchaseOrderCustomFieldValueSchema = z.object({
  fieldId: z.string().uuid(),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
});

export const purchaseOrderBaseSchema = z.object({
  vendorId: uuidField('vendor'),
  /** Warehouse the goods are for (Zoho "Location"). Optional; the delivery address decides GST place of supply. */
  locationId: optionalUuid,
  deliveryType: z.enum(DELIVERY_ADDRESS_TYPES).default('LOCATION'),
  deliveryLocationId: optionalUuid,
  deliveryAddress: deliveryAddressSchema.nullable().optional().transform((v) => v ?? null),
  /** GST state codes. Default to the vendor's source of supply and the delivery address state. */
  sourceOfSupplyCode: stateCodeField('Source of supply'),
  destinationOfSupplyCode: stateCodeField('Destination of supply'),
  /** Null or empty means "allocate the next number from the organization sequence". */
  purchaseOrderNumber: optionalText(30, {}, 'Purchase order number'),
  referenceNumber: optionalText(60, {}, 'Reference number'),
  orderDate: dateField('Order date'),
  expectedDeliveryDate: optionalDateField('Expected delivery date'),
  paymentTermId: optionalUuid,
  shipmentPreference: optionalText(100, {}, 'Shipment preference'),
  lines: z.array(purchaseOrderLineSchema).min(1, 'Add at least one item'),
  discountType: z.enum(DISCOUNT_TYPES).default('PERCENT'),
  discountValue: amountField('Discount', { default: 0 }),
  taxDeductionType: z.enum(TAX_DEDUCTION_TYPES).default('NONE'),
  taxDeductionRate: percentageField('TDS/TCS rate', { default: 0 }),
  taxDeductionLabel: optionalText(80, {}, 'Deduction label'),
  adjustment: amountField('Adjustment', { default: 0, allowNegative: true }),
  adjustmentLabel: optionalText(60, {}, 'Adjustment label'),
  notes: optionalNotes(2000, 'Notes'),
  terms: optionalNotes(5000, 'Terms'),
  customFields: z.array(purchaseOrderCustomFieldValueSchema).default([]),
});

function refinePurchaseOrder(po: z.output<typeof purchaseOrderBaseSchema>, ctx: z.RefinementCtx) {
  if (po.deliveryType === 'LOCATION' && !po.deliveryLocationId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['deliveryLocationId'], message: 'Select a delivery location' });
  }
  if (po.deliveryType === 'CUSTOM') {
    const a = po.deliveryAddress;
    if (!a || (!a.addressLine1 && !a.city)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['deliveryAddress', 'addressLine1'], message: 'Enter the delivery address' });
    }
    if (a) refineIndianPostalCode(ctx, a.countryCode, a.postalCode, ['deliveryAddress', 'postalCode']);
  }
  if (po.discountType === 'PERCENT' && po.discountValue > 100) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['discountValue'], message: MESSAGES.percentage('Discount percentage') });
  }
  if (po.taxDeductionType !== 'NONE' && po.taxDeductionRate <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['taxDeductionRate'], message: `Enter the ${po.taxDeductionType} rate` });
  }
  refineDateOrder(ctx, po.orderDate, po.expectedDeliveryDate, ['expectedDeliveryDate'], 'the order date', 'Expected delivery date');
}

export const purchaseOrderSchema = purchaseOrderBaseSchema.superRefine(refinePurchaseOrder);
export type PurchaseOrderPayload = z.output<typeof purchaseOrderBaseSchema>;
export type PurchaseOrderFormInput = z.input<typeof purchaseOrderBaseSchema>;

export const PURCHASE_ORDER_SORT_FIELDS = ['orderDate', 'purchaseOrderNumber', 'expectedDeliveryDate', 'total', 'status', 'createdAt', 'updatedAt'] as const;

export const purchaseOrderListQuerySchema = z
  .object({
    ...paginationFields,
    search: searchField(),
    status: z.union([z.enum(PURCHASE_ORDER_STATUSES), z.literal('ALL'), z.literal('OPEN'), z.literal('')]).optional().default('ALL'),
    vendorId: optionalUuid,
    dateFrom: optionalDateField('From date'),
    dateTo: optionalDateField('To date'),
    sortBy: z.enum(PURCHASE_ORDER_SORT_FIELDS).default('createdAt'),
    sortOrder: sortOrderField('desc'),
  })
  .superRefine((q, ctx) => refineDateRangeQuery(ctx, q.dateFrom, q.dateTo));
export type PurchaseOrderListQuery = z.output<typeof purchaseOrderListQuerySchema>;

export const purchaseOrderCancelSchema = z.object({ reason: optionalNotes(500, 'Reason') });

/** Query flags accepted by POST /purchase-orders. */
export const purchaseOrderCreateQuerySchema = z.object({
  issue: z.union([z.literal('true'), z.literal('false'), z.literal('')]).optional().default(''),
});

/* ====================================================================
 * Purchase receives (GRN)
 * ==================================================================== */

export const purchaseReceiveLineSchema = z.object({
  purchaseOrderLineId: z.string().uuid(),
  quantity: nonNegativeQuantityField('Quantity', { default: 0 }),
});

export const purchaseReceiveSchema = z
  .object({
    purchaseOrderId: uuidField('purchase order'),
    receiveNumber: optionalText(30, {}, 'Receive number'),
    receivedDate: dateField('Received date'),
    notes: optionalNotes(2000, 'Notes'),
    lines: z.array(purchaseReceiveLineSchema).min(1, 'Add at least one line'),
  })
  .superRefine((r, ctx) => {
    if (!r.lines.some((l) => l.quantity > 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lines'], message: 'Enter a quantity to receive for at least one item' });
    }
  });
export type PurchaseReceivePayload = z.output<typeof purchaseReceiveSchema>;

export const PURCHASE_RECEIVE_SORT_FIELDS = ['receivedDate', 'receiveNumber', 'createdAt'] as const;

export const purchaseReceiveListQuerySchema = z.object({
  ...paginationFields,
  search: searchField(),
  status: z.union([z.enum(PURCHASE_RECEIVE_STATUSES), z.literal('ALL'), z.literal('')]).optional().default('ALL'),
  vendorId: optionalUuid,
  purchaseOrderId: optionalUuid,
  sortBy: z.enum(PURCHASE_RECEIVE_SORT_FIELDS).default('createdAt'),
  sortOrder: sortOrderField('desc'),
});
export type PurchaseReceiveListQuery = z.output<typeof purchaseReceiveListQuerySchema>;

export const purchaseReceiveCancelSchema = z.object({ reason: optionalNotes(500, 'Reason') });

/* ====================================================================
 * Other request schemas used by routes
 * ==================================================================== */

export const itemStatusSchema = z.object({ isActive: z.boolean() });
export const documentTypeParamSchema = z.object({ docType: z.enum(DOCUMENT_TYPES) });
export const gstinLookupQuerySchema = z.object({ gstin: gstinField({ required: true }).transform((v) => v ?? '') });
