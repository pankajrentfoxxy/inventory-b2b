import axios from 'axios';
import { api, unwrap, withIdempotencyKey } from '../../lib/api';
import type { Attachment, AttachmentEntity, Grn, GrnInput, GrnListParams, PaymentTermLookup, PoCommand, PoInput, PoListParams, PoPatch, PoRevisionSnapshot, PresignResult, ProcurementSettings, ProductSnapshot, PurchaseOrder, PurchaseOrderDetail, ReceivableLines, RetrySerials, ReviseInput, SupplierSnapshot, WarehouseLookup } from './types';

const BASE = '/v1/procurement';

export const procurementApi = {
  /* purchase orders */
  listPurchaseOrders: (params: PoListParams) => api.get<{ data: PurchaseOrder[] }>(`${BASE}/purchase-orders`, { params }).then(unwrap),
  getPurchaseOrder: (id: string) => api.get<{ data: PurchaseOrderDetail }>(`${BASE}/purchase-orders/${id}`).then(unwrap),
  createPurchaseOrder: (payload: PoInput, idempotencyKey: string) => api.post<{ data: PurchaseOrder }>(`${BASE}/purchase-orders`, payload, withIdempotencyKey(idempotencyKey)).then(unwrap),
  patchPurchaseOrder: (id: string, payload: PoPatch, version: number) => api.patch<{ data: PurchaseOrder }>(`${BASE}/purchase-orders/${id}`, payload, { headers: { 'If-Match': String(version) } }).then(unwrap),
  commandPurchaseOrder: (id: string, command: Exclude<PoCommand, 'revise'>, body: { reason?: string; comment?: string }, idempotencyKey: string) =>
    api.post<{ data: PurchaseOrder }>(`${BASE}/purchase-orders/${id}/${command}`, body, withIdempotencyKey(idempotencyKey)).then(unwrap),
  revisePurchaseOrder: (id: string, payload: ReviseInput, idempotencyKey: string) => api.post<{ data: PurchaseOrder }>(`${BASE}/purchase-orders/${id}/revise`, payload, withIdempotencyKey(idempotencyKey)).then(unwrap),
  getRevision: (id: string, revision: number) => api.get<{ data: PoRevisionSnapshot }>(`${BASE}/purchase-orders/${id}/revisions/${revision}`).then(unwrap),
  receivableLines: (id: string) => api.get<{ data: ReceivableLines }>(`${BASE}/purchase-orders/${id}/receivable-lines`).then(unwrap),

  /* goods receipts */
  listGrns: (params: GrnListParams) => api.get<{ data: Grn[] }>(`${BASE}/grns`, { params }).then(unwrap),
  getGrn: (id: string) => api.get<{ data: Grn }>(`${BASE}/grns/${id}`).then(unwrap),
  createGrn: (payload: GrnInput, idempotencyKey: string, receive: boolean) => api.post<{ data: Grn }>(`${BASE}/grns`, payload, withIdempotencyKey(idempotencyKey, { params: receive ? { receive: 'true' } : undefined })).then(unwrap),
  receiveGrn: (id: string, idempotencyKey: string) => api.post<{ data: Grn }>(`${BASE}/grns/${id}/receive`, {}, withIdempotencyKey(idempotencyKey)).then(unwrap),
  cancelGrn: (id: string, reason: string, idempotencyKey: string) => api.post<{ data: Grn }>(`${BASE}/grns/${id}/cancel`, { reason }, withIdempotencyKey(idempotencyKey)).then(unwrap),
  retryPosting: (id: string, serials: RetrySerials | null, idempotencyKey: string) => api.post<{ data: Grn }>(`${BASE}/grns/${id}/retry-posting`, serials ? { serials } : {}, withIdempotencyKey(idempotencyKey)).then(unwrap),

  /* settings */
  getSettings: () => api.get<{ data: ProcurementSettings }>(`${BASE}/settings`).then(unwrap),
  updateSettings: (payload: Partial<ProcurementSettings>) => api.put<{ data: ProcurementSettings }>(`${BASE}/settings`, payload).then(unwrap),

  /* attachments */
  listAttachments: (entityType: AttachmentEntity, entityId: string) => api.get<{ data: Attachment[] }>(`${BASE}/attachments`, { params: { entityType, entityId } }).then(unwrap),
  presign: (payload: { entityType: AttachmentEntity; entityId: string; fileName: string; contentType: string; sizeBytes: number }) => api.post<{ data: PresignResult }>(`${BASE}/attachments/presign`, payload).then(unwrap),
  /** Direct PUT to the storage URL; only when the presign returned a real http(s) URL. */
  uploadToUrl: (uploadUrl: string, file: File) => axios.put(uploadUrl, file, { headers: { 'Content-Type': file.type || 'application/octet-stream' }, timeout: 120_000 }),
};

/** Lookups owned by other services; called directly so this module does not import other features. */
export const lookupApi = {
  suppliers: (q: string) => api.get<{ data: SupplierSnapshot[] }>('/v1/party/lookups/suppliers', { params: { q } }).then(unwrap),
  /** Active laptop configurations only: a PO line orders an exact configuration. */
  products: (q: string) => api.get<{ data: ProductSnapshot[] }>('/v1/master/lookups/products', { params: { q, status: 'ACTIVE', laptop: 'true' } }).then(unwrap),
  warehouses: () => api.get<{ data: WarehouseLookup[] }>('/v1/master/warehouses').then(unwrap),
  warehouse: (id: string) => api.get<{ data: WarehouseLookup }>(`/v1/master/warehouses/${id}`).then(unwrap),
  paymentTerms: () => api.get<{ data: PaymentTermLookup[] }>('/v1/master/payment-terms').then(unwrap),
};
