import { useMemo } from 'react';
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../lib/auth';
import { inventoryApi, masterLookupApi } from './api';
import type { AdjustmentInput, AdjustmentListQuery, BinMoveInput, InventorySettings, LedgerQuery, OpeningImportRow, OpeningStockInput, ProductLookup, SerialsQuery, StockQuery, Warehouse, WarehouseBin } from './types';

export const inventoryKeys = {
  all: ['inventory'] as const,
  stock: (params: StockQuery) => ['inventory', 'stock', params] as const,
  stockItem: (itemId: string) => ['inventory', 'stock', 'item', itemId] as const,
  ledger: (params: LedgerQuery) => ['inventory', 'ledger', params] as const,
  serials: (params: SerialsQuery) => ['inventory', 'serials', params] as const,
  serial: (id: string) => ['inventory', 'serials', 'detail', id] as const,
  serialHistory: (id: string) => ['inventory', 'serials', 'history', id] as const,
  adjustments: (params: AdjustmentListQuery) => ['inventory', 'adjustments', params] as const,
  adjustment: (id: string) => ['inventory', 'adjustments', 'detail', id] as const,
  settings: ['inventory', 'settings'] as const,
  reconciliation: ['inventory', 'reconciliation'] as const,
};
export const masterLookupKeys = {
  warehouses: ['master-lookup', 'warehouses'] as const,
  warehouse: (id: string) => ['master-lookup', 'warehouses', id] as const,
  products: (q: string) => ['master-lookup', 'products', q] as const,
  product: (id: string) => ['master-lookup', 'product', id] as const,
};

/* ---- reads ------------------------------------------------------------------ */

export function useStock(params: StockQuery, enabled = true) {
  return useQuery({ queryKey: inventoryKeys.stock(params), queryFn: () => inventoryApi.stock(params), placeholderData: keepPreviousData, enabled });
}
export function useStockByItem(itemId: string | undefined) {
  return useQuery({ queryKey: inventoryKeys.stockItem(itemId ?? ''), queryFn: () => inventoryApi.stockByItem(itemId!), enabled: Boolean(itemId) });
}
export function useLedger(params: LedgerQuery) {
  return useQuery({ queryKey: inventoryKeys.ledger(params), queryFn: () => inventoryApi.ledger(params), placeholderData: keepPreviousData });
}
export function useSerials(params: SerialsQuery) {
  return useQuery({ queryKey: inventoryKeys.serials(params), queryFn: () => inventoryApi.serials(params), placeholderData: keepPreviousData });
}
export function useSerial(id: string | undefined) {
  return useQuery({ queryKey: inventoryKeys.serial(id ?? ''), queryFn: () => inventoryApi.serial(id!), enabled: Boolean(id) });
}
export function useSerialHistory(id: string | undefined) {
  return useQuery({ queryKey: inventoryKeys.serialHistory(id ?? ''), queryFn: () => inventoryApi.serialHistory(id!), enabled: Boolean(id) });
}
export function useAdjustments(params: AdjustmentListQuery) {
  return useQuery({ queryKey: inventoryKeys.adjustments(params), queryFn: () => inventoryApi.adjustments(params), placeholderData: keepPreviousData });
}
export function useAdjustment(id: string | undefined) {
  return useQuery({ queryKey: inventoryKeys.adjustment(id ?? ''), queryFn: () => inventoryApi.adjustment(id!), enabled: Boolean(id) });
}
export function useInventorySettings() {
  return useQuery({ queryKey: inventoryKeys.settings, queryFn: inventoryApi.settings });
}
/** Reconciliation is heavy: only fetched on demand (enabled) and never refetched in the background. */
export function useReconciliation(enabled: boolean) {
  return useQuery({ queryKey: inventoryKeys.reconciliation, queryFn: inventoryApi.reconciliation, enabled, staleTime: Infinity, refetchOnWindowFocus: false });
}

/* ---- writes ----------------------------------------------------------------- */

function useInvalidateInventory() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: inventoryKeys.all });
}

export function useOpeningStock() {
  const invalidate = useInvalidateInventory();
  return useMutation({ mutationFn: ({ payload, idempotencyKey }: { payload: OpeningStockInput; idempotencyKey: string }) => inventoryApi.openingStock(payload, idempotencyKey), onSuccess: invalidate });
}
export function useImportOpeningStock() {
  const invalidate = useInvalidateInventory();
  return useMutation({ mutationFn: (rows: OpeningImportRow[]) => inventoryApi.importOpeningStock(rows), onSuccess: invalidate });
}
export function useCreateAdjustment() {
  const invalidate = useInvalidateInventory();
  return useMutation({ mutationFn: ({ payload, idempotencyKey }: { payload: AdjustmentInput; idempotencyKey: string }) => inventoryApi.createAdjustment(payload, idempotencyKey), onSuccess: invalidate });
}
export function useSubmitAdjustment() {
  const invalidate = useInvalidateInventory();
  return useMutation({ mutationFn: (id: string) => inventoryApi.submitAdjustment(id), onSuccess: invalidate });
}
export function useApproveAdjustment() {
  const invalidate = useInvalidateInventory();
  return useMutation({ mutationFn: (id: string) => inventoryApi.approveAdjustment(id), onSuccess: invalidate });
}
export function useCancelAdjustment() {
  const invalidate = useInvalidateInventory();
  return useMutation({ mutationFn: ({ id, reason }: { id: string; reason?: string }) => inventoryApi.cancelAdjustment(id, reason), onSuccess: invalidate });
}
export function useBinMove() {
  const invalidate = useInvalidateInventory();
  return useMutation({ mutationFn: ({ payload, idempotencyKey }: { payload: BinMoveInput; idempotencyKey: string }) => inventoryApi.binMove(payload, idempotencyKey), onSuccess: invalidate });
}
export function useUpdateInventorySettings() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (payload: InventorySettings) => inventoryApi.updateSettings(payload), onSuccess: (data) => qc.setQueryData(inventoryKeys.settings, data) });
}

/* ---- master lookups ----------------------------------------------------------- */

export function useWarehouses() {
  return useQuery({ queryKey: masterLookupKeys.warehouses, queryFn: masterLookupApi.warehouses, staleTime: 5 * 60_000 });
}
export function useWarehouse(id: string | undefined) {
  return useQuery({ queryKey: masterLookupKeys.warehouse(id ?? ''), queryFn: () => masterLookupApi.warehouse(id!), enabled: Boolean(id), staleTime: 5 * 60_000 });
}

/**
 * Warehouses the current member may act on: the master list filtered by the token's warehouse scope
 * (null = every warehouse). `defaultId` is the first scoped warehouse (the tenant default first).
 */
export function useScopedWarehouses(opts: { activeOnly?: boolean } = {}) {
  const { warehouseIds } = useAuth();
  const query = useWarehouses();
  const warehouses = useMemo(() => {
    const all = query.data ?? [];
    const scoped = warehouseIds ? all.filter((w) => warehouseIds.includes(w.id)) : all;
    return opts.activeOnly ? scoped.filter((w) => w.status === 'ACTIVE') : scoped;
  }, [query.data, warehouseIds, opts.activeOnly]);
  const defaultId = warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? '';
  return { ...query, warehouses, defaultId };
}

/** id -> warehouse / bin maps for resolving ids in ledger, serial and reconciliation rows. */
export function useWarehouseMaps() {
  const query = useWarehouses();
  return useMemo(() => {
    const warehouses = new Map<string, Warehouse>();
    const bins = new Map<string, WarehouseBin & { warehouseId: string; locationCode: string }>();
    for (const w of query.data ?? []) {
      warehouses.set(w.id, w);
      for (const l of w.locations) for (const b of l.bins) bins.set(b.id, { ...b, warehouseId: w.id, locationCode: l.code });
    }
    const warehouseLabel = (id: string | null | undefined) => (id ? warehouses.get(id)?.code ?? `${id.slice(0, 8)}...` : '-');
    const binLabel = (id: string | null | undefined) => (id ? bins.get(id)?.code ?? `${id.slice(0, 8)}...` : 'Unbinned');
    return { warehouses, bins, warehouseLabel, binLabel, loading: query.isLoading };
  }, [query.data, query.isLoading]);
}

/** Bins of one warehouse, flattened across its locations (active only). */
export function binsOf(warehouse: Warehouse | undefined): { value: string; label: string }[] {
  if (!warehouse) return [];
  return warehouse.locations.flatMap((l) => l.bins.filter((b) => b.status === 'ACTIVE').map((b) => ({ value: b.id, label: `${l.code} / ${b.code}` })));
}

export function useProductSearch(term: string, enabled = true) {
  return useQuery({ queryKey: masterLookupKeys.products(term), queryFn: () => masterLookupApi.products(term), enabled, staleTime: 60_000, placeholderData: keepPreviousData });
}

/** Resolves item names for rows that only carry itemId (adjustment lines, reconciliation). */
export function useProductRefs(ids: string[]) {
  // Keyed by content, not array identity, so callers can pass a fresh array every render.
  const key = Array.from(new Set(ids.filter(Boolean))).sort().join('|');
  const unique = useMemo(() => (key ? key.split('|') : []), [key]);
  const results = useQueries({
    queries: unique.map((id) => ({ queryKey: masterLookupKeys.product(id), queryFn: () => masterLookupApi.product(id), staleTime: 5 * 60_000, retry: false })),
  });
  return useMemo(() => {
    const map = new Map<string, ProductLookup>();
    results.forEach((r, i) => {
      if (r.data) map.set(unique[i], r.data);
    });
    const label = (id: string) => {
      const p = map.get(id);
      return p ? `${p.sku} - ${p.name}` : `${id.slice(0, 8)}...`;
    };
    return { map, label, loading: results.some((r) => r.isLoading) };
  }, [results, unique]);
}
