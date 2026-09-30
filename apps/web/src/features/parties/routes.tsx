import type { RouteDef } from '../../router/types';
import { PARTY_META } from './types';
import { PartyListPage } from './pages/PartyListPage';
import { PartyCreatePage } from './pages/PartyCreatePage';
import { PartyEditPage } from './pages/PartyEditPage';
import { PartyDetailPage } from './pages/PartyDetailPage';

/** Vendors (svc-party SUPPLIER) and customers (`/v1/party`). Same pages, parameterised by party type. */
export const partiesRoutes: RouteDef[] = (['SUPPLIER', 'CUSTOMER'] as const).flatMap((type) => {
  const meta = PARTY_META[type];
  const base = `/parties/${meta.route}`;
  return [
    { path: base, permission: meta.view, element: <PartyListPage key={type} type={type} /> },
    { path: `${base}/new`, permission: meta.manage, element: <PartyCreatePage key={type} type={type} /> },
    { path: `${base}/:id/edit`, permission: meta.manage, element: <PartyEditPage key={type} type={type} /> },
    { path: `${base}/:id`, permission: meta.view, element: <PartyDetailPage key={type} type={type} /> },
  ];
});
