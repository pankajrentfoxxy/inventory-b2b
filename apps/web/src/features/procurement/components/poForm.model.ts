import { computePurchaseOrderTotals, type TotalsResult } from '@b2b/shared';
import { todayISO } from '../../../lib/utils';
import type { LaptopSpecs } from '../../../components/LaptopSpecs';
import type { DiscountType, PoInput, PoLineInput, ProductSnapshot, PurchaseOrder } from '../types';

/** Form state keeps numbers as strings (controlled inputs); the payload converts once. */
export interface PoLineFormValues {
  poLineId?: string;
  itemId: string;
  itemName: string;
  itemSku: string;
  unitCode: string;
  orderedQty: string;
  unitPrice: string;
  /** '' = use the product default (`defaultTaxRate`). */
  taxRate: string;
  defaultTaxRate: string;
  isSerialized: boolean;
  receivedQty: number;
  /** Laptop specs of the chosen SKU (read-only display; never sent to the API). */
  specs: LaptopSpecs | null;
}

export interface PoFormValues {
  supplierId: string;
  supplierName: string;
  supplierGstin: string;
  supplierStateCode: string;
  shipToWarehouseId: string;
  shipToStateCode: string;
  orderDate: string;
  expectedDate: string;
  paymentTermId: string;
  discountType: DiscountType;
  discountValue: string;
  notes: string;
  terms: string;
  lines: PoLineFormValues[];
}

export function emptyLine(): PoLineFormValues {
  return { itemId: '', itemName: '', itemSku: '', unitCode: '', orderedQty: '1', unitPrice: '', taxRate: '', defaultTaxRate: '', isSerialized: false, receivedQty: 0, specs: null };
}

export function lineFromProduct(product: ProductSnapshot, base: PoLineFormValues = emptyLine()): PoLineFormValues {
  return { ...base, itemId: product.id, itemName: product.name, itemSku: product.sku, unitCode: product.unitCode, defaultTaxRate: product.taxRate === null ? '' : String(product.taxRate), taxRate: '', isSerialized: product.isSerialized, specs: product.specs ?? null };
}

export function defaultPoForm(defaultWarehouseId = ''): PoFormValues {
  return { supplierId: '', supplierName: '', supplierGstin: '', supplierStateCode: '', shipToWarehouseId: defaultWarehouseId, shipToStateCode: '', orderDate: todayISO(), expectedDate: '', paymentTermId: '', discountType: 'PERCENT', discountValue: '0', notes: '', terms: '', lines: [emptyLine()] };
}

const dateOnly = (v: string | null) => (v ? v.slice(0, 10) : '');

export function poToForm(po: PurchaseOrder): PoFormValues {
  return {
    supplierId: po.supplierId,
    supplierName: po.supplier.displayName,
    supplierGstin: po.supplier.gstin ?? '',
    supplierStateCode: po.supplier.stateCode ?? '',
    shipToWarehouseId: po.shipToWarehouseId,
    shipToStateCode: po.shipTo.stateCode,
    orderDate: dateOnly(po.orderDate),
    expectedDate: dateOnly(po.expectedDate),
    paymentTermId: po.paymentTermId ?? '',
    discountType: po.discountType,
    discountValue: String(po.discountValue),
    notes: po.notes ?? '',
    terms: po.terms ?? '',
    lines: po.lines.map((l) => ({
      poLineId: l.id,
      itemId: l.itemId,
      itemName: l.item.name,
      itemSku: l.item.sku,
      unitCode: l.item.unitCode,
      orderedQty: String(l.orderedQty),
      unitPrice: String(l.unitPrice),
      taxRate: l.item.taxRate !== null && l.item.taxRate === l.taxRate ? '' : String(l.taxRate),
      defaultTaxRate: l.item.taxRate === null ? '' : String(l.item.taxRate),
      isSerialized: l.item.isSerialized,
      receivedQty: l.receivedQty,
      specs: l.item.specs ?? null,
    })),
  };
}

const num = (v: string) => (v.trim() === '' ? NaN : Number(v));

export function lineToPayload(l: PoLineFormValues): PoLineInput {
  return { poLineId: l.poLineId, itemId: l.itemId, orderedQty: num(l.orderedQty), unitPrice: num(l.unitPrice), taxRate: l.taxRate.trim() === '' ? null : num(l.taxRate) };
}

export function formToPayload(v: PoFormValues): PoInput {
  return {
    supplierId: v.supplierId,
    shipToWarehouseId: v.shipToWarehouseId,
    orderDate: v.orderDate,
    expectedDate: v.expectedDate || null,
    paymentTermId: v.paymentTermId || null,
    discountType: v.discountType,
    discountValue: Number(v.discountValue) || 0,
    notes: v.notes.trim() || null,
    terms: v.terms.trim() || null,
    lines: v.lines.map(lineToPayload),
  };
}

/** Same rule as the service: unknown supplier state counts as intra-state. */
export function isIntraState(supplierStateCode: string, warehouseStateCode: string): boolean {
  return supplierStateCode ? supplierStateCode === warehouseStateCode : true;
}

export function effectiveTaxRate(l: { taxRate: string; defaultTaxRate: string }): number {
  const v = l.taxRate.trim() === '' ? l.defaultTaxRate : l.taxRate;
  return Number(v) || 0;
}

/** Live preview only; the server persists the authoritative figures with the same function. */
export function previewTotals(v: PoFormValues): TotalsResult {
  return computePurchaseOrderTotals({
    lines: v.lines.map((l) => ({ quantity: Number(l.orderedQty) || 0, rate: Number(l.unitPrice) || 0, taxRate: effectiveTaxRate(l) })),
    discountType: v.discountType,
    discountValue: Number(v.discountValue) || 0,
    taxDeductionType: 'NONE',
    taxDeductionRate: 0,
    adjustment: 0,
    intraState: isIntraState(v.supplierStateCode, v.shipToStateCode),
  });
}
