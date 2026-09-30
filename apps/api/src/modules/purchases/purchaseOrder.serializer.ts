import type { Prisma } from '@prisma/client';
import type { TaxBreakupRow } from '@b2b/shared';

const n = (d: Prisma.Decimal | number | null | undefined) => (d === null || d === undefined ? null : Number(d));
const n0 = (d: Prisma.Decimal | number | null | undefined) => Number(d ?? 0);
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export const poListInclude = {
  vendor: { select: { id: true, displayName: true } },
  _count: { select: { lines: true, receives: true } },
} satisfies Prisma.PurchaseOrderInclude;
export type PoListRecord = Prisma.PurchaseOrderGetPayload<{ include: typeof poListInclude }>;

export const poDetailInclude = {
  vendor: {
    select: {
      id: true,
      displayName: true,
      companyName: true,
      email: true,
      workPhoneCountryCode: true,
      workPhone: true,
      gstin: true,
      status: true,
      currencyCode: true,
      gstTreatment: { select: { id: true, name: true } },
      sourceOfSupply: { select: { id: true, code: true, name: true } },
      paymentTerm: { select: { id: true, name: true, days: true } },
      addresses: { where: { type: 'BILLING' }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], take: 1 },
    },
  },
  location: { select: { id: true, name: true } },
  deliveryLocation: { select: { id: true, name: true } },
  paymentTerm: { select: { id: true, name: true, days: true } },
  lines: { orderBy: { lineNumber: 'asc' }, include: { item: { select: { id: true, name: true, sku: true, unit: true, isActive: true, deletedAt: true } } } },
  customFields: { include: { field: true } },
  receives: { orderBy: [{ receivedDate: 'desc' }, { createdAt: 'desc' }], select: { id: true, receiveNumber: true, receivedDate: true, totalQuantity: true, status: true, createdAt: true } },
  _count: { select: { documents: true } },
} satisfies Prisma.PurchaseOrderInclude;
export type PoDetailRecord = Prisma.PurchaseOrderGetPayload<{ include: typeof poDetailInclude }>;

/** Derived receipt progress shown in lists. */
export function receiveProgress(lines: { quantity: Prisma.Decimal | number; receivedQuantity: Prisma.Decimal | number }[]) {
  const ordered = lines.reduce((s, l) => s + n0(l.quantity), 0);
  const received = lines.reduce((s, l) => s + n0(l.receivedQuantity), 0);
  const state: 'NONE' | 'PARTIAL' | 'FULL' = received <= 0 ? 'NONE' : received + 1e-9 >= ordered ? 'FULL' : 'PARTIAL';
  return { ordered, received, state };
}

export function serializePoListItem(po: PoListRecord & { lines?: { quantity: Prisma.Decimal; receivedQuantity: Prisma.Decimal }[] }) {
  const progress = po.lines ? receiveProgress(po.lines) : null;
  return {
    id: po.id,
    purchaseOrderNumber: po.purchaseOrderNumber,
    referenceNumber: po.referenceNumber,
    orderDate: day(po.orderDate),
    expectedDeliveryDate: day(po.expectedDeliveryDate),
    vendor: po.vendor,
    status: po.status,
    version: po.version,
    receiveState: progress?.state ?? null,
    currencyCode: po.currencyCode,
    subTotal: n0(po.subTotal),
    total: n0(po.total),
    lineCount: po._count.lines,
    receiveCount: po._count.receives,
    createdAt: po.createdAt,
    updatedAt: po.updatedAt,
  };
}

export function serializePoLine(l: PoDetailRecord['lines'][number]) {
  const quantity = n0(l.quantity);
  const received = n0(l.receivedQuantity);
  return {
    id: l.id,
    lineNumber: l.lineNumber,
    itemId: l.itemId,
    item: l.item ? { id: l.item.id, name: l.item.name, sku: l.item.sku, unit: l.item.unit, available: l.item.isActive && !l.item.deletedAt } : null,
    name: l.name,
    sku: l.sku,
    description: l.description,
    hsnCode: l.hsnCode,
    quantity,
    unit: l.unit,
    rate: n0(l.rate),
    taxId: l.taxId,
    taxName: l.taxName,
    taxRate: n0(l.taxRate),
    amount: n0(l.amount),
    taxableAmount: n0(l.taxableAmount),
    taxAmount: n0(l.taxAmount),
    total: n0(l.total),
    receivedQuantity: received,
    remainingQuantity: Math.max(0, Math.round((quantity - received) * 1000) / 1000),
  };
}

export function serializePoDetail(po: PoDetailRecord) {
  const billing = po.vendor.addresses[0] ?? null;
  const progress = receiveProgress(po.lines);
  return {
    id: po.id,
    organizationId: po.organizationId,
    purchaseOrderNumber: po.purchaseOrderNumber,
    referenceNumber: po.referenceNumber,
    orderDate: day(po.orderDate),
    expectedDeliveryDate: day(po.expectedDeliveryDate),
    status: po.status,
    /** Send this back on PUT to get a 409 instead of silently overwriting a newer edit. */
    version: po.version,
    receiveState: progress.state,
    orderedQuantity: progress.ordered,
    receivedQuantity: progress.received,
    vendorId: po.vendorId,
    vendor: {
      id: po.vendor.id,
      displayName: po.vendor.displayName,
      companyName: po.vendor.companyName,
      email: po.vendor.email,
      phone: po.vendor.workPhone ? `${po.vendor.workPhoneCountryCode ?? ''} ${po.vendor.workPhone}`.trim() : null,
      gstin: po.vendor.gstin,
      status: po.vendor.status,
      gstTreatment: po.vendor.gstTreatment,
      sourceOfSupply: po.vendor.sourceOfSupply,
      billingAddress: billing
        ? { attention: billing.attention, addressLine1: billing.addressLine1, addressLine2: billing.addressLine2, city: billing.city, state: billing.state, stateCode: billing.stateCode, postalCode: billing.postalCode, countryCode: billing.countryCode, phone: billing.phone }
        : null,
    },
    locationId: po.locationId,
    location: po.location,
    deliveryType: po.deliveryType,
    deliveryLocationId: po.deliveryLocationId,
    deliveryLocation: po.deliveryLocation,
    deliveryAddress: (po.deliveryAddress as Record<string, string | null> | null) ?? null,
    sourceOfSupplyCode: po.sourceOfSupplyCode,
    placeOfSupplyCode: po.placeOfSupplyCode,
    isIntraState: po.isIntraState,
    paymentTermId: po.paymentTermId,
    paymentTerm: po.paymentTerm,
    shipmentPreference: po.shipmentPreference,
    currencyCode: po.currencyCode,
    lines: po.lines.map(serializePoLine),
    discountType: po.discountType,
    discountValue: n0(po.discountValue),
    taxDeductionType: po.taxDeductionType,
    taxDeductionRate: n0(po.taxDeductionRate),
    taxDeductionLabel: po.taxDeductionLabel,
    adjustment: n0(po.adjustment),
    adjustmentLabel: po.adjustmentLabel,
    subTotal: n0(po.subTotal),
    discountAmount: n0(po.discountAmount),
    taxTotal: n0(po.taxTotal),
    taxBreakup: (po.taxBreakup as unknown as TaxBreakupRow[]) ?? [],
    taxDeductionAmount: n0(po.taxDeductionAmount),
    total: n0(po.total),
    notes: po.notes,
    terms: po.terms,
    customFields: po.customFields.map((cf) => ({ fieldId: cf.fieldId, key: cf.field.key, label: cf.field.label, fieldType: cf.field.fieldType, value: cf.value })),
    receives: po.receives.map((r) => ({ id: r.id, receiveNumber: r.receiveNumber, receivedDate: day(r.receivedDate), totalQuantity: n0(r.totalQuantity), status: r.status, createdAt: r.createdAt })),
    counts: { documents: po._count.documents, receives: po.receives.filter((r) => r.status === 'RECEIVED').length },
    issuedAt: po.issuedAt,
    cancelledAt: po.cancelledAt,
    cancelReason: po.cancelReason,
    closedAt: po.closedAt,
    createdAt: po.createdAt,
    updatedAt: po.updatedAt,
    createdById: po.createdById,
    updatedById: po.updatedById,
  };
}
export type PoDetailDto = ReturnType<typeof serializePoDetail>;

export { n, n0, day };
