import { api, unwrap, withIdempotencyKey } from '../../lib/api';
import type {
  Adjustment,
  AdjustmentInput,
  AdjustmentListQuery,
  BinMoveInput,
  BinMoveResult,
  InventorySettings,
  LedgerQuery,
  LedgerRow,
  OpeningImportResult,
  OpeningImportRow,
  OpeningStockInput,
  OpeningStockResult,
  ProductLookup,
  Reconciliation,
  SerialDetail,
  SerialEvent,
  SerialUnit,
  SerialsQuery,
  StockByItem,
  StockQuery,
  StockRow,
  Warehouse,
} from './types';

const BASE = '/v1/inventory';

/** Drops empty-string filters so the service's zod query schema does not reject them. */
function clean<T extends object>(params: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) if (v !== '' && v !== undefined && v !== null) out[k] = v;
  return out as Partial<T>;
}

export const inventoryApi = {
  stock: (params: StockQuery) => api.get<{ data: StockRow[] }>(`${BASE}/stock`, { params: clean(params) }).then(unwrap),
  stockByItem: (itemId: string) => api.get<{ data: StockByItem }>(`${BASE}/stock/${itemId}`).then(unwrap),
  ledger: (params: LedgerQuery) => api.get<{ data: LedgerRow[] }>(`${BASE}/ledger`, { params: clean(params) }).then(unwrap),

  serials: (params: SerialsQuery) => api.get<{ data: SerialUnit[] }>(`${BASE}/serials`, { params: clean(params) }).then(unwrap),
  serial: (id: string) => api.get<{ data: SerialDetail }>(`${BASE}/serials/${id}`).then(unwrap),
  serialHistory: (id: string) => api.get<{ data: SerialEvent[] }>(`${BASE}/serials/${id}/history`).then(unwrap),

  /** Idempotency-Key is required by the service: a retried submit never posts the opening twice. */
  openingStock: (payload: OpeningStockInput, idempotencyKey: string) => api.post<{ data: OpeningStockResult }>(`${BASE}/opening-stock`, payload, withIdempotencyKey(idempotencyKey)).then(unwrap),
  importOpeningStock: (rows: OpeningImportRow[]) => api.post<{ data: OpeningImportResult }>(`${BASE}/opening-stock/import`, { rows }).then(unwrap),

  adjustments: (params: AdjustmentListQuery) => api.get<{ data: Adjustment[] }>(`${BASE}/adjustments`, { params: clean(params) }).then(unwrap),
  adjustment: (id: string) => api.get<{ data: Adjustment }>(`${BASE}/adjustments/${id}`).then(unwrap),
  createAdjustment: (payload: AdjustmentInput, idempotencyKey: string) => api.post<{ data: Adjustment }>(`${BASE}/adjustments`, payload, withIdempotencyKey(idempotencyKey)).then(unwrap),
  submitAdjustment: (id: string) => api.post<{ data: Adjustment }>(`${BASE}/adjustments/${id}/submit`, {}).then(unwrap),
  approveAdjustment: (id: string) => api.post<{ data: Adjustment }>(`${BASE}/adjustments/${id}/approve`, {}).then(unwrap),
  cancelAdjustment: (id: string, reason?: string) => api.post<{ data: Adjustment }>(`${BASE}/adjustments/${id}/cancel`, { reason: reason || undefined }).then(unwrap),

  binMove: (payload: BinMoveInput, idempotencyKey: string) => api.post<{ data: BinMoveResult }>(`${BASE}/bin-moves`, payload, withIdempotencyKey(idempotencyKey)).then(unwrap),

  reconciliation: () => api.get<{ data: Reconciliation }>(`${BASE}/reconciliation`).then(unwrap),
  settings: () => api.get<{ data: InventorySettings }>(`${BASE}/settings`).then(unwrap),
  updateSettings: (payload: InventorySettings) => api.put<{ data: InventorySettings }>(`${BASE}/settings`, payload).then(unwrap),
};

/**
 * Master-data lookups used by the pickers. Called directly (not through features/master) so this
 * module has no compile-time dependency on the master UI.
 */
export const masterLookupApi = {
  warehouses: () => api.get<{ data: Warehouse[] }>('/v1/master/warehouses').then(unwrap),
  warehouse: (id: string) => api.get<{ data: Warehouse }>(`/v1/master/warehouses/${id}`).then(unwrap),
  products: (q: string) => api.get<{ data: ProductLookup[] }>('/v1/master/lookups/products', { params: { q: q || undefined, status: 'ACTIVE', trackInventory: 'true' } }).then(unwrap),
  product: (id: string) => api.get<{ data: ProductLookup }>(`/v1/master/products/${id}`).then(unwrap),
};
