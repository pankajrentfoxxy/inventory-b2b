/**
 * Form model for PurchaseOrderForm: string-based values for controlled inputs plus mappers
 * to/from the API payload. The shared zod schema is the single validator.
 */
import type { UseFormSetError } from 'react-hook-form';
import { computePurchaseOrderTotals, purchaseOrderSchema, type DeliveryAddressType, type DiscountType, type PurchaseOrderPayload, type TaxDeductionType } from '@b2b/shared';
import type { ApiError } from '../../../lib/api';
import { applyServerErrors as applyFieldErrors } from '../../../lib/validation';
import { todayISO } from '../../../lib/utils';
import type { PoDetail, PoFormOptions } from '../types';

export interface PoLineFormValues {
  id: string | null;
  itemId: string;
  /** UI-only snapshot so the picker can show the label without a lookup. */
  itemName: string;
  itemSku: string;
  description: string;
  quantity: string;
  unit: string;
  rate: string;
  taxId: string;
  /** UI-only: already received (edit mode) to block reductions below it. */
  receivedQuantity: number;
}

export interface DeliveryAddressFormValues {
  attention: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  stateCode: string;
  postalCode: string;
  countryCode: string;
  phone: string;
}

export interface PoFormValues {
  vendorId: string;
  vendorName: string;
  locationId: string;
  deliveryType: DeliveryAddressType;
  deliveryLocationId: string;
  deliveryAddress: DeliveryAddressFormValues;
  sourceOfSupplyCode: string;
  destinationOfSupplyCode: string;
  purchaseOrderNumber: string;
  referenceNumber: string;
  orderDate: string;
  expectedDeliveryDate: string;
  paymentTermId: string;
  shipmentPreference: string;
  lines: PoLineFormValues[];
  discountType: DiscountType;
  discountValue: string;
  taxDeductionType: TaxDeductionType;
  taxDeductionRate: string;
  taxDeductionLabel: string;
  adjustment: string;
  adjustmentLabel: string;
  notes: string;
  terms: string;
  customFields: { fieldId: string; value: string | number | boolean | null }[];
}

export const emptyLine = (defaultTaxId = ''): PoLineFormValues => ({
  id: null,
  itemId: '',
  itemName: '',
  itemSku: '',
  description: '',
  quantity: '1',
  unit: '',
  rate: '0',
  taxId: defaultTaxId,
  receivedQuantity: 0,
});

export const emptyDeliveryAddress = (): DeliveryAddressFormValues => ({
  attention: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  stateCode: '',
  postalCode: '',
  countryCode: 'IN',
  phone: '',
});

export function defaultPoValues(options: PoFormOptions, preset: { vendorId?: string; vendorName?: string } = {}): PoFormValues {
  const primary = options.locations.find((l) => l.isPrimary) ?? options.locations[0];
  const defaultTax = options.taxes.find((t) => t.isDefault)?.id ?? '';
  return {
    vendorId: preset.vendorId ?? '',
    vendorName: preset.vendorName ?? '',
    locationId: primary?.id ?? '',
    deliveryType: 'LOCATION',
    deliveryLocationId: primary?.id ?? '',
    deliveryAddress: emptyDeliveryAddress(),
    sourceOfSupplyCode: '',
    destinationOfSupplyCode: primary?.stateCode ?? '',
    purchaseOrderNumber: '',
    referenceNumber: '',
    orderDate: todayISO(),
    expectedDeliveryDate: '',
    paymentTermId: options.paymentTerms.find((p) => p.isDefault)?.id ?? '',
    shipmentPreference: '',
    lines: [emptyLine(defaultTax)],
    discountType: 'PERCENT',
    discountValue: '0',
    taxDeductionType: 'NONE',
    taxDeductionRate: '0',
    taxDeductionLabel: '',
    adjustment: '0',
    adjustmentLabel: 'Adjustment',
    notes: '',
    terms: '',
    customFields: options.customFields.map((f) => ({ fieldId: f.id, value: f.fieldType === 'BOOLEAN' ? false : null })),
  };
}

export function poToFormValues(po: PoDetail, options: PoFormOptions): PoFormValues {
  const base = defaultPoValues(options);
  const cf = new Map(po.customFields.map((c) => [c.fieldId, c.value]));
  return {
    ...base,
    vendorId: po.vendorId,
    vendorName: po.vendor.displayName,
    locationId: po.locationId ?? '',
    deliveryType: po.deliveryType,
    deliveryLocationId: po.deliveryLocationId ?? '',
    deliveryAddress: {
      attention: po.deliveryAddress?.attention ?? '',
      addressLine1: po.deliveryAddress?.addressLine1 ?? '',
      addressLine2: po.deliveryAddress?.addressLine2 ?? '',
      city: po.deliveryAddress?.city ?? '',
      state: po.deliveryAddress?.state ?? '',
      stateCode: po.deliveryAddress?.stateCode ?? '',
      postalCode: po.deliveryAddress?.postalCode ?? '',
      countryCode: po.deliveryAddress?.countryCode ?? 'IN',
      phone: po.deliveryAddress?.phone ?? '',
    },
    sourceOfSupplyCode: po.sourceOfSupplyCode ?? po.vendor.sourceOfSupply?.code ?? '',
    destinationOfSupplyCode: po.placeOfSupplyCode ?? '',
    purchaseOrderNumber: po.purchaseOrderNumber,
    referenceNumber: po.referenceNumber ?? '',
    orderDate: po.orderDate,
    expectedDeliveryDate: po.expectedDeliveryDate ?? '',
    paymentTermId: po.paymentTermId ?? '',
    shipmentPreference: po.shipmentPreference ?? '',
    lines: po.lines.map((l) => ({
      id: l.id,
      itemId: l.itemId ?? '',
      itemName: l.name,
      itemSku: l.sku ?? '',
      description: l.description ?? '',
      quantity: String(l.quantity),
      unit: l.unit ?? '',
      rate: String(l.rate),
      taxId: l.taxId ?? '',
      receivedQuantity: l.receivedQuantity,
    })),
    discountType: po.discountType,
    discountValue: String(po.discountValue),
    taxDeductionType: po.taxDeductionType,
    taxDeductionRate: String(po.taxDeductionRate),
    taxDeductionLabel: po.taxDeductionLabel ?? '',
    adjustment: String(po.adjustment),
    adjustmentLabel: po.adjustmentLabel ?? 'Adjustment',
    notes: po.notes ?? '',
    terms: po.terms ?? '',
    customFields: options.customFields.map((f) => ({ fieldId: f.id, value: cf.has(f.id) ? (cf.get(f.id) as string | number | boolean | null) : f.fieldType === 'BOOLEAN' ? false : null })),
  };
}

/** Runs the shared schema to produce exactly what the API expects. UI-only fields are stripped. */
export function toPoPayload(values: PoFormValues): PurchaseOrderPayload {
  return purchaseOrderSchema.parse({
    ...values,
    deliveryAddress: values.deliveryType === 'CUSTOM' ? values.deliveryAddress : null,
    deliveryLocationId: values.deliveryType === 'LOCATION' ? values.deliveryLocationId : null,
  });
}

/** Live totals for the summary panel; same arithmetic as the server. */
export function computeFormTotals(values: PoFormValues, taxes: PoFormOptions['taxes'], intraState: boolean) {
  const rateOf = new Map(taxes.map((t) => [t.id, t.rate]));
  return computePurchaseOrderTotals({
    lines: values.lines.map((l) => ({ quantity: Number(l.quantity) || 0, rate: Number(l.rate) || 0, taxRate: l.taxId ? (rateOf.get(l.taxId) ?? 0) : 0 })),
    discountType: values.discountType,
    discountValue: Number(values.discountValue) || 0,
    taxDeductionType: values.taxDeductionType,
    taxDeductionRate: Number(values.taxDeductionRate) || 0,
    adjustment: Number(values.adjustment) || 0,
    intraState,
  });
}

export function applyServerErrors(error: ApiError, setError: UseFormSetError<PoFormValues>) {
  return applyFieldErrors(setError, error);
}

export function formatAddress(a: { attention?: string | null; addressLine1?: string | null; addressLine2?: string | null; city?: string | null; state?: string | null; postalCode?: string | null; countryCode?: string | null; phone?: string | null } | null | undefined): string[] {
  if (!a) return [];
  const cityLine = [a.city, a.state].filter(Boolean).join(', ');
  return [a.attention, a.addressLine1, a.addressLine2, cityLine, [a.countryCode === 'IN' ? 'India' : a.countryCode, a.postalCode].filter(Boolean).join(' - ')].filter((l): l is string => Boolean(l && l.trim()));
}
