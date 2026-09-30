import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, FileText, Laptop, MapPin, PackageCheck } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, Skeleton, StatusBadge } from '../../../components/ui';
import { LaptopSpecsView } from '../../../components/LaptopSpecs';
import { cn } from '../../../lib/utils';
import { useGrn } from '../../procurement/hooks';
import { useQcLot } from '../../qc/hooks';
import type { SerialDetail, SerialEvent } from '../types';

const BUCKET_LABEL: Record<string, string> = { AVAILABLE: 'Available', REJECTED: 'Rejected', QC_HOLD: 'QC hold' };

function Step({ icon: Icon, title, children, last }: { icon: typeof Laptop; title: string; children: ReactNode; last?: boolean }) {
  return (
    <li className={cn('relative pl-10', !last && 'pb-5')}>
      {!last && <span className="absolute left-[15px] top-8 bottom-0 w-px bg-slate-200" aria-hidden="true" />}
      <span className="absolute left-0 top-0 w-8 h-8 rounded-full bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200 flex items-center justify-center">
        <Icon className="w-4 h-4" />
      </span>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</p>
      <div className="mt-0.5 text-sm text-slate-800 min-w-0">{children}</div>
    </li>
  );
}

function Missing({ text = 'Not linked' }: { text?: string }) {
  return <span className="text-slate-400">{text}</span>;
}

/**
 * serial -> laptop SKU + specs -> PO -> GRN (vendor) -> QC lot (result for this serial) -> current bucket.
 * Numbers come from the GRN / QC lot documents; the unit's history supplies them when those cannot be read.
 */
export function SerialTraceability({ unit, history }: { unit: SerialDetail; history: SerialEvent[] | undefined }) {
  const grn = useGrn(unit.grnId ?? undefined);
  const lot = useQcLot(unit.qcLotId ?? undefined);
  const refNumber = (type: string, id: string | null) => (id ? history?.find((e) => e.refType === type && e.refId === id)?.refNumber ?? null : null);

  const poNumber = grn.data?.poNumber ?? refNumber('PO', unit.poId);
  const grnNumber = grn.data?.number ?? refNumber('GRN', unit.grnId);
  const lotNumber = lot.data?.number ?? refNumber('QC_LOT', unit.qcLotId);
  const qcResult = lot.data?.results.find((r) => r.serialNo.toUpperCase() === unit.serialNo.toUpperCase()) ?? null;
  const specs = unit.item?.specs ?? null;
  const short = (id: string) => `${id.slice(0, 8)}...`;

  return (
    <Card>
      <CardHeader title="Traceability" description="Where this laptop came from and where it is now." />
      <CardBody>
        <ol>
          <Step icon={Laptop} title="Laptop configuration">
            {unit.item ? (
              <>
                <Link to={`/inventory/stock/${unit.itemId}`} className="text-brand-700 hover:underline">
                  <span className="font-mono font-semibold">{unit.item.sku}</span> - {unit.item.name}
                </Link>
                {specs && <LaptopSpecsView specs={specs} variant="grid" className="mt-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3" />}
              </>
            ) : (
              <span className="font-mono text-xs">{short(unit.itemId)}</span>
            )}
          </Step>
          <Step icon={FileText} title="Purchase order">
            {unit.poId ? (
              <Link to={`/purchases/orders/${unit.poId}`} className="text-brand-700 hover:underline font-mono">
                {poNumber ?? short(unit.poId)}
              </Link>
            ) : (
              <Missing text="No purchase order (opening stock or adjustment)" />
            )}
            {grn.data && <span className="text-slate-500"> - vendor {grn.data.supplier.displayName}</span>}
          </Step>
          <Step icon={PackageCheck} title="Goods receipt">
            {unit.grnId ? (
              <>
                <Link to={`/purchases/receipts/${unit.grnId}`} className="text-brand-700 hover:underline font-mono">
                  {grnNumber ?? short(unit.grnId)}
                </Link>
                {grn.isLoading && <Skeleton className="inline-block h-3 w-24 ml-2 align-middle" />}
                {grn.data && <span className="text-slate-500"> - received {grn.data.receivedDate.slice(0, 10)} into {grn.data.warehouse.code}</span>}
              </>
            ) : (
              <Missing />
            )}
          </Step>
          <Step icon={ClipboardCheck} title="QC lot">
            {unit.qcLotId ? (
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/qc/lots/${unit.qcLotId}`} className="text-brand-700 hover:underline font-mono">
                  {lotNumber ?? short(unit.qcLotId)}
                </Link>
                {lot.isLoading && <Skeleton className="h-3 w-24" />}
                {qcResult ? (
                  <Badge tone={qcResult.result === 'PASS' ? 'green' : qcResult.result === 'FAIL' ? 'red' : 'amber'} dot>
                    {qcResult.result === 'PASS' ? 'Pass' : qcResult.result === 'FAIL' ? 'Fail' : 'Hold'}
                  </Badge>
                ) : unit.qcStatus ? (
                  <StatusBadge status={unit.qcStatus} dot={false} />
                ) : null}
                {qcResult?.gradeCode && <span className="text-xs text-slate-500">grade {qcResult.gradeCode}</span>}
                {qcResult?.laptopCheck?.assetTag && <span className="text-xs text-slate-500 font-mono">asset {qcResult.laptopCheck.assetTag}</span>}
                {qcResult && qcResult.defectCodes.length > 0 && <span className="text-xs text-red-700 font-mono">{qcResult.defectCodes.join(', ')}</span>}
              </div>
            ) : (
              <Missing text="No QC lot" />
            )}
          </Step>
          <Step icon={MapPin} title="Current bucket" last>
            <span className="inline-flex items-center gap-2">
              <StatusBadge status={unit.bucket} label={BUCKET_LABEL[unit.bucket]} />
              {unit.bucket === 'QC_HOLD' && <span className="text-xs text-slate-500">not available until QC passes</span>}
            </span>
          </Step>
        </ol>
      </CardBody>
    </Card>
  );
}
