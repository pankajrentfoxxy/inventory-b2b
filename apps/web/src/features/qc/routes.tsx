import type { RouteDef } from '../../router/types';
import { QcLotListPage } from './pages/QcLotListPage';
import { QcLotDetailPage } from './pages/QcLotDetailPage';
import { QcChecklistsPage } from './pages/QcChecklistsPage';

/** Quality control (svc-qc): inspection work queue, lot detail, checklists and defect codes. */
export const qcRoutes: RouteDef[] = [
  { path: '/qc/lots', permission: ['qc.view', 'grn.view'], element: <QcLotListPage /> },
  { path: '/qc/lots/:id', permission: ['qc.view', 'grn.view'], element: <QcLotDetailPage /> },
  { path: '/qc/checklists', permission: 'qc.view', element: <QcChecklistsPage /> },
];
