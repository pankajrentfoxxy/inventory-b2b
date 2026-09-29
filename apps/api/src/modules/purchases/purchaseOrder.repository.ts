/**
 * Validation and resolution helpers for purchase orders: tenant-scoped lookups, master checks,
 * item / tax snapshots and the delivery-address snapshot.
 */
import type { Prisma } from '@prisma/client';
import type { PurchaseOrderPayload } from '@b2b/shared';
import { prisma, type PrismaTx } from '../../lib/prisma.js';
import { notFound, validationError, type ErrorDetail } from '../../lib/errors.js';
import { validateCustomValue } from '../vendors/vendor.repository.js';

export type Db = PrismaTx | typeof prisma;

export async function findLivePoOrThrow<I extends Prisma.PurchaseOrderInclude>(db: Db, organizationId: string, id: string, include?: I) {
  const po = await db.purchaseOrder.findFirst({ where: { id, organizationId, deletedAt: null }, include });
  if (!po) throw notFound('Purchase order not found', 'PURCHASE_ORDER_NOT_FOUND');
  return po as Prisma.PurchaseOrderGetPayload<{ include: I }>;
}

export interface DeliverySnapshot {
  name: string | null;
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

export interface ResolvedLine {
  id: string | null;
  itemId: string;
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
}

export interface ResolvedPurchaseOrder {
  vendor: { id: string; displayName: string; status: string; sourceOfSupplyCode: string | null; currencyCode: string; paymentTermId: string | null };
  delivery: { deliveryLocationId: string | null; snapshot: DeliverySnapshot; placeOfSupplyCode: string | null };
  sourceOfSupplyCode: string | null;
  lines: ResolvedLine[];
  intraState: boolean;
  customFieldRows: { organizationId: string; fieldId: string; value: Prisma.InputJsonValue }[];
}

/**
 * Confirms every referenced record belongs to the organization, then builds the snapshots the
 * PO stores. `allowInactiveVendor` lets an existing PO be edited after its vendor was deactivated.
 */
export async function resolvePurchaseOrder(
  db: Db,
  organizationId: string,
  p: PurchaseOrderPayload,
  opts: { allowInactiveVendor?: boolean } = {},
): Promise<ResolvedPurchaseOrder> {
  const details: ErrorDetail[] = [];
  const itemIds = [...new Set(p.lines.map((l) => l.itemId))];
  const taxIds = [...new Set(p.lines.map((l) => l.taxId).filter((t): t is string => Boolean(t)))];

  const [vendor, location, deliveryLocation, paymentTerm, items, taxes, fieldDefs, states] = await Promise.all([
    db.vendor.findFirst({ where: { id: p.vendorId, organizationId, deletedAt: null }, include: { sourceOfSupply: { select: { code: true } } } }),
    p.locationId ? db.location.findFirst({ where: { id: p.locationId, organizationId, isActive: true } }) : Promise.resolve(null),
    p.deliveryType === 'LOCATION' && p.deliveryLocationId ? db.location.findFirst({ where: { id: p.deliveryLocationId, organizationId, isActive: true } }) : Promise.resolve(null),
    p.paymentTermId ? db.paymentTerm.findFirst({ where: { id: p.paymentTermId, organizationId, isActive: true } }) : Promise.resolve(null),
    db.item.findMany({ where: { id: { in: itemIds }, organizationId, deletedAt: null } }),
    taxIds.length ? db.tax.findMany({ where: { id: { in: taxIds }, organizationId, isActive: true } }) : Promise.resolve([]),
    db.customFieldDefinition.findMany({ where: { organizationId, entityType: 'PURCHASE_ORDER', isActive: true } }),
    db.sourceOfSupply.findMany({ where: { organizationId, isActive: true }, select: { code: true } }),
  ]);

  const stateCodes = new Set(states.map((s) => s.code));
  if (p.sourceOfSupplyCode && !stateCodes.has(p.sourceOfSupplyCode)) details.push({ path: 'sourceOfSupplyCode', message: 'Select a valid source of supply' });
  if (p.destinationOfSupplyCode && !stateCodes.has(p.destinationOfSupplyCode)) details.push({ path: 'destinationOfSupplyCode', message: 'Select a valid destination of supply' });

  if (!vendor) details.push({ path: 'vendorId', message: 'Select a valid vendor' });
  else if (vendor.status !== 'ACTIVE' && !opts.allowInactiveVendor) {
    details.push({ path: 'vendorId', message: `${vendor.displayName} is inactive and cannot be used on new purchase orders` });
  }
  if (p.locationId && !location) details.push({ path: 'locationId', message: 'Select a valid location' });
  if (p.deliveryType === 'LOCATION' && !deliveryLocation) details.push({ path: 'deliveryLocationId', message: 'Select a valid delivery location' });
  if (p.paymentTermId && !paymentTerm) details.push({ path: 'paymentTermId', message: 'Select a valid payment term' });

  const itemMap = new Map(items.map((i) => [i.id, i]));
  const taxMap = new Map(taxes.map((t) => [t.id, t]));
  const lines: ResolvedLine[] = [];
  p.lines.forEach((l, index) => {
    const item = itemMap.get(l.itemId);
    if (!item) {
      details.push({ path: `lines.${index}.itemId`, message: 'Select a valid item' });
      return;
    }
    if (!item.isActive) details.push({ path: `lines.${index}.itemId`, message: `${item.name} is inactive` });
    const tax = l.taxId ? taxMap.get(l.taxId) : null;
    if (l.taxId && !tax) details.push({ path: `lines.${index}.taxId`, message: 'Select a valid tax' });
    lines.push({
      id: l.id,
      itemId: item.id,
      name: item.name,
      sku: item.sku,
      description: l.description,
      hsnCode: item.hsnCode,
      quantity: l.quantity,
      unit: l.unit ?? item.unit,
      rate: l.rate,
      taxId: tax?.id ?? null,
      taxName: tax?.name ?? null,
      taxRate: tax ? Number(tax.rate) : 0,
    });
  });

  // custom fields
  const defs = new Map(fieldDefs.map((f) => [f.id, f]));
  p.customFields.forEach((cf, index) => {
    const def = defs.get(cf.fieldId);
    if (!def) {
      details.push({ path: `customFields.${index}.value`, message: 'Unknown custom field' });
      return;
    }
    const problem = validateCustomValue(def.fieldType, def.options, cf.value);
    if (problem) details.push({ path: `customFields.${index}.value`, message: `${def.label}: ${problem}` });
  });
  for (const def of fieldDefs) {
    if (!def.isRequired) continue;
    const provided = p.customFields.find((cf) => cf.fieldId === def.id);
    if (provided === undefined || provided.value === null || provided.value === '') {
      const index = p.customFields.findIndex((cf) => cf.fieldId === def.id);
      details.push({ path: index >= 0 ? `customFields.${index}.value` : 'customFields', message: `${def.label} is required` });
    }
  }

  if (details.length) throw validationError(details);

  const snapshot: DeliverySnapshot =
    p.deliveryType === 'LOCATION' && deliveryLocation
      ? {
          name: deliveryLocation.name,
          attention: deliveryLocation.attention,
          addressLine1: deliveryLocation.addressLine1,
          addressLine2: deliveryLocation.addressLine2,
          city: deliveryLocation.city,
          state: deliveryLocation.state,
          stateCode: deliveryLocation.stateCode,
          postalCode: deliveryLocation.postalCode,
          countryCode: deliveryLocation.countryCode,
          phone: deliveryLocation.phone,
        }
      : {
          name: null,
          attention: p.deliveryAddress?.attention ?? null,
          addressLine1: p.deliveryAddress?.addressLine1 ?? null,
          addressLine2: p.deliveryAddress?.addressLine2 ?? null,
          city: p.deliveryAddress?.city ?? null,
          state: p.deliveryAddress?.state ?? null,
          stateCode: p.deliveryAddress?.stateCode ?? null,
          postalCode: p.deliveryAddress?.postalCode ?? null,
          countryCode: p.deliveryAddress?.countryCode ?? 'IN',
          phone: p.deliveryAddress?.phone ?? null,
        };

  const vendorState = vendor!.sourceOfSupply?.code ?? null;
  // Explicit overrides win; otherwise vendor state -> delivery state (Zoho's Source / Destination of Supply).
  const sourceOfSupplyCode = p.sourceOfSupplyCode ?? vendorState;
  const placeOfSupplyCode = p.destinationOfSupplyCode ?? snapshot.stateCode ?? null;
  const intraState = Boolean(placeOfSupplyCode && sourceOfSupplyCode && placeOfSupplyCode === sourceOfSupplyCode);

  return {
    vendor: { id: vendor!.id, displayName: vendor!.displayName, status: vendor!.status, sourceOfSupplyCode: vendorState, currencyCode: vendor!.currencyCode, paymentTermId: vendor!.paymentTermId },
    delivery: { deliveryLocationId: p.deliveryType === 'LOCATION' ? (deliveryLocation?.id ?? null) : null, snapshot, placeOfSupplyCode },
    sourceOfSupplyCode,
    lines,
    intraState,
    customFieldRows: p.customFields
      .filter((cf) => cf.value !== null && cf.value !== '')
      .map((cf) => ({ organizationId, fieldId: cf.fieldId, value: cf.value as Prisma.InputJsonValue })),
  };
}
