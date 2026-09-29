/**
 * Organization masters that drive the vendor form: GST treatments, sources of supply,
 * payment terms, currencies, custom field definitions and reporting tags.
 */
import type { z } from 'zod';
import {
  BANK_ACCOUNT_TYPES,
  BANK_ACCOUNT_TYPE_LABELS,
  COUNTRIES,
  INDIAN_STATES,
  SALUTATIONS,
  VENDOR_LANGUAGES,
  VENDOR_TYPES,
  VENDOR_TYPE_LABELS,
  type customFieldDefinitionSchema,
  type gstTreatmentSchema,
  type paymentTermSchema,
  type reportingTagSchema,
} from '@b2b/shared';
import { prisma } from '../../lib/prisma.js';
import { conflict, notFound } from '../../lib/errors.js';

/* ---- read bundle for the vendor form -------------------------------------- */

export async function getVendorFormOptions(organizationId: string) {
  const [gstTreatments, sourcesOfSupply, paymentTerms, currencies, customFields, reportingTags] = await Promise.all([
    prisma.gstTreatment.findMany({ where: { organizationId, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.sourceOfSupply.findMany({ where: { organizationId, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.paymentTerm.findMany({ where: { organizationId, isActive: true }, orderBy: [{ days: 'asc' }] }),
    prisma.currency.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
    prisma.customFieldDefinition.findMany({
      where: { organizationId, entityType: 'VENDOR', isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.reportingTag.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { options: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } },
    }),
  ]);

  return {
    gstTreatments: gstTreatments.map((g) => ({ id: g.id, code: g.code, name: g.name, description: g.description, requiresGstin: g.requiresGstin })),
    sourcesOfSupply: sourcesOfSupply.map((s) => ({ id: s.id, code: s.code, shortCode: s.shortCode, name: s.name, countryCode: s.countryCode })),
    paymentTerms: paymentTerms.map((p) => ({ id: p.id, name: p.name, days: p.days, isDefault: p.isDefault })),
    currencies: currencies.map((c) => ({ code: c.code, name: c.name, symbol: c.symbol })),
    customFields: customFields.map((f) => ({
      id: f.id,
      key: f.key,
      label: f.label,
      fieldType: f.fieldType,
      options: Array.isArray(f.options) ? (f.options as string[]) : [],
      isRequired: f.isRequired,
    })),
    reportingTags: reportingTags.map((t) => ({
      id: t.id,
      name: t.name,
      options: t.options.map((o) => ({ id: o.id, name: o.name })),
    })),
    salutations: SALUTATIONS,
    languages: VENDOR_LANGUAGES,
    countries: COUNTRIES,
    indianStates: INDIAN_STATES,
    vendorTypes: VENDOR_TYPES.map((v) => ({ value: v, label: VENDOR_TYPE_LABELS[v] })),
    bankAccountTypes: BANK_ACCOUNT_TYPES.map((v) => ({ value: v, label: BANK_ACCOUNT_TYPE_LABELS[v] })),
  };
}

/* ---- custom field definitions ------------------------------------------- */

type CustomFieldInput = z.output<typeof customFieldDefinitionSchema>;

function keyFromLabel(label: string) {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 50) || 'field'
  );
}

export async function listCustomFields(organizationId: string, entityType: CustomFieldInput['entityType'] = 'VENDOR') {
  return prisma.customFieldDefinition.findMany({
    where: { organizationId, entityType },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
}

export async function createCustomField(organizationId: string, input: CustomFieldInput) {
  let key = keyFromLabel(input.label);
  const clash = await prisma.customFieldDefinition.findUnique({
    where: { organizationId_entityType_key: { organizationId, entityType: input.entityType, key } },
  });
  if (clash) key = `${key}_${Date.now().toString(36)}`;
  return prisma.customFieldDefinition.create({
    data: {
      organizationId,
      entityType: input.entityType,
      key,
      label: input.label,
      fieldType: input.fieldType,
      options: input.fieldType === 'DROPDOWN' ? input.options : undefined,
      isRequired: input.isRequired,
      isActive: input.isActive,
      sortOrder: input.sortOrder,
    },
  });
}

export async function updateCustomField(organizationId: string, id: string, input: Partial<CustomFieldInput>) {
  const existing = await prisma.customFieldDefinition.findFirst({ where: { id, organizationId } });
  if (!existing) throw notFound('Custom field not found');
  // The type is immutable once values may exist; changing it would silently corrupt stored data.
  if (input.fieldType && input.fieldType !== existing.fieldType) {
    throw conflict('The type of an existing custom field cannot be changed. Create a new field instead.', 'FIELD_TYPE_LOCKED');
  }
  return prisma.customFieldDefinition.update({
    where: { id },
    data: {
      label: input.label,
      options: existing.fieldType === 'DROPDOWN' && input.options ? input.options : undefined,
      isRequired: input.isRequired,
      isActive: input.isActive,
      sortOrder: input.sortOrder,
    },
  });
}

/* ---- reporting tags ------------------------------------------------------- */

type ReportingTagInput = z.output<typeof reportingTagSchema>;

export async function listReportingTags(organizationId: string) {
  const tags = await prisma.reportingTag.findMany({
    where: { organizationId },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { options: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }, _count: { select: { vendorTags: true } } },
  });
  return tags.map((t) => ({
    id: t.id,
    name: t.name,
    isActive: t.isActive,
    usageCount: t._count.vendorTags,
    options: t.options.map((o) => ({ id: o.id, name: o.name, isActive: o.isActive })),
  }));
}

export async function createReportingTag(organizationId: string, input: ReportingTagInput) {
  const clash = await prisma.reportingTag.findUnique({ where: { organizationId_name: { organizationId, name: input.name } } });
  if (clash) throw conflict(`A tag named "${input.name}" already exists`, 'DUPLICATE_TAG');
  const count = await prisma.reportingTag.count({ where: { organizationId } });
  return prisma.reportingTag.create({
    data: {
      organizationId,
      name: input.name,
      isActive: input.isActive,
      sortOrder: count,
      options: { create: dedupe(input.options).map((name, i) => ({ name, sortOrder: i })) },
    },
    include: { options: true },
  });
}

/** Options are reconciled by name: kept, added, or deactivated (never deleted, vendors may reference them). */
export async function updateReportingTag(organizationId: string, id: string, input: Partial<ReportingTagInput>) {
  const existing = await prisma.reportingTag.findFirst({ where: { id, organizationId }, include: { options: true } });
  if (!existing) throw notFound('Reporting tag not found');
  if (input.name && input.name !== existing.name) {
    const clash = await prisma.reportingTag.findUnique({ where: { organizationId_name: { organizationId, name: input.name } } });
    if (clash) throw conflict(`A tag named "${input.name}" already exists`, 'DUPLICATE_TAG');
  }
  return prisma.$transaction(async (tx) => {
    await tx.reportingTag.update({ where: { id }, data: { name: input.name, isActive: input.isActive } });
    if (input.options) {
      const wanted = dedupe(input.options);
      const wantedSet = new Set(wanted.map((w) => w.toLowerCase()));
      for (const opt of existing.options) {
        const keep = wantedSet.has(opt.name.toLowerCase());
        if (keep !== opt.isActive) await tx.reportingTagOption.update({ where: { id: opt.id }, data: { isActive: keep } });
      }
      const known = new Set(existing.options.map((o) => o.name.toLowerCase()));
      const toAdd = wanted.filter((w) => !known.has(w.toLowerCase()));
      if (toAdd.length) {
        await tx.reportingTagOption.createMany({
          data: toAdd.map((name, i) => ({ tagId: id, name, sortOrder: existing.options.length + i })),
        });
      }
    }
    return tx.reportingTag.findUniqueOrThrow({ where: { id }, include: { options: { orderBy: { sortOrder: 'asc' } } } });
  });
}

function dedupe(values: string[]) {
  const seen = new Set<string>();
  return values.filter((v) => {
    const k = v.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ---- GST treatments & payment terms -------------------------------------- */

type GstTreatmentInput = z.output<typeof gstTreatmentSchema>;
type PaymentTermInput = z.output<typeof paymentTermSchema>;

export async function listGstTreatments(organizationId: string) {
  return prisma.gstTreatment.findMany({ where: { organizationId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
}

export async function createGstTreatment(organizationId: string, input: GstTreatmentInput) {
  const clash = await prisma.gstTreatment.findUnique({ where: { organizationId_code: { organizationId, code: input.code } } });
  if (clash) throw conflict(`GST treatment code "${input.code}" already exists`, 'DUPLICATE_CODE');
  return prisma.gstTreatment.create({ data: { organizationId, ...input } });
}

export async function updateGstTreatment(organizationId: string, id: string, input: Partial<GstTreatmentInput>) {
  const existing = await prisma.gstTreatment.findFirst({ where: { id, organizationId } });
  if (!existing) throw notFound('GST treatment not found');
  const { code: _ignored, ...rest } = input;
  return prisma.gstTreatment.update({ where: { id }, data: rest });
}

export async function listPaymentTerms(organizationId: string) {
  return prisma.paymentTerm.findMany({ where: { organizationId }, orderBy: [{ days: 'asc' }] });
}

export async function createPaymentTerm(organizationId: string, input: PaymentTermInput) {
  const clash = await prisma.paymentTerm.findUnique({ where: { organizationId_name: { organizationId, name: input.name } } });
  if (clash) throw conflict(`Payment term "${input.name}" already exists`, 'DUPLICATE_NAME');
  return prisma.$transaction(async (tx) => {
    if (input.isDefault) await tx.paymentTerm.updateMany({ where: { organizationId, isDefault: true }, data: { isDefault: false } });
    return tx.paymentTerm.create({ data: { organizationId, ...input } });
  });
}

export async function updatePaymentTerm(organizationId: string, id: string, input: Partial<PaymentTermInput>) {
  const existing = await prisma.paymentTerm.findFirst({ where: { id, organizationId } });
  if (!existing) throw notFound('Payment term not found');
  return prisma.$transaction(async (tx) => {
    if (input.isDefault) await tx.paymentTerm.updateMany({ where: { organizationId, isDefault: true }, data: { isDefault: false } });
    return tx.paymentTerm.update({ where: { id }, data: input });
  });
}
