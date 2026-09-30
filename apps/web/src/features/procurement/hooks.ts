import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { shouldRetryWithSameKey, useIdempotencyKey } from '../../hooks/useIdempotencyKey';
import { toApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { lookupApi, procurementApi } from './api';
import { GRN_POSTING_STATUSES, type AttachmentEntity, type Grn, type GrnInput, type GrnListParams, type PoCommand, type PoInput, type PoListParams, type PoPatch, type ProcurementSettings, type RetrySerials, type ReviseInput, type WarehouseLookup } from './types';

export const poKeys = {
  all: ['procurement', 'po'] as const,
  list: (params: PoListParams) => ['procurement', 'po', 'list', params] as const,
  detail: (id: string) => ['procurement', 'po', 'detail', id] as const,
  revision: (id: string, revision: number) => ['procurement', 'po', 'revision', id, revision] as const,
  receivable: (id: string) => ['procurement', 'po', 'receivable', id] as const,
};
export const grnKeys = {
  all: ['procurement', 'grn'] as const,
  list: (params: GrnListParams) => ['procurement', 'grn', 'list', params] as const,
  detail: (id: string) => ['procurement', 'grn', 'detail', id] as const,
};
export const settingsKey = ['procurement', 'settings'] as const;
export const attachmentKeys = { list: (entityType: AttachmentEntity, entityId: string) => ['procurement', 'attachments', entityType, entityId] as const };
export const lookupKeys = {
  suppliers: (q: string) => ['lookup', 'suppliers', q] as const,
  products: (q: string) => ['lookup', 'products', q] as const,
  warehouses: ['lookup', 'warehouses'] as const,
  warehouse: (id: string) => ['lookup', 'warehouse', id] as const,
  paymentTerms: ['lookup', 'payment-terms'] as const,
};

/* ---- shared helpers --------------------------------------------------------------------------------- */

/**
 * "Poll for up to N seconds": true once `active` has been on for longer than the window. Resets when
 * the process finishes (active goes false).
 */
export function usePollingWindow(active: boolean, windowMs = 30_000) {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!active) {
      setExpired(false);
      return;
    }
    const t = setTimeout(() => setExpired(true), windowMs);
    return () => clearTimeout(t);
  }, [active, windowMs]);
  return expired;
}

/**
 * Wraps a creating mutation so the same Idempotency-Key is reused when the outcome is unknown (network
 * error / 5xx) and a fresh one is issued after a definitive answer.
 */
function useIdempotentMutation<TVars, TResult>(run: (vars: TVars, key: string) => Promise<TResult>, onSuccess?: (result: TResult, vars: TVars) => void) {
  const idem = useIdempotencyKey();
  return useMutation({
    mutationFn: async (vars: TVars) => {
      const key = idem.keyFor(vars);
      try {
        const result = await run(vars, key);
        idem.reset();
        return result;
      } catch (err) {
        if (!shouldRetryWithSameKey(toApiError(err).status)) idem.reset();
        throw err;
      }
    },
    onSuccess,
  });
}

/* ---- purchase orders ------------------------------------------------------------------------------- */

export function usePurchaseOrders(params: PoListParams, enabled = true) {
  return useQuery({ queryKey: poKeys.list(params), queryFn: () => procurementApi.listPurchaseOrders(params), placeholderData: keepPreviousData, enabled });
}
export function usePurchaseOrder(id: string | undefined) {
  return useQuery({ queryKey: poKeys.detail(id ?? ''), queryFn: () => procurementApi.getPurchaseOrder(id!), enabled: Boolean(id) });
}
export function usePoRevision(id: string | undefined, revision: number | null) {
  return useQuery({ queryKey: poKeys.revision(id ?? '', revision ?? -1), queryFn: () => procurementApi.getRevision(id!, revision!), enabled: Boolean(id) && revision !== null, staleTime: Infinity });
}
export function useReceivableLines(poId: string | undefined) {
  return useQuery({ queryKey: poKeys.receivable(poId ?? ''), queryFn: () => procurementApi.receivableLines(poId!), enabled: Boolean(poId) });
}

function useInvalidatePo() {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: poKeys.all });
    if (id) void qc.invalidateQueries({ queryKey: poKeys.detail(id) });
  };
}

export function useCreatePurchaseOrder() {
  const invalidate = useInvalidatePo();
  return useIdempotentMutation((payload: PoInput, key) => procurementApi.createPurchaseOrder(payload, key), () => invalidate());
}
export function usePatchPurchaseOrder() {
  const invalidate = useInvalidatePo();
  return useMutation({ mutationFn: ({ id, payload, version }: { id: string; payload: PoPatch; version: number }) => procurementApi.patchPurchaseOrder(id, payload, version), onSuccess: (_r, v) => invalidate(v.id) });
}
export function usePoCommand() {
  const invalidate = useInvalidatePo();
  return useIdempotentMutation(
    ({ id, command, body }: { id: string; command: Exclude<PoCommand, 'revise'>; body?: { reason?: string; comment?: string } }, key) => procurementApi.commandPurchaseOrder(id, command, body ?? {}, key),
    (_r, v) => invalidate(v.id),
  );
}
export function useRevisePurchaseOrder() {
  const invalidate = useInvalidatePo();
  return useIdempotentMutation(({ id, payload }: { id: string; payload: ReviseInput }, key) => procurementApi.revisePurchaseOrder(id, payload, key), (_r, v) => invalidate(v.id));
}

/* ---- goods receipts -------------------------------------------------------------------------------- */

export function useGrns(params: GrnListParams, enabled = true) {
  return useQuery({ queryKey: grnKeys.list(params), queryFn: () => procurementApi.listGrns(params), placeholderData: keepPreviousData, enabled });
}

/** GRN detail that polls every 2 s (up to 30 s) while a posting is in flight. */
export function useGrn(id: string | undefined) {
  const qc = useQueryClient();
  const cached = id ? qc.getQueryData<Grn>(grnKeys.detail(id)) : undefined;
  const posting = cached ? GRN_POSTING_STATUSES.includes(cached.status) : false;
  const expired = usePollingWindow(posting);
  const query = useQuery({ queryKey: grnKeys.detail(id ?? ''), queryFn: () => procurementApi.getGrn(id!), enabled: Boolean(id), refetchInterval: posting && !expired ? 2000 : false });
  return { ...query, polling: posting && !expired, pollingExpired: posting && expired };
}

function useInvalidateGrn() {
  const qc = useQueryClient();
  return (id?: string, poId?: string) => {
    void qc.invalidateQueries({ queryKey: grnKeys.all });
    if (id) void qc.invalidateQueries({ queryKey: grnKeys.detail(id) });
    void qc.invalidateQueries({ queryKey: poKeys.all });
    if (poId) void qc.invalidateQueries({ queryKey: poKeys.detail(poId) });
  };
}

export function useCreateGrn() {
  const invalidate = useInvalidateGrn();
  return useIdempotentMutation(({ payload, receive }: { payload: GrnInput; receive: boolean }, key) => procurementApi.createGrn(payload, key, receive), (r) => invalidate(r.id, r.poId));
}
export function useReceiveGrn() {
  const invalidate = useInvalidateGrn();
  return useIdempotentMutation(({ id }: { id: string }, key) => procurementApi.receiveGrn(id, key), (r) => invalidate(r.id, r.poId));
}
export function useCancelGrn() {
  const invalidate = useInvalidateGrn();
  return useIdempotentMutation(({ id, reason }: { id: string; reason: string }, key) => procurementApi.cancelGrn(id, reason, key), (r) => invalidate(r.id, r.poId));
}
export function useRetryPosting() {
  const invalidate = useInvalidateGrn();
  return useIdempotentMutation(({ id, serials }: { id: string; serials: RetrySerials | null }, key) => procurementApi.retryPosting(id, serials, key), (r) => invalidate(r.id, r.poId));
}

/* ---- settings -------------------------------------------------------------------------------------- */

export function useProcurementSettings() {
  return useQuery({ queryKey: settingsKey, queryFn: procurementApi.getSettings });
}
export function useUpdateProcurementSettings() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (payload: Partial<ProcurementSettings>) => procurementApi.updateSettings(payload), onSuccess: (data) => qc.setQueryData(settingsKey, data) });
}

/* ---- attachments ----------------------------------------------------------------------------------- */

export function useAttachments(entityType: AttachmentEntity, entityId: string | undefined) {
  return useQuery({ queryKey: attachmentKeys.list(entityType, entityId ?? ''), queryFn: () => procurementApi.listAttachments(entityType, entityId!), enabled: Boolean(entityId) });
}
export function useUploadAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ entityType, entityId, file }: { entityType: AttachmentEntity; entityId: string; file: File }) => {
      const presigned = await procurementApi.presign({ entityType, entityId, fileName: file.name, contentType: file.type || 'application/octet-stream', sizeBytes: file.size });
      const remote = /^https?:\/\//i.test(presigned.uploadUrl);
      if (remote) await procurementApi.uploadToUrl(presigned.uploadUrl, file);
      return { ...presigned, uploaded: remote };
    },
    onSuccess: (_r, v) => void qc.invalidateQueries({ queryKey: attachmentKeys.list(v.entityType, v.entityId) }),
  });
}

/* ---- lookups --------------------------------------------------------------------------------------- */

export function useSupplierLookup(q: string, enabled = true) {
  return useQuery({ queryKey: lookupKeys.suppliers(q), queryFn: () => lookupApi.suppliers(q), placeholderData: keepPreviousData, staleTime: 30_000, enabled });
}
export function useProductLookup(q: string, enabled = true) {
  return useQuery({ queryKey: lookupKeys.products(q), queryFn: () => lookupApi.products(q), placeholderData: keepPreviousData, staleTime: 30_000, enabled });
}
export function usePaymentTerms() {
  return useQuery({ queryKey: lookupKeys.paymentTerms, queryFn: lookupApi.paymentTerms, staleTime: 5 * 60_000 });
}
export function useWarehouseDetail(id: string | undefined) {
  return useQuery({ queryKey: lookupKeys.warehouse(id ?? ''), queryFn: () => lookupApi.warehouse(id!), enabled: Boolean(id), staleTime: 60_000 });
}

/** Warehouses the member may use (null scope = all); the API already filters, this keeps pickers consistent. */
export function useScopedWarehouses() {
  const { warehouseIds } = useAuth();
  const query = useQuery({ queryKey: lookupKeys.warehouses, queryFn: lookupApi.warehouses, staleTime: 60_000 });
  const scoped = useMemo<WarehouseLookup[]>(() => {
    const rows = query.data ?? [];
    return warehouseIds ? rows.filter((w) => warehouseIds.includes(w.id)) : rows;
  }, [query.data, warehouseIds]);
  const defaultId = scoped.find((w) => w.isDefault && w.status === 'ACTIVE')?.id ?? scoped.find((w) => w.status === 'ACTIVE')?.id ?? scoped[0]?.id ?? '';
  return { ...query, warehouses: scoped, defaultId, byId: (id: string | null | undefined) => scoped.find((w) => w.id === id) ?? (query.data ?? []).find((w) => w.id === id) };
}
