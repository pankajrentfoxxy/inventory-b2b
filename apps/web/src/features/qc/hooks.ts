import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { shouldRetryWithSameKey, useIdempotencyKey } from '../../hooks/useIdempotencyKey';
import { toApiError } from '../../lib/api';
import { usePollingWindow } from '../procurement/hooks';
import { qcApi } from './api';
import type { ChecklistInput, DecideInput, QcLotDetail, QcLotListParams, UnitResultInput } from './types';

export const qcKeys = {
  lots: ['qc', 'lots'] as const,
  lotList: (params: QcLotListParams) => ['qc', 'lots', 'list', params] as const,
  lot: (id: string) => ['qc', 'lots', 'detail', id] as const,
  checklists: ['qc', 'checklists'] as const,
  defectCodes: ['qc', 'defect-codes'] as const,
  grades: ['lookup', 'condition-grades'] as const,
};

export function useQcLots(params: QcLotListParams, enabled = true) {
  return useQuery({ queryKey: qcKeys.lotList(params), queryFn: () => qcApi.listLots(params), placeholderData: keepPreviousData, enabled });
}

/** Lot detail; polls every 2 s (up to 30 s) while DECIDED and not yet CLOSED by the inventory posting. */
export function useQcLot(id: string | undefined) {
  const qc = useQueryClient();
  const cached = id ? qc.getQueryData<QcLotDetail>(qcKeys.lot(id)) : undefined;
  const posting = cached?.status === 'DECIDED';
  const expired = usePollingWindow(posting);
  const query = useQuery({ queryKey: qcKeys.lot(id ?? ''), queryFn: () => qcApi.getLot(id!), enabled: Boolean(id), refetchInterval: posting && !expired ? 2000 : false });
  return { ...query, polling: posting && !expired, pollingExpired: posting && expired };
}

function useInvalidateLots() {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: qcKeys.lots });
    if (id) void qc.invalidateQueries({ queryKey: qcKeys.lot(id) });
  };
}

export function useStartLot() {
  const invalidate = useInvalidateLots();
  return useMutation({ mutationFn: (id: string) => qcApi.startLot(id), onSuccess: (r) => invalidate(r.id) });
}
export function useSaveResults() {
  const invalidate = useInvalidateLots();
  return useMutation({ mutationFn: ({ id, results }: { id: string; results: UnitResultInput[] }) => qcApi.saveResults(id, results), onSuccess: (r) => invalidate(r.id) });
}
export function useDecideLot() {
  const invalidate = useInvalidateLots();
  const idem = useIdempotencyKey();
  return useMutation({
    mutationFn: async (vars: { id: string; payload: DecideInput }) => {
      const key = idem.keyFor(vars);
      try {
        const r = await qcApi.decideLot(vars.id, vars.payload, key);
        idem.reset();
        return r;
      } catch (err) {
        if (!shouldRetryWithSameKey(toApiError(err).status)) idem.reset();
        throw err;
      }
    },
    onSuccess: (r) => invalidate(r.id),
  });
}
export function useReopenLot() {
  const invalidate = useInvalidateLots();
  return useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string | null }) => qcApi.reopenLot(id, reason), onSuccess: (r) => invalidate(r.id) });
}

export function useChecklists() {
  return useQuery({ queryKey: qcKeys.checklists, queryFn: qcApi.listChecklists });
}
export function useCreateChecklist() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (payload: ChecklistInput) => qcApi.createChecklist(payload), onSuccess: () => void qc.invalidateQueries({ queryKey: qcKeys.checklists }) });
}
export function useChecklistStatus() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'INACTIVE' }) => qcApi.setChecklistStatus(id, status), onSuccess: () => void qc.invalidateQueries({ queryKey: qcKeys.checklists }) });
}
export function useDefectCodes() {
  return useQuery({ queryKey: qcKeys.defectCodes, queryFn: qcApi.listDefectCodes, staleTime: 60_000 });
}
export function useUpsertDefectCode() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (payload: { code: string; description: string }) => qcApi.upsertDefectCode(payload), onSuccess: () => void qc.invalidateQueries({ queryKey: qcKeys.defectCodes }) });
}
export function useDefectCodeStatus() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ code, status }: { code: string; status: 'ACTIVE' | 'INACTIVE' }) => qcApi.setDefectCodeStatus(code, status), onSuccess: () => void qc.invalidateQueries({ queryKey: qcKeys.defectCodes }) });
}
export function useConditionGrades() {
  return useQuery({ queryKey: qcKeys.grades, queryFn: qcApi.conditionGrades, staleTime: 5 * 60_000 });
}
