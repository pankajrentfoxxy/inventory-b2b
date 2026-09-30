import { Link, useParams } from 'react-router-dom';
import { ArrowRight, History } from 'lucide-react';
import { Card, CardBody, CardHeader, DescriptionList, DetailSkeleton, EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { formatDate, formatDateTime, formatMoney, humanize } from '../../../lib/utils';
import { RefLink } from '../components/RefLink';
import { SerialTraceability } from '../components/SerialTraceability';
import { useSerial, useSerialHistory, useWarehouseMaps } from '../hooks';

function IdLink({ id, to, label }: { id: string | null; to: (id: string) => string; label: string }) {
  if (!id) return null;
  return (
    <Link to={to(id)} className="text-brand-700 hover:underline font-mono text-[13px]">
      {label} {id.slice(0, 8)}...
    </Link>
  );
}

export function SerialDetailPage() {
  const { id } = useParams<{ id: string }>();
  const serial = useSerial(id);
  const history = useSerialHistory(id);
  const maps = useWarehouseMaps();
  const u = serial.data;
  const crumbs = [{ label: 'Inventory' }, { label: 'Serial Numbers', to: '/inventory/serials' }, { label: u?.serialNo ?? '...' }];

  if (serial.isLoading) {
    return (
      <>
        <PageHeader title="Serial number" breadcrumbs={crumbs} />
        <DetailSkeleton />
      </>
    );
  }
  if (serial.isError || !u) {
    const e = toApiError(serial.error);
    return (
      <>
        <PageHeader title="Serial number" breadcrumbs={crumbs} />
        <Card>
          <ErrorState title={e.status === 404 ? 'Serial number not found' : 'Could not load serial number'} message={e.message} onRetry={() => void serial.refetch()} />
        </Card>
      </>
    );
  }

  const references = [
    { id: u.poId, label: 'PO', to: (x: string) => `/purchases/orders/${x}` },
    { id: u.grnId, label: 'GRN', to: (x: string) => `/purchases/receipts/${x}` },
    { id: u.qcLotId, label: 'QC lot', to: (x: string) => `/qc/lots/${x}` },
    { id: u.soId, label: 'SO', to: (x: string) => `/sales/orders/${x}` },
    { id: u.shipmentId, label: 'Shipment', to: (x: string) => `/dispatch/shipments/${x}` },
  ].filter((r) => r.id);

  return (
    <>
      <PageHeader
        title={<span className="font-mono">{u.serialNo}</span>}
        subtitle={u.item ? <Link to={`/inventory/stock/${u.itemId}`} className="hover:text-brand-700">{u.item.sku} - {u.item.name}</Link> : null}
        breadcrumbs={crumbs}
        actions={<StatusBadge status={u.bucket} />}
      />
      <div className="mb-5">
        <SerialTraceability unit={u} history={history.data} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-1">
          <CardHeader title="Unit" />
          <CardBody>
            <DescriptionList
              columns={1}
              items={[
                { label: u.item?.specs ? 'Laptop' : 'Item', value: u.item ? <Link to={`/inventory/stock/${u.itemId}`} className="text-brand-700 hover:underline">{u.item.sku} - {u.item.name}</Link> : u.itemId },
                { label: 'IMEI', value: u.imei, mono: true },
                { label: 'Bucket', value: <StatusBadge status={u.bucket} /> },
                { label: 'Warehouse', value: u.warehouseId ? maps.warehouseLabel(u.warehouseId) : null },
                { label: 'Bin', value: u.warehouseId ? maps.binLabel(u.binId) : null, mono: true },
                { label: 'Grade', value: u.gradeCode },
                { label: 'QC status', value: u.qcStatus ? <StatusBadge status={u.qcStatus} dot={false} /> : null },
                { label: 'Unit cost', value: formatMoney(u.unitCost) },
                { label: 'Warranty ends', value: u.warrantyEnd ? formatDate(u.warrantyEnd) : null },
                { label: 'Customer', value: u.partyId ? <Link to={`/parties/customers/${u.partyId}`} className="text-brand-700 hover:underline font-mono text-[13px]">{u.partyId.slice(0, 8)}...</Link> : null },
                {
                  label: 'References',
                  value: references.length ? (
                    <div className="flex flex-col gap-1">
                      {references.map((r) => (
                        <IdLink key={r.label} id={r.id} to={r.to} label={r.label} />
                      ))}
                    </div>
                  ) : null,
                },
                { label: 'Last updated', value: formatDateTime(u.updatedAt) },
              ]}
            />
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="History" description="Every bucket transition of this unit, oldest first." />
          <CardBody>
            {history.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            ) : history.isError ? (
              <ErrorState message={toApiError(history.error).message} onRetry={() => void history.refetch()} />
            ) : !history.data || history.data.length === 0 ? (
              <EmptyState icon={History} title="No history recorded" />
            ) : (
              <ol className="relative border-l border-slate-200 ml-1">
                {history.data.map((e) => (
                  <li key={e.id} className="relative pl-6 pb-5 last:pb-0">
                    <span className="absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-white bg-brand-500 -translate-x-1/2" />
                    <div className="flex flex-wrap items-center gap-2">
                      {e.fromBucket ? <StatusBadge status={e.fromBucket} dot={false} /> : <span className="text-xs text-slate-400">(new)</span>}
                      <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                      {e.toBucket ? <StatusBadge status={e.toBucket} dot={false} /> : <span className="text-xs text-slate-400">(out)</span>}
                      <span className="text-sm font-medium text-slate-900 ml-1">{humanize(e.postingType)}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      <RefLink refType={e.refType} refId={e.refId} refNumber={e.refNumber} />
                      {e.warehouseId && <span>{maps.warehouseLabel(e.warehouseId)} / {maps.binLabel(e.binId)}</span>}
                      <span>by {e.actorId ? `user ${e.actorId.slice(0, 8)}...` : 'system'}</span>
                      <span>{formatDateTime(e.occurredAt)}</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
