import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { masterApi } from './api';
import type { BinPayload, DocType, LocationPayload, MasterStatus, NumberingPayload, ProductListParams, ProductPatch, ProductPayload, SimpleKind, WarehousePatch, WarehousePayload, WarehouseStatus } from './types';

export const masterKeys = {
  all: ['master'] as const,
  products: ['master', 'products'] as const,
  productList: (params: ProductListParams) => ['master', 'products', 'list', params] as const,
  productLookup: (params: Record<string, string | undefined>) => ['master', 'products', 'lookup', params] as const,
  product: (id: string) => ['master', 'products', 'detail', id] as const,
  warehouses: ['master', 'warehouses'] as const,
  simple: (kind: SimpleKind, includeInactive: boolean) => ['master', 'simple', kind, includeInactive] as const,
  simpleAll: (kind: SimpleKind) => ['master', 'simple', kind] as const,
  numbering: ['master', 'numbering'] as const,
};

/* ---- products ---------------------------------------------------------------- */

/** Cursor-paged product list; pages accumulate under "Load more". */
export function useProducts(params: Omit<ProductListParams, 'cursor'>) {
  return useInfiniteQuery({
    queryKey: masterKeys.productList(params),
    queryFn: ({ pageParam }) => masterApi.listProducts({ ...params, cursor: pageParam || undefined }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useProduct(id: string | undefined) {
  return useQuery({ queryKey: masterKeys.product(id ?? ''), queryFn: () => masterApi.getProduct(id!), enabled: Boolean(id) });
}

/** Active-product search for pickers (20 rows, name/SKU match). */
export function useProductLookup(term: string, opts: { trackInventoryOnly?: boolean; enabled?: boolean } = {}) {
  const params = { q: term || undefined, status: 'ACTIVE', trackInventory: opts.trackInventoryOnly ? 'true' : undefined };
  return useQuery({
    queryKey: masterKeys.productLookup(params),
    queryFn: () => masterApi.lookupProducts({ q: params.q, status: 'ACTIVE', trackInventory: params.trackInventory as 'true' | undefined }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    enabled: opts.enabled ?? true,
  });
}

function useInvalidateProducts() {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: masterKeys.products });
    if (id) void qc.invalidateQueries({ queryKey: masterKeys.product(id) });
  };
}

export function useCreateProduct() {
  const invalidate = useInvalidateProducts();
  return useMutation({ mutationFn: ({ payload, idempotencyKey }: { payload: ProductPayload; idempotencyKey?: string }) => masterApi.createProduct(payload, idempotencyKey), onSuccess: () => invalidate() });
}
export function usePatchProduct() {
  const invalidate = useInvalidateProducts();
  return useMutation({ mutationFn: ({ id, patch, version }: { id: string; patch: ProductPatch; version: number }) => masterApi.patchProduct(id, patch, version), onSuccess: (_d, v) => invalidate(v.id) });
}
export function useProductTransition() {
  const invalidate = useInvalidateProducts();
  return useMutation({ mutationFn: ({ id, command, reason }: { id: string; command: 'activate' | 'deactivate' | 'archive'; reason?: string }) => masterApi.transitionProduct(id, command, reason), onSuccess: (_d, v) => invalidate(v.id) });
}
export function useDeleteProduct() {
  const invalidate = useInvalidateProducts();
  return useMutation({ mutationFn: (id: string) => masterApi.deleteProduct(id), onSuccess: () => invalidate() });
}
export function useImportProducts() {
  const invalidate = useInvalidateProducts();
  return useMutation({ mutationFn: ({ rows, activate }: { rows: Omit<ProductPayload, 'activate'>[]; activate: boolean }) => masterApi.importProducts(rows, activate), onSuccess: () => invalidate() });
}

/* ---- warehouses ---------------------------------------------------------------- */

/** All warehouses visible to the member (the API already applies the warehouse scope), with locations and bins. */
export function useWarehouses(enabled = true) {
  return useQuery({ queryKey: masterKeys.warehouses, queryFn: masterApi.listWarehouses, staleTime: 60_000, enabled });
}

function useInvalidateWarehouses() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: masterKeys.warehouses });
}

export function useCreateWarehouse() {
  const invalidate = useInvalidateWarehouses();
  return useMutation({ mutationFn: (payload: WarehousePayload) => masterApi.createWarehouse(payload), onSuccess: invalidate });
}
export function usePatchWarehouse() {
  const invalidate = useInvalidateWarehouses();
  return useMutation({ mutationFn: ({ id, patch, version }: { id: string; patch: WarehousePatch; version: number }) => masterApi.patchWarehouse(id, patch, version), onSuccess: invalidate });
}
export function useWarehouseStatus() {
  const invalidate = useInvalidateWarehouses();
  return useMutation({ mutationFn: ({ id, status }: { id: string; status: WarehouseStatus }) => masterApi.setWarehouseStatus(id, status), onSuccess: invalidate });
}
export function useCreateLocation() {
  const invalidate = useInvalidateWarehouses();
  return useMutation({ mutationFn: ({ warehouseId, payload }: { warehouseId: string; payload: LocationPayload }) => masterApi.createLocation(warehouseId, payload), onSuccess: invalidate });
}
export function useCreateBin() {
  const invalidate = useInvalidateWarehouses();
  return useMutation({ mutationFn: ({ locationId, payload }: { locationId: string; payload: BinPayload }) => masterApi.createBin(locationId, payload), onSuccess: invalidate });
}
export function useBinStatus() {
  const invalidate = useInvalidateWarehouses();
  return useMutation({ mutationFn: ({ binId, status }: { binId: string; status: WarehouseStatus }) => masterApi.setBinStatus(binId, status), onSuccess: invalidate });
}

/* ---- simple masters --------------------------------------------------------------- */

export function useSimpleMaster<K extends SimpleKind>(kind: K, includeInactive = false, enabled = true) {
  return useQuery({ queryKey: masterKeys.simple(kind, includeInactive), queryFn: () => masterApi.simpleList(kind, includeInactive), staleTime: 60_000, enabled, placeholderData: keepPreviousData });
}

function useInvalidateSimple() {
  const qc = useQueryClient();
  return (kind: SimpleKind) => void qc.invalidateQueries({ queryKey: masterKeys.simpleAll(kind) });
}

export function useSimpleCreate<K extends SimpleKind>(kind: K) {
  const invalidate = useInvalidateSimple();
  return useMutation({ mutationFn: (payload: Record<string, unknown>) => masterApi.simpleCreate(kind, payload), onSuccess: () => invalidate(kind) });
}
export function useSimpleStatus(kind: SimpleKind) {
  const invalidate = useInvalidateSimple();
  return useMutation({ mutationFn: ({ id, status }: { id: string; status: MasterStatus }) => masterApi.simpleSetStatus(kind, id, status), onSuccess: () => invalidate(kind) });
}

/* ---- numbering ---------------------------------------------------------------------- */

export function useNumbering() {
  return useQuery({ queryKey: masterKeys.numbering, queryFn: masterApi.listNumbering });
}
export function useSetNumbering() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ docType, payload }: { docType: DocType; payload: NumberingPayload }) => masterApi.setNumbering(docType, payload), onSuccess: () => void qc.invalidateQueries({ queryKey: masterKeys.numbering }) });
}
