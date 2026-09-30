/** Response shapes of svc-qc (`view()` in qc.service.ts) and the masters the QC screens need. */

export const QC_LOT_STATUSES = ['OPEN', 'IN_INSPECTION', 'DECIDED', 'CLOSED', 'CANCELLED'] as const;
export type QcLotStatus = (typeof QC_LOT_STATUSES)[number];
export type QcMode = 'SERIAL' | 'QUANTITY';
export type QcResultValue = 'PASS' | 'FAIL';
export type QcSourceType = 'GRN' | 'CUSTOMER_RETURN' | 'TRANSFER_IN' | 'RTO';
export type ChecklistItemKind = 'PASS_FAIL' | 'NUMERIC' | 'TEXT' | 'PHOTO';

export interface QcItemSnapshot {
  id: string;
  sku: string;
  name: string;
  isSerialized: boolean;
  requiresImei: boolean;
  serialPattern: string | null;
  qcRequired: boolean;
  unitCode: string;
  status: string;
}

export interface QcUnitResult {
  id: string;
  serialNo: string;
  result: QcResultValue;
  gradeCode: string | null;
  defectCodes: string[];
  remarks: string | null;
  checklistAnswers: Record<string, unknown>;
  inspectedBy: string;
  inspectedAt: string;
}

export interface QcChecklistItem {
  id: string;
  seq: number;
  label: string;
  kind: ChecklistItemKind;
  critical: boolean;
  minValue: number | string | null;
  maxValue: number | string | null;
}
export interface QcChecklist {
  id: string;
  name: string;
  appliesTo: { itemIds?: string[]; categoryIds?: string[]; isDefault?: boolean };
  status: 'ACTIVE' | 'INACTIVE';
  version: number;
  items: QcChecklistItem[];
  createdAt?: string;
  updatedAt?: string;
}

export interface QcLot {
  id: string;
  number: string;
  sourceType: QcSourceType;
  sourceId: string;
  sourceLineId: string;
  sourceNumber: string | null;
  itemId: string;
  item: QcItemSnapshot;
  warehouseId: string;
  binId: string | null;
  mode: QcMode;
  qty: number;
  passQty: number;
  failQty: number;
  serials: string[];
  checklistId: string | null;
  checklistVersion: number | null;
  status: QcLotStatus;
  statusReason: string | null;
  inspectorId: string | null;
  startedAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  postingIds: string[];
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  results: QcUnitResult[];
  progress: { inspected: number; total: number } | null;
}
export interface QcLotDetail extends QcLot {
  checklist: QcChecklist | null;
}

export interface QcLotListParams {
  status?: QcLotStatus;
  warehouseId?: string;
  sourceType?: QcSourceType;
  sourceId?: string;
  mine?: 'true';
  /** Matches lot number or source document number. */
  q?: string;
  limit?: number;
}

export interface UnitResultInput {
  serialNo?: string;
  result: QcResultValue;
  gradeCode?: string | null;
  defectCodes: string[];
  remarks?: string | null;
  checklistAnswers: Record<string, unknown>;
}
export interface DecideInput {
  passQty?: number;
  failQty?: number;
  gradeCode?: string | null;
  defectCodes: string[];
  remarks?: string | null;
}

export interface ChecklistItemInput {
  label: string;
  kind: ChecklistItemKind;
  critical: boolean;
  minValue?: number | null;
  maxValue?: number | null;
}
export interface ChecklistInput {
  name: string;
  appliesTo: { itemIds: string[]; categoryIds: string[]; isDefault: boolean };
  items: ChecklistItemInput[];
}

export interface QcDefectCode {
  code: string;
  description: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface ConditionGrade {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  sellable: boolean;
  status: string;
}
