import { api, unwrap, withIdempotencyKey } from '../../lib/api';
import type { ChecklistInput, ConditionGrade, DecideInput, QcChecklist, QcDefectCode, QcLot, QcLotDetail, QcLotListParams, UnitResultInput } from './types';

const BASE = '/v1/qc';

export const qcApi = {
  listLots: (params: QcLotListParams) => api.get<{ data: QcLot[] }>(`${BASE}/lots`, { params }).then(unwrap),
  getLot: (id: string) => api.get<{ data: QcLotDetail }>(`${BASE}/lots/${id}`).then(unwrap),
  startLot: (id: string) => api.post<{ data: QcLot }>(`${BASE}/lots/${id}/start`, {}).then(unwrap),
  saveResults: (id: string, results: UnitResultInput[]) => api.put<{ data: QcLot }>(`${BASE}/lots/${id}/results`, { results }).then(unwrap),
  decideLot: (id: string, payload: DecideInput, idempotencyKey: string) => api.post<{ data: QcLot }>(`${BASE}/lots/${id}/decide`, payload, withIdempotencyKey(idempotencyKey)).then(unwrap),
  reopenLot: (id: string, reason: string | null) => api.post<{ data: QcLot }>(`${BASE}/lots/${id}/reopen`, reason ? { reason } : {}).then(unwrap),

  listChecklists: () => api.get<{ data: QcChecklist[] }>(`${BASE}/checklists`).then(unwrap),
  createChecklist: (payload: ChecklistInput) => api.post<{ data: QcChecklist }>(`${BASE}/checklists`, payload).then(unwrap),
  setChecklistStatus: (id: string, status: 'ACTIVE' | 'INACTIVE') => api.post<{ data: QcChecklist }>(`${BASE}/checklists/${id}/status`, { status }).then(unwrap),
  listDefectCodes: () => api.get<{ data: QcDefectCode[] }>(`${BASE}/defect-codes`).then(unwrap),
  upsertDefectCode: (payload: { code: string; description: string }) => api.post<{ data: QcDefectCode }>(`${BASE}/defect-codes`, payload).then(unwrap),
  setDefectCodeStatus: (code: string, status: 'ACTIVE' | 'INACTIVE') => api.post<{ data: QcDefectCode }>(`${BASE}/defect-codes/${encodeURIComponent(code)}/status`, { status }).then(unwrap),

  /** Master lookup for the grade select. */
  conditionGrades: () => api.get<{ data: ConditionGrade[] }>('/v1/master/condition-grades').then(unwrap),
};
