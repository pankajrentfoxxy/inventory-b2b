export interface ReceiveLine {
  id: string;
  purchaseOrderLineId: string;
  itemId: string | null;
  name: string;
  sku: string | null;
  unit: string | null;
  orderedQuantity: number;
  quantity: number;
  receivedToDate: number;
}

export interface PurchaseReceive {
  id: string;
  receiveNumber: string;
  receivedDate: string;
  status: 'RECEIVED' | 'CANCELLED';
  purchaseOrder: { id: string; purchaseOrderNumber: string; status: string };
  vendor: { id: string; displayName: string };
  location: { id: string; name: string } | null;
  notes: string | null;
  totalQuantity: number;
  lines: ReceiveLine[];
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  createdByName: string | null;
}

export interface ReceiveListResponse {
  data: PurchaseReceive[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  counts: Record<string, number>;
}

export interface ReceiveListParams {
  page: number;
  limit: number;
  search: string;
  status: string;
  vendorId: string;
  purchaseOrderId: string;
  sortBy: string;
  sortOrder: string;
}
