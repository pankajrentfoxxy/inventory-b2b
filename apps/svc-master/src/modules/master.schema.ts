import { z } from 'zod';
import { gstinField, hsnField, optionalText, requiredText } from '@b2b/shared';
import { LAPTOP_SPEC_KINDS } from '@b2b/contracts';
import { DOC_TYPES } from './defaults.js';

const code = (label: string, max: number) => requiredText(label, max, { min: 1, transform: 'upper' });
export const statusQuery = z.enum(['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED']);

export const skuSchema = z.string().trim().min(1, 'SKU is required').max(40, 'SKU must be at most 40 characters').refine((v) => v.split('').every((c) => /[A-Za-z0-9._/-]/.test(c)), 'SKU may contain letters, digits, dot, underscore, slash and dash');

export const productSchema = z.object({
  sku: skuSchema,
  name: requiredText('Name', 200, { min: 2 }),
  description: optionalText(2000, { multiline: true }, 'Description'),
  type: z.enum(['GOODS', 'SERVICE']).default('GOODS'),
  trackInventory: z.boolean().optional(),
  isSerialized: z.boolean().default(false),
  requiresImei: z.boolean().default(false),
  serialPattern: optionalText(200, {}, 'Serial pattern'),
  qcRequired: z.boolean().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  brandId: z.string().uuid().nullable().optional(),
  unitId: z.string().uuid(),
  hsnId: z.string().uuid().nullable().optional(),
  taxRateId: z.string().uuid().nullable().optional(),
  defaultWarrantyId: z.string().uuid().nullable().optional(),
  purchasePrice: z.number().nonnegative().nullable().optional(),
  sellingPrice: z.number().nonnegative().nullable().optional(),
  reorderLevel: z.number().nonnegative().nullable().optional(),
  attributes: z.record(z.unknown()).default({}),
  customFields: z.record(z.unknown()).default({}),
  /** Create as ACTIVE directly (skips DRAFT). */
  activate: z.boolean().default(false),
});
export type ProductInput = z.output<typeof productSchema>;
export const productPatchSchema = productSchema.omit({ activate: true }).partial();

export const productListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: statusQuery.optional(),
  type: z.enum(['GOODS', 'SERVICE']).optional(),
  categoryId: z.string().uuid().optional(),
  brandId: z.string().uuid().optional(),
  isSerialized: z.enum(['true', 'false']).optional(),
  trackInventory: z.enum(['true', 'false']).optional(),
  /** true = laptop configurations only */
  laptop: z.enum(['true', 'false']).optional(),
  modelId: z.string().uuid().optional(),
  generationId: z.string().uuid().optional(),
  processorId: z.string().uuid().optional(),
  ramId: z.string().uuid().optional(),
  ssdId: z.string().uuid().optional(),
  gpuId: z.string().uuid().optional(),
  screenSizeId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export const importSchema = z.object({ rows: z.array(productSchema.omit({ activate: true })).min(1).max(1000), activate: z.boolean().default(false) });

export const unitSchema = z.object({ code: code('Unit code', 10), name: requiredText('Name', 50), decimals: z.number().int().min(0).max(3).default(0), uqc: optionalText(10, { transform: 'upper' }, 'UQC') });
export const GST_SLABS = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40] as const;
export const taxRateSchema = z.object({ name: requiredText('Name', 50), gstRate: z.number().refine((v) => (GST_SLABS as readonly number[]).includes(v), 'GST rate must be one of the notified slabs'), cessRate: z.number().min(0).default(0), effectiveFrom: z.string().date().default(() => new Date().toISOString().slice(0, 10)), effectiveTo: z.string().date().nullable().optional() });
export const hsnSchema = z.object({ code: hsnField({ required: true }), kind: z.enum(['HSN', 'SAC']).default('HSN'), description: optionalText(300, {}, 'Description'), defaultTaxRateId: z.string().uuid().nullable().optional() });
export const categorySchema = z.object({ name: requiredText('Name', 100), parentId: z.string().uuid().nullable().optional() });
export const brandSchema = z.object({ name: requiredText('Name', 100) });
export const gradeSchema = z.object({ code: code('Grade code', 10), name: requiredText('Name', 50), sortOrder: z.number().int().min(0).default(0), sellable: z.boolean().default(true) });
export const warrantySchema = z.object({ name: requiredText('Name', 100), durationMonths: z.number().int().min(0), startsOn: z.enum(['INVOICE_DATE', 'DELIVERY_DATE']).default('INVOICE_DATE'), terms: optionalText(5000, { multiline: true }, 'Terms') });
export const paymentTermSchema = z.object({ name: requiredText('Name', 60), days: z.number().int().min(0), isDefault: z.boolean().default(false) });
export const customFieldSchema = z.object({ entity: z.enum(['PRODUCT', 'SUPPLIER', 'CUSTOMER', 'PURCHASE_ORDER', 'SALES_ORDER', 'GRN']), key: requiredText('Key', 40, { min: 1 }), label: requiredText('Label', 100), dataType: z.enum(['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT']), options: z.array(z.string()).optional(), required: z.boolean().default(false) });

export const addressSchema = z.object({ line1: requiredText('Address line 1', 200), line2: optionalText(200, {}, 'Address line 2'), city: requiredText('City', 100), state: optionalText(100, {}, 'State'), stateCode: z.string().length(2), pincode: z.string().length(6), country: z.string().length(2).default('IN') });
export const warehouseSchema = z.object({ code: code('Code', 20), name: requiredText('Name', 100), address: addressSchema, stateCode: z.string().length(2).optional(), gstin: gstinField({ required: false }), isDefault: z.boolean().default(false) });
export const warehousePatchSchema = warehouseSchema.omit({ code: true }).partial();
export const locationSchema = z.object({ code: code('Code', 20), name: optionalText(100, {}, 'Name'), purpose: z.enum(['RECEIVING', 'QC', 'STORAGE', 'PACKING', 'DISPATCH', 'QUARANTINE']).nullable().optional() });
export const binSchema = z.object({ code: code('Code', 20), capacity: z.number().positive().nullable().optional() });
export const numberingSchema = z.object({ prefixTemplate: z.string().min(1).max(40), padding: z.number().int().min(1).max(8).default(4), resetEachFy: z.boolean().default(true) });
export const docTypeParam = z.enum(DOC_TYPES);
export const statusChangeSchema = z.object({ reason: optionalText(300, {}, 'Reason') });

/* ---- laptop configurations ---------------------------------------------------------------- */

export const specKind = z.enum(LAPTOP_SPEC_KINDS);
const specCode = z.string().trim().min(1, 'Code is required').max(20, 'Code must be at most 20 characters').transform((v) => v.toUpperCase()).refine((v) => v.split('').every((c) => (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')), 'Code may contain letters and digits only');
export const specOptionSchema = z.object({
  kind: specKind,
  name: requiredText('Name', 100, { min: 1 }),
  /** SKU token; derived from the name when omitted. */
  code: specCode.optional(),
  /** Required for MODEL, not allowed otherwise. */
  brandId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
});
export type SpecOptionInput = z.output<typeof specOptionSchema>;
export const specOptionListQuery = z.object({ kind: specKind.optional(), brandId: z.string().uuid().optional(), includeInactive: z.enum(['true', 'false']).optional() });
export const specOptionStatusSchema = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) });

export const laptopSpecIdsSchema = z.object({
  brandId: z.string().uuid({ message: 'Select a brand' }),
  modelId: z.string().uuid({ message: 'Select a model' }),
  generationId: z.string().uuid({ message: 'Select a generation' }),
  processorId: z.string().uuid({ message: 'Select a processor' }),
  ramId: z.string().uuid({ message: 'Select the RAM' }),
  ssdId: z.string().uuid({ message: 'Select the SSD' }),
  gpuId: z.string().uuid({ message: 'Select the graphics' }),
  screenSizeId: z.string().uuid({ message: 'Select the screen size' }),
});
export type LaptopSpecIds = z.output<typeof laptopSpecIdsSchema>;
export const laptopSchema = laptopSpecIdsSchema.extend({
  /** Generated from the specs when omitted. */
  sku: skuSchema.optional(),
  /** Defaults to "<Brand> <Model>". */
  name: requiredText('Name', 200, { min: 2 }).optional(),
  description: optionalText(2000, { multiline: true }, 'Description'),
  serialPattern: optionalText(200, {}, 'Serial pattern'),
  hsnId: z.string().uuid().nullable().optional(),
  taxRateId: z.string().uuid().nullable().optional(),
  defaultWarrantyId: z.string().uuid().nullable().optional(),
  purchasePrice: z.number().nonnegative().nullable().optional(),
  sellingPrice: z.number().nonnegative().nullable().optional(),
  reorderLevel: z.number().nonnegative().nullable().optional(),
  activate: z.boolean().default(false),
});
export type LaptopInput = z.output<typeof laptopSchema>;
export const laptopPatchSchema = laptopSchema.omit({ activate: true }).partial();
export type LaptopPatch = z.output<typeof laptopPatchSchema>;
