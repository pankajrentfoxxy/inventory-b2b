import type { LaptopSpecs } from '../../components/LaptopSpecs';

/** Response shapes of svc-qc (`view()` in qc.service.ts) and the masters the QC screens need. */

export const QC_LOT_STATUSES = ['OPEN', 'IN_INSPECTION', 'DECIDED', 'CLOSED', 'CANCELLED'] as const;
export type QcLotStatus = (typeof QC_LOT_STATUSES)[number];
export type QcMode = 'SERIAL' | 'QUANTITY';
/** HOLD is valid for laptop lots only: the unit stays in QC hold and blocks the lot decision. */
export type QcResultValue = 'PASS' | 'FAIL' | 'HOLD';
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
  /** Laptop configurations only. */
  specs?: LaptopSpecs | null;
}

/* ---- laptop inspection ------------------------------------------------------------------------ */

export const LAPTOP_MISSING_PARTS = ['CHARGER', 'BATTERY', 'RAM', 'SSD', 'KEYBOARD_KEYS', 'BACK_PANEL', 'SCREWS', 'OTHER'] as const;
export type LaptopMissingPart = (typeof LAPTOP_MISSING_PARTS)[number];
/** Defect codes the server adds on its own when a laptop FAILs for one of these reasons. */
export const LAPTOP_SYSTEM_DEFECTS = ['SPEC_MISMATCH', 'NO_POWER', 'MISSING_PARTS'] as const;
export type LaptopSpecKey = keyof LaptopSpecs;

export interface LaptopSpecCheck {
  match: boolean;
  actual?: string | null;
}
export interface LaptopCheck {
  specChecks: Record<LaptopSpecKey, LaptopSpecCheck>;
  powersOn: boolean;
  missingParts: LaptopMissingPart[];
  assetTag?: string | null;
}

export interface QcUnitResult {
  id: string;
  serialNo: string;
  result: QcResultValue;
  gradeCode: string | null;
  defectCodes: string[];
  remarks: string | null;
  checklistAnswers: Record<string, unknown>;
  laptopCheck?: LaptopCheck | null;
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
  /** Serial mode only. */
  progress: { inspected: number; total: number; passed: number; failed: number; onHold: number } | null;
  /** The item is a laptop configuration: per-unit laptop checks are required. */
  isLaptop: boolean;
  /** The configuration the laptops were ordered with (item snapshot specs). */
  expectedSpecs: LaptopSpecs | null;
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
  /** Required for laptop lots. */
  laptop?: LaptopCheck;
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
