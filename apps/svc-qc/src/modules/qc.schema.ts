import { z } from 'zod';
import { optionalNotes, optionalText, requiredText, uuidField } from '@b2b/shared';

const code = (label: string, max: number) => requiredText(label, max, { min: 1, transform: 'upper' });
const serialNo = z.string().trim().min(1).max(80);

export const checklistItemSchema = z.object({
  label: requiredText('Label', 200),
  kind: z.enum(['PASS_FAIL', 'NUMERIC', 'TEXT', 'PHOTO']).default('PASS_FAIL'),
  critical: z.boolean().default(false),
  minValue: z.number().finite().nullish().transform((v) => v ?? null),
  maxValue: z.number().finite().nullish().transform((v) => v ?? null),
});
export const checklistSchema = z.object({
  name: requiredText('Name', 100),
  appliesTo: z.object({ itemIds: z.array(z.string().uuid()).default([]), categoryIds: z.array(z.string().uuid()).default([]), isDefault: z.boolean().default(false) }).default({ itemIds: [], categoryIds: [], isDefault: false }),
  items: z.array(checklistItemSchema).min(1).max(100),
});
export type ChecklistInput = z.infer<typeof checklistSchema>;

export const defectCodeSchema = z.object({ code: code('Code', 20), description: requiredText('Description', 200) });
export const statusSchema = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) });

export const unitResultSchema = z.object({
  serialNo: serialNo.optional(),
  result: z.enum(['PASS', 'FAIL']),
  gradeCode: optionalText(20, { transform: 'upper' }, 'Grade'),
  defectCodes: z.array(code('Defect code', 20)).default([]),
  remarks: optionalNotes(500, 'Remarks'),
  checklistAnswers: z.record(z.unknown()).default({}),
});
export const resultsSchema = z.object({ results: z.array(unitResultSchema).min(1).max(5000) });
export type ResultsInput = z.infer<typeof resultsSchema>;

export const decideSchema = z.object({
  passQty: z.number().finite().min(0).optional(),
  failQty: z.number().finite().min(0).optional(),
  gradeCode: optionalText(20, { transform: 'upper' }, 'Grade'),
  defectCodes: z.array(code('Defect code', 20)).default([]),
  remarks: optionalNotes(500, 'Remarks'),
});
export type DecideInput = z.infer<typeof decideSchema>;

export const reasonSchema = z.object({ reason: optionalText(300, {}, 'Reason') });
export const uuidBody = uuidField;

const limit = (def: number, max: number) => z.coerce.number().int().min(1).max(max).default(def);
export const lotListQuery = z.object({ status: z.enum(['OPEN', 'IN_INSPECTION', 'DECIDED', 'CLOSED', 'CANCELLED']).optional(), warehouseId: z.string().uuid().optional(), sourceType: z.enum(['GRN', 'CUSTOMER_RETURN', 'TRANSFER_IN', 'RTO']).optional(), sourceId: z.string().uuid().optional(), mine: z.enum(['true', 'false']).optional(), q: z.string().trim().max(60).optional(), limit: limit(50, 200) });
