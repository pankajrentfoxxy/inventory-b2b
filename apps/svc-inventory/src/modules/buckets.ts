/**
 * Bucket model and posting rules (phase-04 4.3). Pure data + pure functions so the transition
 * table can be unit-tested exhaustively.
 */
export const BUCKETS = ['QC_HOLD', 'AVAILABLE', 'RESERVED', 'REJECTED', 'IN_TRANSIT', 'DELIVERED', 'EXT_SUPPLIER', 'EXT_CUSTOMER', 'EXT_OPENING', 'EXT_ADJUSTMENT', 'EXT_SCRAP'] as const;
export type Bucket = (typeof BUCKETS)[number];

/** Buckets that live in a warehouse balance row. */
export const WAREHOUSE_BUCKETS: readonly Bucket[] = ['QC_HOLD', 'AVAILABLE', 'RESERVED', 'REJECTED', 'IN_TRANSIT'];
/** Buckets that count toward on-hand (IN_TRANSIT left the warehouse; DELIVERED is with the customer). */
export const ON_HAND_BUCKETS: readonly Bucket[] = ['QC_HOLD', 'AVAILABLE', 'RESERVED', 'REJECTED'];
export const isVirtualBucket = (b: Bucket): boolean => b.startsWith('EXT_');
export const isWarehouseBucket = (b: Bucket): boolean => WAREHOUSE_BUCKETS.includes(b);

/** Global transition guard: nothing outside this table ever moves stock. */
export const ALLOWED_TRANSITIONS: Record<Bucket, readonly Bucket[]> = {
  EXT_OPENING: ['AVAILABLE', 'QC_HOLD'],
  EXT_SUPPLIER: ['QC_HOLD'],
  QC_HOLD: ['AVAILABLE', 'REJECTED', 'EXT_SUPPLIER'],
  AVAILABLE: ['RESERVED', 'IN_TRANSIT', 'EXT_ADJUSTMENT'],
  RESERVED: ['AVAILABLE', 'IN_TRANSIT'],
  IN_TRANSIT: ['DELIVERED', 'QC_HOLD', 'AVAILABLE', 'EXT_SUPPLIER'],
  DELIVERED: ['QC_HOLD'],
  REJECTED: ['IN_TRANSIT', 'EXT_SCRAP', 'AVAILABLE', 'EXT_ADJUSTMENT'],
  EXT_ADJUSTMENT: ['AVAILABLE', 'QC_HOLD', 'REJECTED'],
  EXT_CUSTOMER: [],
  EXT_SCRAP: [],
};
// QC_HOLD -> EXT_ADJUSTMENT is allowed too (adjust out of QC hold): add without touching the literal above.
(ALLOWED_TRANSITIONS.QC_HOLD as Bucket[]).push('EXT_ADJUSTMENT');

export function isAllowedTransition(from: Bucket, to: Bucket, postingType?: PostingType): boolean {
  if (postingType === 'BIN_MOVE') return from === to && isWarehouseBucket(from) && from !== 'IN_TRANSIT';
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export const POSTING_TYPES = [
  'OPENING', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'BIN_MOVE',
  'RECEIPT', 'QC_PASS', 'QC_FAIL', 'RECEIPT_REVERSAL',
  'RESERVE', 'RELEASE', 'DISPATCH', 'DELIVER', 'RTO_RECEIVE',
  'TRANSFER_OUT', 'TRANSFER_IN', 'RETURN_RECEIVE', 'SUPPLIER_RETURN_OUT', 'SCRAP', 'REGRADE',
] as const;
export type PostingType = (typeof POSTING_TYPES)[number];

export interface PostingRule {
  from: readonly Bucket[];
  to: readonly Bucket[];
  /** Positive warehouse lines must carry a unit cost (valuation groundwork). */
  costRequired: boolean;
  /** Which services may request this type through POST /internal/v1/postings. 'svc-inventory' = only this service's own code paths (user API or consumers). */
  callers: readonly string[];
  /** Serial qc_status written on the positive side (when the item is serialized). */
  qcStatus?: 'PENDING' | 'PASSED' | 'FAILED';
}

const OWN = ['svc-inventory'] as const;
export const POSTING_RULES: Record<PostingType, PostingRule> = {
  OPENING: { from: ['EXT_OPENING'], to: ['AVAILABLE', 'QC_HOLD'], costRequired: true, callers: OWN, qcStatus: 'PASSED' },
  ADJUSTMENT_IN: { from: ['EXT_ADJUSTMENT'], to: ['AVAILABLE', 'QC_HOLD', 'REJECTED'], costRequired: false, callers: OWN },
  ADJUSTMENT_OUT: { from: ['AVAILABLE', 'QC_HOLD', 'REJECTED'], to: ['EXT_ADJUSTMENT'], costRequired: false, callers: OWN },
  BIN_MOVE: { from: ['QC_HOLD', 'AVAILABLE', 'RESERVED', 'REJECTED'], to: ['QC_HOLD', 'AVAILABLE', 'RESERVED', 'REJECTED'], costRequired: false, callers: OWN },
  RECEIPT: { from: ['EXT_SUPPLIER'], to: ['QC_HOLD'], costRequired: true, callers: OWN, qcStatus: 'PENDING' },
  QC_PASS: { from: ['QC_HOLD'], to: ['AVAILABLE'], costRequired: false, callers: OWN, qcStatus: 'PASSED' },
  QC_FAIL: { from: ['QC_HOLD'], to: ['REJECTED'], costRequired: false, callers: OWN, qcStatus: 'FAILED' },
  RECEIPT_REVERSAL: { from: ['QC_HOLD'], to: ['EXT_SUPPLIER'], costRequired: false, callers: OWN },
  RESERVE: { from: ['AVAILABLE'], to: ['RESERVED'], costRequired: false, callers: ['svc-sales'] },
  RELEASE: { from: ['RESERVED'], to: ['AVAILABLE'], costRequired: false, callers: ['svc-sales'] },
  DISPATCH: { from: ['RESERVED'], to: ['IN_TRANSIT'], costRequired: false, callers: ['svc-fulfillment'] },
  DELIVER: { from: ['IN_TRANSIT'], to: ['DELIVERED'], costRequired: false, callers: ['svc-fulfillment'] },
  RTO_RECEIVE: { from: ['IN_TRANSIT'], to: ['QC_HOLD'], costRequired: false, callers: ['svc-fulfillment'], qcStatus: 'PENDING' },
  TRANSFER_OUT: { from: ['AVAILABLE'], to: ['IN_TRANSIT'], costRequired: false, callers: ['svc-transfers'] },
  TRANSFER_IN: { from: ['IN_TRANSIT'], to: ['AVAILABLE', 'QC_HOLD'], costRequired: false, callers: ['svc-transfers'] },
  RETURN_RECEIVE: { from: ['DELIVERED'], to: ['QC_HOLD'], costRequired: false, callers: ['svc-returns'], qcStatus: 'PENDING' },
  SUPPLIER_RETURN_OUT: { from: ['REJECTED', 'IN_TRANSIT'], to: ['IN_TRANSIT', 'EXT_SUPPLIER'], costRequired: false, callers: ['svc-returns'] },
  SCRAP: { from: ['REJECTED'], to: ['EXT_SCRAP'], costRequired: false, callers: ['svc-returns'] },
  REGRADE: { from: ['REJECTED'], to: ['AVAILABLE'], costRequired: false, callers: OWN, qcStatus: 'PASSED' },
};

/** Serial units in these buckets are "out of the system"; a new RECEIPT/OPENING for the same serial continues their history. */
export const REENTRY_BUCKETS: readonly Bucket[] = ['DELIVERED', 'EXT_SUPPLIER', 'EXT_SCRAP', 'EXT_ADJUSTMENT'];

export const UNBINNED = '00000000-0000-0000-0000-000000000000';
