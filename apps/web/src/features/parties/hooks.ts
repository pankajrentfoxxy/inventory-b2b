import { useMemo } from 'react';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BANK_ACCOUNT_TYPE_LABELS, BANK_ACCOUNT_TYPES, COUNTRIES, INDIAN_STATES, PARTY_CURRENCIES, PARTY_GSTIN_REQUIRED_TREATMENTS, SALUTATIONS, VENDOR_LANGUAGES, VENDOR_TYPE_LABELS, VENDOR_TYPES, type PartyFormPayload } from '@b2b/shared';
import { toApiError } from '../../lib/api';
import { useSimpleMaster } from '../master/hooks';
import { partyApi, partyAudit, partyPurchaseOrders } from './api';
import { GST_TREATMENT_LABELS, GST_TREATMENTS, PARTY_META, type CustomFieldKind, type PartyFormOptions, type PartyListParams, type PartyType } from './types';

export const partyKeys = {
  all: (type: PartyType) => ['parties', type] as const,
  list: (type: PartyType, params: PartyListParams) => ['parties', type, 'list', params] as const,
  lookup: (type: PartyType, q: string) => ['parties', type, 'lookup', q] as const,
  detail: (type: PartyType, id: string) => ['parties', type, 'detail', id] as const,
  purchaseOrders: (id: string) => ['parties', 'SUPPLIER', 'purchase-orders', id] as const,
  audit: (id: string) => ['parties', 'audit', id] as const,
};

/** Cursor-paged list; pages accumulate under "Load more". */
export function useParties(type: PartyType, params: Omit<PartyListParams, 'cursor'>) {
  return useInfiniteQuery({
    queryKey: partyKeys.list(type, params),
    queryFn: ({ pageParam }) => partyApi(type).list({ ...params, cursor: pageParam || undefined }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

/** The vendor-form shaped record (GET .../:id/form) used by the detail and edit screens. */
export function useParty(type: PartyType, id: string | undefined) {
  return useQuery({ queryKey: partyKeys.detail(type, id ?? ''), queryFn: () => partyApi(type).getForm(id!), enabled: Boolean(id) });
}

/** ACTIVE parties matching the term (display name, code or GSTIN), 20 rows. */
export function usePartyLookup(type: PartyType, term: string, enabled = true) {
  return useQuery({ queryKey: partyKeys.lookup(type, term), queryFn: () => partyApi(type).lookup(term || undefined), placeholderData: keepPreviousData, staleTime: 30_000, enabled });
}

function currencyInfo(code: string) {
  let name: string = code;
  let symbol: string = code;
  try {
    name = new Intl.DisplayNames(['en'], { type: 'currency' }).of(code) ?? code;
  } catch {
    /* older browsers: keep the code */
  }
  try {
    symbol = new Intl.NumberFormat('en-IN', { style: 'currency', currency: code }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? code;
  } catch {
    /* keep the code */
  }
  return { code, name, symbol };
}

/** Stable empty list so the memoised options (and the form defaults) keep their identity. */
const NONE: never[] = [];

const CUSTOM_FIELD_KIND: Record<string, CustomFieldKind> = { TEXT: 'TEXT', NUMBER: 'NUMBER', DATE: 'DATE', BOOLEAN: 'BOOLEAN', SELECT: 'DROPDOWN' };

/**
 * Everything the form needs to render, in the shape of the legacy `/vendors/form-options`:
 * static lists from @b2b/shared plus the tenant's payment terms and custom fields (svc-master).
 */
export function usePartyFormOptions(type: PartyType) {
  const terms = useSimpleMaster('payment-terms');
  const fields = useSimpleMaster('custom-fields');
  const entity = PARTY_META[type].customFieldEntity;

  // Reading the masters needs master / purchase / sales / inventory view; without it the form still
  // works, just without payment terms or custom fields (403 is treated as an empty list).
  const forbidden = (q: { isError: boolean; error: unknown }) => q.isError && toApiError(q.error).status === 403;
  const termsForbidden = forbidden(terms);
  const fieldsForbidden = forbidden(fields);
  const termRows = terms.data ?? (termsForbidden ? NONE : undefined);
  const fieldRows = fields.data ?? (fieldsForbidden ? NONE : undefined);

  const data = useMemo<PartyFormOptions | undefined>(() => {
    if (!termRows || !fieldRows) return undefined;
    return {
      gstTreatments: GST_TREATMENTS.map((g) => ({ value: g, label: GST_TREATMENT_LABELS[g], requiresGstin: PARTY_GSTIN_REQUIRED_TREATMENTS.includes(g) })),
      sourcesOfSupply: INDIAN_STATES,
      paymentTerms: termRows.filter((t) => t.status === 'ACTIVE').map((t) => ({ id: t.id, name: t.name, days: t.days, isDefault: t.isDefault })),
      currencies: PARTY_CURRENCIES.map(currencyInfo),
      customFields: fieldRows
        .filter((f) => f.entity === entity && f.status === 'ACTIVE')
        .map((f) => ({ id: f.id, key: f.key, label: f.label, fieldType: CUSTOM_FIELD_KIND[f.dataType] ?? 'TEXT', options: f.options ?? [], isRequired: f.required })),
      salutations: SALUTATIONS,
      languages: VENDOR_LANGUAGES,
      countries: COUNTRIES,
      indianStates: INDIAN_STATES,
      vendorTypes: VENDOR_TYPES.map((v) => ({ value: v, label: VENDOR_TYPE_LABELS[v] })),
      bankAccountTypes: BANK_ACCOUNT_TYPES.map((b) => ({ value: b, label: BANK_ACCOUNT_TYPE_LABELS[b] })),
    };
  }, [termRows, fieldRows, entity]);

  return {
    data,
    isLoading: terms.isLoading || fields.isLoading,
    isError: (terms.isError && !termsForbidden) || (fields.isError && !fieldsForbidden),
    error: termsForbidden ? fields.error : terms.error ?? fields.error,
    refetch: () => {
      void terms.refetch();
      void fields.refetch();
    },
  };
}

function useInvalidateParty(type: PartyType) {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: ['parties', type, 'list'] });
    void qc.invalidateQueries({ queryKey: ['parties', type, 'lookup'] });
    if (id) {
      void qc.invalidateQueries({ queryKey: partyKeys.detail(type, id) });
      void qc.invalidateQueries({ queryKey: partyKeys.audit(id) });
    }
  };
}

export function useCreateParty(type: PartyType) {
  const invalidate = useInvalidateParty(type);
  return useMutation({ mutationFn: ({ payload, idempotencyKey }: { payload: PartyFormPayload; idempotencyKey: string }) => partyApi(type).createForm(payload, idempotencyKey), onSuccess: () => invalidate() });
}
export function useUpdateParty(type: PartyType, id: string) {
  const invalidate = useInvalidateParty(type);
  return useMutation({ mutationFn: ({ payload, version }: { payload: PartyFormPayload; version: number }) => partyApi(type).updateForm(id, payload, version), onSuccess: () => invalidate(id) });
}
export function usePartyStatus(type: PartyType) {
  const invalidate = useInvalidateParty(type);
  return useMutation({ mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'INACTIVE' }) => partyApi(type).setStatus(id, status), onSuccess: (_d, v) => invalidate(v.id) });
}
export function useBlockParty(type: PartyType) {
  const invalidate = useInvalidateParty(type);
  return useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => partyApi(type).block(id, reason), onSuccess: (_d, v) => invalidate(v.id) });
}
export function useUnblockParty(type: PartyType) {
  const invalidate = useInvalidateParty(type);
  return useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => partyApi(type).unblock(id, reason), onSuccess: (_d, v) => invalidate(v.id) });
}
export function useDeleteParty(type: PartyType) {
  const invalidate = useInvalidateParty(type);
  return useMutation({ mutationFn: (id: string) => partyApi(type).remove(id), onSuccess: () => invalidate() });
}

/* ---- detail tabs ------------------------------------------------------------------ */

export function usePartyPurchaseOrders(supplierId: string, enabled = true) {
  return useQuery({ queryKey: partyKeys.purchaseOrders(supplierId), queryFn: () => partyPurchaseOrders(supplierId), enabled });
}

export function usePartyAudit(entityId: string) {
  return useInfiniteQuery({
    queryKey: partyKeys.audit(entityId),
    queryFn: ({ pageParam }) => partyAudit(entityId, pageParam || undefined),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
