import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Ban, ChevronDown, ChevronRight, ClipboardCheck, PackageCheck, RefreshCw, Wrench } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, DescriptionList, DetailSkeleton, ErrorState, PageHeader, ReasonDialog, StatusBadge } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatDate, formatDateTime, formatMoney, formatQty, humanize } from '../../../lib/utils';
import { AttachmentsCard } from '../components/AttachmentsCard';
import { StatusBanner } from '../components/ProgressBar';
import { RetryPostingModal } from '../components/RetryPostingModal';
import { useCancelGrn, useGrn, usePurchaseOrder, useReceiveGrn, useWarehouseDetail } from '../hooks';
import { GRN_CANCELLABLE_STATUSES, type GrnLine } from '../types';

function LineRow({ line, bins }: { line: GrnLine; bins: Map<string, string> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="align-top">
        <td className="px-4 py-3 text-slate-500 tabular">{line.lineNo}</td>
        <td className="px-4 py-3">
          <p className="font-medium text-slate-900">{line.item.name}</p>
          <p className="text-xs text-slate-500 font-mono">{line.item.sku}</p>
          {line.conditionNote && <p className="text-xs text-amber-700 mt-0.5">{line.conditionNote}</p>}
        </td>
        <td className="px-4 py-3 text-right tabular">
          {formatQty(line.qty)} {line.item.unitCode}
        </td>
        <td className="px-4 py-3 text-right tabular hidden md:table-cell">{formatMoney(line.unitCost)}</td>
        <td className="px-4 py-3 hidden md:table-cell">{line.binId ? bins.get(line.binId) ?? <span className="font-mono text-xs">{line.binId.slice(0, 8)}</span> : <span className="text-slate-400">-</span>}</td>
        <td className="px-4 py-3 hidden lg:table-cell">
          {line.qcStatus === 'DONE' ? (
            <span className="text-xs tabular">
              <span className="text-emerald-700">{formatQty(line.qcPassQty)} pass</span> / <span className={line.qcFailQty > 0 ? 'text-red-700' : 'text-slate-500'}>{formatQty(line.qcFailQty)} fail</span>
            </span>
          ) : (
            <StatusBadge status={line.qcStatus} dot={false} />
          )}
          {line.lotId && (
            <Link to={`/qc/lots/${line.lotId}`} className="block text-xs text-brand-700 hover:underline mt-0.5">
              Open QC lot
            </Link>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          {line.serials.length > 0 && (
            <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline">
              {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              {line.serials.length} serial{line.serials.length === 1 ? '' : 's'}
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="px-4 pb-3 bg-slate-50/60">
            <ul className="flex flex-wrap gap-1.5 pt-2">
              {line.serials.map((s) => (
                <li key={s.serialNo} className="rounded-md bg-white ring-1 ring-inset ring-slate-200 px-2 py-1 text-xs font-mono text-slate-800">
                  {s.serialNo}
                  {s.imei && <span className="text-slate-400"> / {s.imei}</span>}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

export function GrnDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const grn = useGrn(id);
  const po = usePurchaseOrder(grn.data?.poId);
  const warehouse = useWarehouseDetail(grn.data?.warehouseId);
  const receive = useReceiveGrn();
  const cancel = useCancelGrn();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [retryOpen, setRetryOpen] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const crumbs = [{ label: 'Purchases' }, { label: 'Goods receipts', to: '/purchases/receipts' }, { label: grn.data?.number ?? '...' }];

  if (grn.isLoading) {
    return (
      <>
        <PageHeader title="Goods receipt" breadcrumbs={crumbs} />
        <DetailSkeleton />
      </>
    );
  }
  if (grn.isError || !grn.data) {
    return (
      <>
        <PageHeader title="Goods receipt" breadcrumbs={crumbs} />
        <Card>
          <ErrorState message={grn.error ? toApiError(grn.error).message : 'Goods receipt not found'} onRetry={() => void grn.refetch()} />
        </Card>
      </>
    );
  }
  const g = grn.data;
  const bins = new Map<string, string>((warehouse.data?.locations ?? []).flatMap((loc) => loc.bins.map((b) => [b.id, `${loc.code} / ${b.code}`] as const)));
  const canReceive = g.status === 'DRAFT' && hasPermission('grn.create');
  const canCancel = GRN_CANCELLABLE_STATUSES.includes(g.status) && hasPermission('grn.cancel');
  const canRetry = g.status === 'POSTING_FAILED' && hasPermission('grn.create');

  const doReceive = async () => {
    try {
      const saved = await receive.mutateAsync({ id: g.id });
      toast.success(`${saved.number} received; posting to inventory`);
    } catch (err) {
      toast.error(toApiError(err).message);
    }
  };
  const doCancel = async (reason: string) => {
    setCancelError(null);
    try {
      const saved = await cancel.mutateAsync({ id: g.id, reason });
      toast.success(saved.status === 'CANCELLATION_PENDING' ? `${saved.number}: cancellation requested; QC lots must be untouched` : `${saved.number} cancelled`);
      setCancelOpen(false);
    } catch (err) {
      const e = toApiError(err);
      if (e.code === 'GRN_NOT_CANCELLABLE') setCancelError(e.message);
      else setCancelError(e.details.find((d) => d.path === 'reason')?.message ?? null);
      toast.error(e.message);
    }
  };

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2 flex-wrap">
            <span className="font-mono">{g.number}</span>
            <StatusBadge status={g.status} />
          </span>
        }
        subtitle={
          <span>
            {g.supplier.displayName} - {g.warehouse.code} - received {formatDate(g.receivedDate)}
          </span>
        }
        breadcrumbs={crumbs}
        actions={
          <>
            {canRetry && (
              <Button icon={Wrench} onClick={() => setRetryOpen(true)}>
                Fix serials and retry
              </Button>
            )}
            {canReceive && (
              <Button icon={PackageCheck} loading={receive.isPending} onClick={() => void doReceive()}>
                Receive
              </Button>
            )}
            {canCancel && (
              <Button variant="dangerOutline" icon={Ban} onClick={() => setCancelOpen(true)}>
                Cancel
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-4">
        {g.status === 'RECEIVED' && (
          <StatusBanner
            tone="info"
            title="Posting to inventory..."
            message={grn.polling ? 'Stock is being updated. This page refreshes every 2 seconds.' : 'The posting is taking longer than usual. It will complete in the background.'}
            action={grn.pollingExpired ? <Button size="sm" variant="secondary" icon={RefreshCw} loading={grn.isFetching} onClick={() => void grn.refetch()}>Refresh</Button> : <RefreshCw className="w-4 h-4 animate-spin text-brand-600" aria-label="Refreshing" />}
          />
        )}
        {g.status === 'CANCELLATION_PENDING' && (
          <StatusBanner tone="warning" title="Cancellation in progress" message={g.statusReason ? `Reason: ${g.statusReason}. Waiting for QC and inventory to reverse the receipt.` : 'Waiting for QC and inventory to reverse the receipt.'} action={grn.pollingExpired ? <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => void grn.refetch()}>Refresh</Button> : <RefreshCw className="w-4 h-4 animate-spin text-amber-600" aria-label="Refreshing" />} />
        )}
        {g.status === 'POSTING_FAILED' && <StatusBanner tone="danger" title="Inventory rejected this receipt" message={g.statusReason ?? 'No reason recorded.'} action={canRetry ? <Button size="sm" icon={Wrench} onClick={() => setRetryOpen(true)}>Fix serials and retry</Button> : undefined} />}
        {g.status === 'QC_PENDING' && (
          <StatusBanner
            tone="warning"
            title="Waiting for quality inspection"
            message={
              <span>
                {g.qcProgress.done} of {g.qcProgress.total} lines inspected.{g.statusReason ? ` ${g.statusReason}` : ''}
              </span>
            }
            action={
              <Button size="sm" variant="secondary" icon={ClipboardCheck} onClick={() => navigate(`/qc/lots?sourceId=${g.id}`)}>
                Open QC lots
              </Button>
            }
          />
        )}
        {g.status === 'QC_COMPLETED' && (
          <StatusBanner
            tone="success"
            title="QC completed"
            message={
              <span className="tabular">
                {formatQty(g.qcProgress.passQty)} passed, {formatQty(g.qcProgress.failQty)} failed across {g.qcProgress.total} line{g.qcProgress.total === 1 ? '' : 's'}.
              </span>
            }
            action={
              <Button size="sm" variant="secondary" icon={ClipboardCheck} onClick={() => navigate(`/qc/lots?sourceId=${g.id}`)}>
                View QC lots
              </Button>
            }
          />
        )}
        {g.status === 'CANCELLED' && <StatusBanner tone="danger" title="Cancelled" message={g.statusReason ?? undefined} />}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader title="Purchase order and supplier" />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  { label: 'Purchase order', value: <Link to={`/purchases/orders/${g.poId}`} className="text-brand-700 hover:underline font-mono">{po.data?.number ?? 'Open order'}</Link> },
                  { label: 'Supplier', value: g.supplier.displayName },
                  { label: 'GSTIN', value: g.supplier.gstin, mono: true },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Warehouse" />
            <CardBody>
              <DescriptionList columns={1} items={[{ label: 'Warehouse', value: `${g.warehouse.code} - ${g.warehouse.name}` }, { label: 'State', value: g.warehouse.stateCode }, { label: 'Received into stock', value: g.receivedAt ? formatDateTime(g.receivedAt) : null }]} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Delivery details" />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  { label: 'Received date', value: formatDate(g.receivedDate) },
                  { label: 'Supplier invoice', value: g.supplierInvoiceNo ? `${g.supplierInvoiceNo}${g.supplierInvoiceDate ? ` (${formatDate(g.supplierInvoiceDate)})` : ''}` : null },
                  { label: 'Delivery note', value: g.deliveryNoteNo },
                  { label: 'Vehicle', value: g.vehicleNo, mono: true },
                  { label: 'Remarks', value: g.remarks },
                ]}
              />
            </CardBody>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <CardHeader title="Lines" description={`${g.lines.length} line${g.lines.length === 1 ? '' : 's'}; expand a serialized line to see its serials.`} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold w-10">#</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Product</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Qty</th>
                  <th className="text-right px-4 py-2.5 font-semibold hidden md:table-cell">Unit cost</th>
                  <th className="text-left px-4 py-2.5 font-semibold hidden md:table-cell">Bin</th>
                  <th className="text-left px-4 py-2.5 font-semibold hidden lg:table-cell">QC</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {g.lines.map((l) => (
                  <LineRow key={l.id} line={l} bins={bins} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <AttachmentsCard entityType="GRN" entityId={g.id} uploadPermission="grn.create" />
      </div>

      <ReasonDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={`Cancel ${g.number}`}
        message={
          g.status === 'QC_PENDING'
            ? 'The receipt is already in stock. Cancellation is requested from QC and inventory; it is refused if any lot has inspection results.'
            : g.status === 'POSTING_FAILED'
              ? 'The posting never reached inventory; the ordered quantities are restored on the purchase order.'
              : `This ${humanize(g.status).toLowerCase()} receipt will be cancelled.`
        }
        confirmLabel="Cancel receipt"
        loading={cancel.isPending}
        error={cancelError}
        onConfirm={({ reason }) => void doCancel(reason)}
      />
      <RetryPostingModal grn={g} open={retryOpen} onClose={() => setRetryOpen(false)} />
    </>
  );
}
