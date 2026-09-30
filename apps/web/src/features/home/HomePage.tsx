import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Boxes, ClipboardCheck, ClipboardList, PackageCheck, SlidersHorizontal, Truck } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, EmptyState, PageHeader, Stat, StatGrid } from '../../components/ui';
import { api, unwrap } from '../../lib/api';
import { useAuth } from '../../lib/auth';

interface PoRow { id: string; number: string; status: string; total: number }
interface GrnRow { id: string; number: string; status: string }
interface LotRow { id: string; number: string; status: string }
interface AdjRow { id: string; number: string; status: string }

/** Landing page: work queues for the signed-in member, driven only by what they may see. */
export function HomePage() {
  const { session, hasPermission } = useAuth();
  const navigate = useNavigate();
  const canPo = hasPermission('purchase.view');
  const canGrn = hasPermission('grn.view');
  const canQc = hasPermission('qc.view');
  const canInv = hasPermission('inventory.view');

  const awaiting = useQuery({ queryKey: ['home', 'po-awaiting'], queryFn: () => api.get<{ data: PoRow[] }>('/v1/procurement/purchase-orders', { params: { awaitingApproval: 'true', limit: 50 } }).then(unwrap), enabled: canPo });
  const failed = useQuery({ queryKey: ['home', 'grn-failed'], queryFn: () => api.get<{ data: GrnRow[] }>('/v1/procurement/grns', { params: { status: 'POSTING_FAILED', limit: 50 } }).then(unwrap), enabled: canGrn });
  const qcPending = useQuery({ queryKey: ['home', 'grn-qc'], queryFn: () => api.get<{ data: GrnRow[] }>('/v1/procurement/grns', { params: { status: 'QC_PENDING', limit: 50 } }).then(unwrap), enabled: canGrn });
  const lots = useQuery({ queryKey: ['home', 'lots-open'], queryFn: () => api.get<{ data: LotRow[] }>('/v1/qc/lots', { params: { status: 'OPEN', limit: 50 } }).then(unwrap), enabled: canQc });
  const adjustments = useQuery({ queryKey: ['home', 'adj-pending'], queryFn: () => api.get<{ data: AdjRow[] }>('/v1/inventory/adjustments', { params: { status: 'PENDING_APPROVAL', limit: 50 } }).then(unwrap), enabled: canInv });

  const tiles = [
    canPo && { label: 'Orders awaiting approval', value: awaiting.data?.length ?? 0, loading: awaiting.isLoading, icon: ClipboardList, tone: 'amber' as const, to: '/purchases/orders?awaitingApproval=true' },
    canGrn && { label: 'Receipts in QC', value: qcPending.data?.length ?? 0, loading: qcPending.isLoading, icon: PackageCheck, tone: 'blue' as const, to: '/purchases/receipts?status=QC_PENDING' },
    canGrn && { label: 'Receipts failed to post', value: failed.data?.length ?? 0, loading: failed.isLoading, icon: PackageCheck, tone: (failed.data?.length ? 'red' : 'default') as 'red' | 'default', to: '/purchases/receipts?status=POSTING_FAILED' },
    canQc && { label: 'QC lots to inspect', value: lots.data?.length ?? 0, loading: lots.isLoading, icon: ClipboardCheck, tone: 'amber' as const, to: '/qc/lots?status=OPEN' },
    canInv && { label: 'Adjustments to approve', value: adjustments.data?.length ?? 0, loading: adjustments.isLoading, icon: SlidersHorizontal, tone: 'amber' as const, to: '/inventory/adjustments?status=PENDING_APPROVAL' },
  ].filter(Boolean) as { label: string; value: number; loading: boolean; icon: typeof ClipboardList; tone: 'amber' | 'blue' | 'red' | 'default'; to: string }[];

  const shortcuts = [
    hasPermission('purchase.create') && { label: 'New purchase order', to: '/purchases/orders/new', icon: ClipboardList },
    hasPermission('grn.create') && { label: 'Receive goods', to: '/purchases/receipts/new', icon: PackageCheck },
    hasPermission('inventory.view') && { label: 'Stock on hand', to: '/inventory/stock', icon: Boxes },
    hasPermission('supplier.view') && { label: 'Vendors', to: '/parties/vendors', icon: Truck },
    hasPermission('qc.view') && { label: 'QC queue', to: '/qc/lots', icon: ClipboardCheck },
  ].filter(Boolean) as { label: string; to: string; icon: typeof ClipboardList }[];

  return (
    <>
      <PageHeader title={`Welcome, ${session?.user.name?.split(' ')[0] ?? 'there'}`} subtitle={session?.tenant?.name} />
      {tiles.length > 0 ? (
        <StatGrid className="mb-5 md:grid-cols-5">
          {tiles.map((t) => (
            <Stat key={t.label} label={t.label} value={t.value} loading={t.loading} icon={t.icon} tone={t.tone} onClick={() => navigate(t.to)} />
          ))}
        </StatGrid>
      ) : (
        <EmptyState icon={Boxes} title="Nothing to show yet" hint="Your role does not include any work queues. Use the navigation on the left." />
      )}
      {shortcuts.length > 0 && (
        <Card>
          <CardHeader title="Shortcuts" />
          <CardBody className="flex flex-wrap gap-2">
            {shortcuts.map((s) => (
              <Button key={s.to} variant="secondary" icon={s.icon} iconRight={ArrowRight} onClick={() => navigate(s.to)}>
                {s.label}
              </Button>
            ))}
          </CardBody>
        </Card>
      )}
    </>
  );
}
