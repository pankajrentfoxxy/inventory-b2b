export interface Item {
  id: string;
  name: string;
  sku: string | null;
  type: 'GOODS' | 'SERVICE';
  unit: string;
  description: string | null;
  hsnCode: string | null;
  purchaseRate: number | null;
  sellingRate: number | null;
  taxId: string | null;
  tax: { id: string; name: string; rate: number } | null;
  preferredVendorId: string | null;
  preferredVendor: { id: string; displayName: string } | null;
  trackInventory: boolean;
  reorderLevel: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ItemListResponse {
  data: Item[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  counts: { ALL: number; ACTIVE: number; INACTIVE: number };
}

export interface ItemListParams {
  page: number;
  limit: number;
  search: string;
  status: string;
  type: string;
  sortBy: string;
  sortOrder: string;
}
