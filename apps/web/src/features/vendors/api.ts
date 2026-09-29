import type { VendorPayload, VendorStatus, VendorContactPayload, VendorAddressPayload, VendorBankAccountPayload } from '@b2b/shared';
import { api } from '../../lib/api';
import type {
  Paginated,
  VendorActivityItem,
  VendorAddress,
  VendorBankAccount,
  VendorContact,
  VendorDetail,
  VendorDocument,
  VendorFormOptions,
  VendorListResponse,
  VendorNote,
  VendorTransactions,
} from './types';

export interface VendorListParams {
  page: number;
  limit: number;
  search: string;
  status: string;
  sortBy: string;
  sortOrder: string;
  gstTreatmentId: string;
  sourceOfSupplyId: string;
  vendorType: string;
  tagOptionId: string;
}

export const vendorApi = {
  list: (params: VendorListParams) => api.get<VendorListResponse>('/vendors', { params }).then((r) => r.data),
  get: (id: string) => api.get<{ data: VendorDetail }>(`/vendors/${id}`).then((r) => r.data.data),
  create: (payload: VendorPayload) => api.post<{ data: VendorDetail }>('/vendors', payload).then((r) => r.data.data),
  update: (id: string, payload: VendorPayload) => api.put<{ data: VendorDetail }>(`/vendors/${id}`, payload).then((r) => r.data.data),
  updateStatus: (id: string, status: VendorStatus, reason?: string) =>
    api.patch<{ data: VendorDetail }>(`/vendors/${id}/status`, { status, reason }).then((r) => r.data.data),
  remove: (id: string) => api.delete(`/vendors/${id}`).then((r) => r.data),

  activity: (id: string, page = 1, limit = 25) =>
    api.get<Paginated<VendorActivityItem>>(`/vendors/${id}/activity`, { params: { page, limit } }).then((r) => r.data),
  transactions: (id: string) => api.get<{ data: VendorTransactions }>(`/vendors/${id}/transactions`).then((r) => r.data.data),

  addContact: (id: string, body: VendorContactPayload) => api.post<{ data: VendorContact }>(`/vendors/${id}/contacts`, body).then((r) => r.data.data),
  updateContact: (id: string, contactId: string, body: VendorContactPayload) =>
    api.put<{ data: VendorContact }>(`/vendors/${id}/contacts/${contactId}`, body).then((r) => r.data.data),
  removeContact: (id: string, contactId: string) => api.delete(`/vendors/${id}/contacts/${contactId}`).then((r) => r.data),

  addAddress: (id: string, body: VendorAddressPayload) => api.post<{ data: VendorAddress }>(`/vendors/${id}/addresses`, body).then((r) => r.data.data),
  updateAddress: (id: string, addressId: string, body: VendorAddressPayload) =>
    api.put<{ data: VendorAddress }>(`/vendors/${id}/addresses/${addressId}`, body).then((r) => r.data.data),
  removeAddress: (id: string, addressId: string) => api.delete(`/vendors/${id}/addresses/${addressId}`).then((r) => r.data),

  addBankAccount: (id: string, body: VendorBankAccountPayload) =>
    api.post<{ data: VendorBankAccount }>(`/vendors/${id}/bank-accounts`, body).then((r) => r.data.data),
  updateBankAccount: (id: string, accountId: string, body: VendorBankAccountPayload) =>
    api.put<{ data: VendorBankAccount }>(`/vendors/${id}/bank-accounts/${accountId}`, body).then((r) => r.data.data),
  removeBankAccount: (id: string, accountId: string) => api.delete(`/vendors/${id}/bank-accounts/${accountId}`).then((r) => r.data),
  revealBankAccount: (id: string, accountId: string) =>
    api.get<{ data: { id: string; accountNumber: string } }>(`/vendors/${id}/bank-accounts/${accountId}/reveal`).then((r) => r.data.data),

  notes: (id: string) => api.get<{ data: VendorNote[] }>(`/vendors/${id}/notes`).then((r) => r.data.data),
  addNote: (id: string, body: string) => api.post<{ data: VendorNote }>(`/vendors/${id}/notes`, { body }).then((r) => r.data.data),
  removeNote: (id: string, noteId: string) => api.delete(`/vendors/${id}/notes/${noteId}`).then((r) => r.data),

  documents: (id: string) => api.get<{ data: VendorDocument[] }>(`/vendors/${id}/documents`).then((r) => r.data.data),
  uploadDocument: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<{ data: VendorDocument }>(`/vendors/${id}/documents`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data.data);
  },
  downloadDocument: async (id: string, doc: VendorDocument) => {
    const res = await api.get(`/vendors/${id}/documents/${doc.id}/download`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  removeDocument: (id: string, documentId: string) => api.delete(`/vendors/${id}/documents/${documentId}`).then((r) => r.data),

  formOptions: () => api.get<{ data: VendorFormOptions }>('/settings/vendor-form-options').then((r) => r.data.data),
  gstLookup: (gstin: string) => api.get<{ data: GstLookupResult }>('/integrations/gst/lookup', { params: { gstin } }).then((r) => r.data.data),
};

export interface GstAddress {
  nature: string | null;
  addressLine1: string;
  addressLine2: string;
  city: string;
  district: string | null;
  state: string;
  stateCode: string | null;
  postalCode: string;
  isPrincipal: boolean;
}

export interface GstLookupResult {
  gstin: string;
  legalName: string | null;
  tradeName: string | null;
  status: string | null;
  taxpayerType: string | null;
  constitution: string | null;
  registeredDate: string | null;
  eInvoiceApplicable: boolean | null;
  natureOfBusiness: string[];
  stateCode: string | null;
  suggestedGstTreatmentCode: string | null;
  addresses: GstAddress[];
  source: string;
}
