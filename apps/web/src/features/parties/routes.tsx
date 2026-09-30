import type { RouteDef } from '../../router/types';
import { PARTY_META } from './types';
import { PartyListPage } from './pages/PartyListPage';
import { PartyCreatePage } from './pages/PartyCreatePage';
import { PartyDetailPage } from './pages/PartyDetailPage';

/** Suppliers and customers (svc-party, `/v1/party`). Same pages, parameterised by party type. */
export const partiesRoutes: RouteDef[] = (['SUPPLIER', 'CUSTOMER'] as const).flatMap((type) => {
  const meta = PARTY_META[type];
  const base = `/parties/${meta.path}`;
  return [
    { path: base, permission: meta.view, element: <PartyListPage type={type} /> },
    { path: `${base}/new`, permission: meta.manage, element: <PartyCreatePage type={type} /> },
    { path: `${base}/:id`, permission: meta.view, element: <PartyDetailPage type={type} /> },
  ];
});
