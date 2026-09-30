import { z } from 'zod';
import { numberField, optionalNotes, optionalNumberField, optionalText, optionalUuid, quantityField, uuidField } from '@b2b/shared';
import { BUCKETS, POSTING_TYPES } from './buckets.js';

const bucket = z.enum(BUCKETS);
const serialNo = z.string().trim().min(1).max(80);
const optionalCode = (max: number, label: string) => optionalText(max, { transform: 'upper' }, label);

export const serialInput = z.object({
  serialNo,
  imei: z.string().trim().max(20).nullish().transform((v) => v || null),
  gradeCode: optionalCode(20, 'Grade'),
});

export const openingLineSchema = z.object({
  itemId: uuidField('Item'),
  binId: optionalUuid,
  bucket: z.enum(['AVAILABLE', 'QC_HOLD']).default('AVAILABLE'),
  qty: quantityField('Quantity'),
  unitCost: numberField('Unit cost', { decimals: 4, min: 0, allowZero: true }),
  gradeCode: optionalCode(20, 'Grade'),
  serials: z.array(serialInput).max(5000).default([]),
});
export const openingStockSchema = z.object({
  warehouseId: uuidField('Warehouse'),
  notes: optionalNotes(300),
  lines: z.array(openingLineSchema).min(1).max(500),
});
export type OpeningStockInput = z.infer<typeof openingStockSchema>;

export const openingImportSchema = z.object({ rows: z.array(openingLineSchema.extend({ warehouseId: uuidField('Warehouse') })).min(1).max(2000) });

export const ADJUSTMENT_REASONS = ['COUNT_CORRECTION', 'DAMAGE', 'LOSS', 'FOUND', 'OPENING', 'OTHER'] as const;
export const adjustmentLineSchema = z.object({
  itemId: uuidField('Item'),
  binId: optionalUuid,
  bucket: z.enum(['AVAILABLE', 'QC_HOLD', 'REJECTED']).default('AVAILABLE'),
  qtyDelta: z.number().finite().refine((v) => v !== 0, 'Quantity change cannot be zero'),
  unitCost: optionalNumberField('Unit cost', { decimals: 4, min: 0 }),
  serialNumbers: z.array(serialNo).max(5000).default([]),
});
export const adjustmentSchema = z.object({
  warehouseId: uuidField('Warehouse'),
  reasonCode: z.enum(ADJUSTMENT_REASONS),
  notes: optionalNotes(500),
  lines: z.array(adjustmentLineSchema).min(1).max(200),
});
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
export const reasonSchema = z.object({ reason: optionalText(300, {}, 'Reason') });

export const binMoveSchema = z.object({
  warehouseId: uuidField('Warehouse'),
  itemId: uuidField('Item'),
  bucket: z.enum(['AVAILABLE', 'QC_HOLD', 'RESERVED', 'REJECTED']).default('AVAILABLE'),
  fromBinId: optionalUuid,
  toBinId: optionalUuid,
  qty: quantityField('Quantity'),
  serialNumbers: z.array(serialNo).max(5000).default([]),
});
export type BinMoveInput = z.infer<typeof binMoveSchema>;

export const settingsSchema = z.object({ adjustmentApprovalThreshold: numberField('Approval threshold', { decimals: 2, min: 0, allowZero: true }) });

const limit = (def: number, max: number) => z.coerce.number().int().min(1).max(max).default(def);
export const stockQuery = z.object({ warehouseId: z.string().uuid().optional(), itemId: z.string().uuid().optional(), bucket: bucket.optional(), q: z.string().trim().max(100).optional(), limit: limit(100, 500) });
export const ledgerQuery = z.object({ itemId: z.string().uuid().optional(), warehouseId: z.string().uuid().optional(), from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional(), refType: z.string().trim().max(30).optional(), limit: limit(200, 1000) });
export const serialsQuery = z.object({ q: z.string().trim().max(80).optional(), itemId: z.string().uuid().optional(), bucket: bucket.optional(), warehouseId: z.string().uuid().optional(), limit: limit(50, 500) });
export const adjustmentListQuery = z.object({ status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'POSTED', 'CANCELLED']).optional(), warehouseId: z.string().uuid().optional(), limit: limit(50, 200) });
export const availabilityQuery = z.object({ itemIds: z.string().min(1), warehouseId: z.string().uuid().optional() });

const nullishUuid = z.string().uuid().nullish().transform((v) => v ?? null);
export const internalPostingSchema = z.object({
  postingType: z.enum(POSTING_TYPES),
  refType: z.string().trim().min(1).max(30),
  refId: z.string().uuid(),
  refNumber: z.string().trim().max(60).nullish().transform((v) => v || null),
  idempotencyKey: z.string().trim().min(1).max(160),
  actorId: nullishUuid,
  reversalOf: nullishUuid,
  lines: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        warehouseId: nullishUuid,
        binId: nullishUuid,
        partyId: nullishUuid,
        bucket,
        qty: z.number().finite(),
        unitCost: z.number().finite().nullish().transform((v) => v ?? null),
        gradeCode: z.string().trim().max(20).nullish().transform((v) => v || null),
      }),
    )
    .min(2)
    .max(2000),
  serials: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        serialNo,
        imei: z.string().trim().max(20).nullish().transform((v) => v || null),
        gradeCode: z.string().trim().max(20).nullish().transform((v) => v || null),
        fromLineNo: z.number().int().nullish().transform((v) => v ?? null),
        toLineNo: z.number().int().nullish().transform((v) => v ?? null),
        refs: z.record(z.enum(['poId', 'grnId', 'qcLotId', 'soId', 'reservationId', 'dcId', 'shipmentId']), z.string().uuid().nullable()).optional(),
      }),
    )
    .max(10000)
    .default([]),
});
export type InternalPostingInput = z.infer<typeof internalPostingSchema>;

export const serialsCheckSchema = z.object({ itemId: z.string().uuid(), serials: z.array(serialNo).min(1).max(10000) });
