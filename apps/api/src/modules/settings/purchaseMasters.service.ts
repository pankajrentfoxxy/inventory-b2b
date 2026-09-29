/** Purchasing masters: locations (warehouses), taxes, numbering and the PO form bundle. */
import type { LocationPayload, TaxPayload } from '@b2b/shared';
import { COUNTRIES, INDIAN_STATES, TCS_PRESETS, TDS_PRESETS, digitsOnly } from '@b2b/shared';
import { prisma } from '../../lib/prisma.js';
import { conflict, notFound } from '../../lib/errors.js';
import { getSequence } from '../purchases/documentNumber.service.js';

/* ---- locations ---------------------------------------------------------- */

export function serializeLocation(l: {
  id: string; name: string; type: string; attention: string | null; addressLine1: string | null; addressLine2: string | null; city: string | null; state: string | null; stateCode: string | null; postalCode: string | null; countryCode: string; phone: string | null; email: string | null; gstin: string | null; isPrimary: boolean; isActive: boolean;
}) {
  const { id, name, type, attention, addressLine1, addressLine2, city, state, stateCode, postalCode, countryCode, phone, email, gstin, isPrimary, isActive } = l;
  return { id, name, type, attention, addressLine1, addressLine2, city, state, stateCode, postalCode, countryCode, phone, email, gstin, isPrimary, isActive };
}

export async function listLocations(organizationId: string, activeOnly = false) {
  const rows = await prisma.location.findMany({ where: { organizationId, ...(activeOnly ? { isActive: true } : {}) }, orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] });
  return rows.map(serializeLocation);
}

function locationData(p: LocationPayload) {
  return {
    name: p.name,
    type: p.type,
    attention: p.attention,
    addressLine1: p.addressLine1,
    addressLine2: p.addressLine2,
    city: p.city,
    state: p.state,
    stateCode: p.stateCode,
    postalCode: p.postalCode,
    countryCode: p.countryCode,
    phone: p.phone ? digitsOnly(p.phone) : null,
    email: p.email ? p.email.toLowerCase() : null,
    gstin: p.gstin,
    isActive: p.isActive,
  };
}

export async function createLocation(organizationId: string, p: LocationPayload) {
  const clash = await prisma.location.findUnique({ where: { organizationId_name: { organizationId, name: p.name } } });
  if (clash) throw conflict(`A location named "${p.name}" already exists`, 'DUPLICATE_LOCATION');
  return prisma.$transaction(async (tx) => {
    const count = await tx.location.count({ where: { organizationId } });
    const makePrimary = p.isPrimary || count === 0;
    if (makePrimary) await tx.location.updateMany({ where: { organizationId, isPrimary: true }, data: { isPrimary: false } });
    const created = await tx.location.create({ data: { organizationId, ...locationData(p), isPrimary: makePrimary } });
    return serializeLocation(created);
  });
}

export async function updateLocation(organizationId: string, id: string, p: Partial<LocationPayload>) {
  const existing = await prisma.location.findFirst({ where: { id, organizationId } });
  if (!existing) throw notFound('Location not found');
  if (p.name && p.name !== existing.name) {
    const clash = await prisma.location.findUnique({ where: { organizationId_name: { organizationId, name: p.name } } });
    if (clash) throw conflict(`A location named "${p.name}" already exists`, 'DUPLICATE_LOCATION');
  }
  if (existing.isPrimary && (p.isPrimary === false || p.isActive === false)) {
    throw conflict('Make another location primary before demoting or deactivating this one', 'PRIMARY_LOCATION_LOCKED');
  }
  return prisma.$transaction(async (tx) => {
    if (p.isPrimary) await tx.location.updateMany({ where: { organizationId, isPrimary: true }, data: { isPrimary: false } });
    const merged = { ...existing, ...p } as LocationPayload;
    const updated = await tx.location.update({ where: { id }, data: { ...locationData(merged), isPrimary: p.isPrimary ?? existing.isPrimary } });
    return serializeLocation(updated);
  });
}

/* ---- taxes --------------------------------------------------------------- */

const serializeTax = (t: { id: string; name: string; rate: unknown; isDefault: boolean; isActive: boolean }) => ({ id: t.id, name: t.name, rate: Number(t.rate), isDefault: t.isDefault, isActive: t.isActive });

export async function listTaxes(organizationId: string, activeOnly = false) {
  const rows = await prisma.tax.findMany({ where: { organizationId, ...(activeOnly ? { isActive: true } : {}) }, orderBy: [{ rate: 'asc' }, { name: 'asc' }] });
  return rows.map(serializeTax);
}

export async function createTax(organizationId: string, p: TaxPayload) {
  const clash = await prisma.tax.findUnique({ where: { organizationId_name: { organizationId, name: p.name } } });
  if (clash) throw conflict(`A tax named "${p.name}" already exists`, 'DUPLICATE_TAX');
  return prisma.$transaction(async (tx) => {
    if (p.isDefault) await tx.tax.updateMany({ where: { organizationId, isDefault: true }, data: { isDefault: false } });
    return serializeTax(await tx.tax.create({ data: { organizationId, ...p } }));
  });
}

export async function updateTax(organizationId: string, id: string, p: Partial<TaxPayload>) {
  const existing = await prisma.tax.findFirst({ where: { id, organizationId } });
  if (!existing) throw notFound('Tax not found');
  if (p.name && p.name !== existing.name) {
    const clash = await prisma.tax.findUnique({ where: { organizationId_name: { organizationId, name: p.name } } });
    if (clash) throw conflict(`A tax named "${p.name}" already exists`, 'DUPLICATE_TAX');
  }
  return prisma.$transaction(async (tx) => {
    if (p.isDefault) await tx.tax.updateMany({ where: { organizationId, isDefault: true }, data: { isDefault: false } });
    return serializeTax(await tx.tax.update({ where: { id }, data: p }));
  });
}

/* ---- PO form bundle --------------------------------------------------------- */

export async function getPurchaseOrderFormOptions(organizationId: string) {
  const [locations, taxes, paymentTerms, customFields, nextNumber] = await Promise.all([
    listLocations(organizationId, true),
    listTaxes(organizationId, true),
    prisma.paymentTerm.findMany({ where: { organizationId, isActive: true }, orderBy: { days: 'asc' } }),
    prisma.customFieldDefinition.findMany({ where: { organizationId, entityType: 'PURCHASE_ORDER', isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    getSequence(organizationId, 'PURCHASE_ORDER'),
  ]);
  return {
    locations,
    taxes,
    paymentTerms: paymentTerms.map((p) => ({ id: p.id, name: p.name, days: p.days, isDefault: p.isDefault })),
    customFields: customFields.map((f) => ({ id: f.id, key: f.key, label: f.label, fieldType: f.fieldType, options: Array.isArray(f.options) ? (f.options as string[]) : [], isRequired: f.isRequired })),
    nextNumber,
    countries: COUNTRIES,
    indianStates: INDIAN_STATES,
    tdsPresets: TDS_PRESETS,
    tcsPresets: TCS_PRESETS,
  };
}
