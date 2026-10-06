import { z } from 'zod';
import { amountField, dateField, integerField, optionalDateField, optionalNotes, optionalText, optionalUuid, quantityField, uuidField } from '@b2b/shared';

/**
 * One PO line = one exact laptop configuration (`itemId` is the svc-master laptop product; its
 * eight specs are resolved and snapshotted server side, never taken from the client).
 */
export const poLineSchema = z.object({
  poLineId: z.string().uuid().optional(),
  itemId: uuidField('Laptop'),
  /** Laptops are serialized: whole units only. */
  orderedQty: quantityField('Quantity', { decimals: 0 }),
  /** Purchase rate per laptop. */
  unitPrice: z.number().finite().min(0),
  /** Overrides the product's default GST rate (e.g. concessional supplies). */
  taxRate: z.number().finite().min(0).max(100).nullish().transform((v) => v ?? null),
  /** Rental charged per laptop per month; separate from the purchase rate. */
  monthlyRentalAmount: amountField('Monthly rental amount'),
  /** Rental tenure in months. */
  tenureMonths: integerField('Tenure', { allowZero: false, max: 120 }),
});
export const poSchema = z.object({
  supplierId: uuidField('Supplier'),
  shipToWarehouseId: uuidField('Warehouse'),
  orderDate: dateField('Order date'),
  expectedDate: optionalDateField('Expected date'),
  paymentTermId: optionalUuid,
  discountType: z.enum(['PERCENT', 'AMOUNT']).default('PERCENT'),
  discountValue: z.number().finite().min(0).default(0),
  notes: optionalNotes(1000),
  terms: optionalNotes(2000, 'Terms'),
  lines: z.array(poLineSchema).min(1).max(200),
});
export type PoInput = z.infer<typeof poSchema>;
export const poPatchSchema = poSchema.partial();
export type PoPatch = z.infer<typeof poPatchSchema>;

export const reasonSchema = z.object({ reason: optionalText(500, {}, 'Reason') });
export const requiredReasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const commentSchema = z.object({ comment: optionalText(500, {}, 'Comment') });
export const reviseSchema = z.object({ reason: z.string().trim().min(3).max(500), lines: z.array(poLineSchema).min(1).max(200), expectedDate: optionalDateField('Expected date'), notes: optionalNotes(1000) });
export type ReviseInput = z.infer<typeof reviseSchema>;

export const grnLineSchema = z.object({
  poLineId: uuidField('PO line'),
  qty: quantityField('Quantity'),
  unitCost: z.number().finite().min(0).nullish().transform((v) => v ?? null),
  binId: optionalUuid,
  conditionNote: optionalText(300, {}, 'Condition'),
  serials: z.array(z.object({ serialNo: z.string().trim().min(1).max(80), imei: z.string().trim().max(20).nullish().transform((v) => v || null) })).max(5000).default([]),
});
export const grnSchema = z.object({
  poId: uuidField('Purchase order'),
  warehouseId: optionalUuid,
  receivedDate: dateField('Received date'),
  supplierInvoiceNo: optionalText(60, {}, 'Supplier invoice number'),
  supplierInvoiceDate: optionalDateField('Supplier invoice date'),
  deliveryNoteNo: optionalText(60, {}, 'Delivery note number'),
  vehicleNo: optionalText(20, { transform: 'upper' }, 'Vehicle number'),
  remarks: optionalNotes(1000, 'Remarks'),
  lines: z.array(grnLineSchema).min(1).max(200),
});
export type GrnInput = z.infer<typeof grnSchema>;

export const settingsSchema = z.object({
  approverMustDiffer: z.boolean().optional(),
  approvalLimit: z.number().finite().min(0).nullable().optional(),
  closeRequiresQc: z.boolean().optional(),
  overReceiptTolerancePct: z.number().finite().min(0).max(100).optional(),
});

export const presignSchema = z.object({ entityType: z.enum(['PO', 'GRN']), entityId: z.string().uuid(), fileName: z.string().trim().min(1).max(255), contentType: z.string().trim().min(3).max(120), sizeBytes: z.number().int().positive().max(25 * 1024 * 1024) });

const limit = (def: number, max: number) => z.coerce.number().int().min(1).max(max).default(def);
export const poListQuery = z.object({ status: z.string().max(20).optional(), supplierId: z.string().uuid().optional(), q: z.string().trim().max(60).optional(), awaitingApproval: z.enum(['true', 'false']).optional(), limit: limit(50, 200) });
export const grnListQuery = z.object({ status: z.string().max(25).optional(), poId: z.string().uuid().optional(), warehouseId: z.string().uuid().optional(), q: z.string().trim().max(60).optional(), limit: limit(50, 200) });
export const receiveQuery = z.object({ receive: z.enum(['true', 'false']).optional() });
