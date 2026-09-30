import type { AxiosRequestConfig } from 'axios';
import { api, unwrap, withIdempotencyKey } from '../../lib/api';
import type {
  Bin,
  BinPayload,
  CursorPage,
  DocType,
  ImportResult,
  Location,
  LocationPayload,
  NumberingConfig,
  NumberingPayload,
  Product,
  ProductDetail,
  ProductListParams,
  ProductPatch,
  ProductPayload,
  ProductSnapshot,
  SimpleKind,
  SimpleRowMap,
  Warehouse,
  WarehousePatch,
  WarehousePayload,
  WarehouseStatus,
  MasterStatus,
} from './types';

const BASE = '/v1/master';

/** Drops empty strings / undefined so zod enums on the server never see "". */
function clean(params: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) if (v !== '' && v !== undefined && v !== null) out[k] = v;
  return out;
}

const ifMatch = (version: number): AxiosRequestConfig => ({ headers: { 'If-Match': String(version) } });

export const masterApi = {
  /* products */
  listProducts: (params: ProductListParams) => api.get<CursorPage<Product>>(`${BASE}/products`, { params: clean(params) }).then((r) => r.data),
  lookupProducts: (params: { q?: string; status?: string; trackInventory?: 'true' | 'false' }) => api.get<{ data: ProductSnapshot[] }>(`${BASE}/lookups/products`, { params: clean(params) }).then(unwrap),
  getProduct: (id: string) => api.get<{ data: ProductDetail }>(`${BASE}/products/${id}`).then(unwrap),
  createProduct: (payload: ProductPayload, idempotencyKey?: string) => api.post<{ data: Product }>(`${BASE}/products`, payload, idempotencyKey ? withIdempotencyKey(idempotencyKey) : undefined).then(unwrap),
  importProducts: (rows: Omit<ProductPayload, 'activate'>[], activate: boolean) => api.post<{ data: ImportResult }>(`${BASE}/products/import`, { rows, activate }).then(unwrap),
  patchProduct: (id: string, patch: ProductPatch, version: number) => api.patch<{ data: Product }>(`${BASE}/products/${id}`, patch, ifMatch(version)).then(unwrap),
  transitionProduct: (id: string, command: 'activate' | 'deactivate' | 'archive', reason?: string) => api.post<{ data: Product }>(`${BASE}/products/${id}/${command}`, { reason: reason || undefined }).then(unwrap),
  deleteProduct: (id: string) => api.delete<{ data: { id: string; deleted: boolean } }>(`${BASE}/products/${id}`).then(unwrap),

  /* warehouses */
  listWarehouses: () => api.get<{ data: Warehouse[] }>(`${BASE}/warehouses`).then(unwrap),
  getWarehouse: (id: string) => api.get<{ data: Warehouse }>(`${BASE}/warehouses/${id}`).then(unwrap),
  createWarehouse: (payload: WarehousePayload) => api.post<{ data: Warehouse }>(`${BASE}/warehouses`, payload).then(unwrap),
  patchWarehouse: (id: string, patch: WarehousePatch, version: number) => api.patch<{ data: Warehouse }>(`${BASE}/warehouses/${id}`, patch, ifMatch(version)).then(unwrap),
  setWarehouseStatus: (id: string, status: WarehouseStatus) => api.post<{ data: Warehouse }>(`${BASE}/warehouses/${id}/status`, { status }).then(unwrap),
  createLocation: (warehouseId: string, payload: LocationPayload) => api.post<{ data: Location }>(`${BASE}/warehouses/${warehouseId}/locations`, payload).then(unwrap),
  createBin: (locationId: string, payload: BinPayload) => api.post<{ data: Bin }>(`${BASE}/locations/${locationId}/bins`, payload).then(unwrap),
  setBinStatus: (binId: string, status: WarehouseStatus) => api.post<{ data: { id: string; status: WarehouseStatus } }>(`${BASE}/bins/${binId}/status`, { status }).then(unwrap),

  /* simple masters */
  simpleList: <K extends SimpleKind>(kind: K, includeInactive = false) => api.get<{ data: SimpleRowMap[K][] }>(`${BASE}/${kind}`, { params: includeInactive ? { includeInactive: 'true' } : undefined }).then(unwrap),
  simpleCreate: <K extends SimpleKind>(kind: K, payload: Record<string, unknown>) => api.post<{ data: SimpleRowMap[K] }>(`${BASE}/${kind}`, payload).then(unwrap),
  simpleSetStatus: (kind: SimpleKind, id: string, status: MasterStatus) => api.post<{ data: { id: string; status: MasterStatus } }>(`${BASE}/${kind}/${id}/status`, { status }).then(unwrap),

  /* numbering */
  listNumbering: () => api.get<{ data: NumberingConfig[] }>(`${BASE}/settings/numbering`).then(unwrap),
  setNumbering: (docType: DocType, payload: NumberingPayload) => api.put<{ data: NumberingConfig }>(`${BASE}/settings/numbering/${docType}`, payload).then(unwrap),
};
