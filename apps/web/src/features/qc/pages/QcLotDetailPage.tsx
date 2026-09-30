import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CheckCheck, Gavel, Play, RefreshCw, RotateCcw, Save } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, DescriptionList, DetailSkeleton, ErrorState, Field, Input, PageHeader, ReasonDialog, StatusBadge, Textarea } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatDateTime, formatQty, humanize } from '../../../lib/utils';
import { LaptopSpecsView } from '../../../components/LaptopSpecs';
import { StatusBanner } from '../../procurement/components/ProgressBar';
import { useScopedWarehouses } from '../../procurement/hooks';
import { DefectCodeChips, GradeSelect } from '../components/inputs';
import { LaptopInspectionPanel, laptopDecideBlocker } from '../components/LaptopInspection';
import { SerialResultsTable, rowsFromLot, type SerialRowState } from '../components/SerialResultsTable';
import { useConditionGrades, useDecideLot, useDefectCodes, useQcLot, useReopenLot, useSaveResults, useStartLot } from '../hooks';
import type { QcLotDetail, UnitResultInput } from '../types';

function explain(code: string, message: string) {
  switch (code) {
    case 'QC_RESULTS_INCOMPLETE':
      return `${message} Record a result for every unit before deciding.`;
    case 'QC_DEFECT_REQUIRED':
      return `${message} Pick at least one defect code for failed units.`;
    case 'QC_ALREADY_POSTED':
      return `${message} Closed lots cannot be reopened; use an adjustment instead.`;
    case 'QC_LOT_CANCELLED':
      return `${message}`;
    case 'QC_UNITS_ON_HOLD':
    case 'QC_LAPTOP_CHECK_REQUIRED':
    case 'QC_LAPTOP_CHECK_FAILED':
      return message;
    case 'QC_INVALID_TRANSITION':
      return `${message} Reload to see the current status.`;
    default:
      return message;
  }
}

function SerialInspection({ lot, canInspect }: { lot: QcLotDetail; canInspect: boolean }) {
  const grades = useConditionGrades();
  const defects = useDefectCodes();
  const save = useSaveResults();
  const [rows, setRows] = useState<SerialRowState[]>(() => rowsFromLot(lot.serials, lot.results));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const editable = canInspect && (lot.status === 'OPEN' || lot.status === 'IN_INSPECTION');

  // Re-sync from the server when results change, keeping local unsaved edits.
  useEffect(() => {
    setRows((prev) => rowsFromLot(lot.serials, lot.results).map((fresh) => {
      const local = prev.find((p) => p.serialNo === fresh.serialNo);
      return local?.dirty ? local : fresh;
    }));
  }, [lot.serials, lot.results]);

  const update = (i: number, patch: Partial<SerialRowState>) => setRows((prev) => prev.map((r, k) => (k === i ? { ...r, ...patch, dirty: true } : r)));
  const dirty = rows.filter((r) => r.dirty && r.result !== '');
  const remaining = rows.filter((r) => !r.saved && r.result === '');

  const bulkPass = () => setRows((prev) => prev.map((r) => (!r.saved && r.result === '' ? { ...r, result: 'PASS', dirty: true } : r)));

  const submit = async () => {
    const results: UnitResultInput[] = dirty.map((r) => ({ serialNo: r.serialNo, result: r.result as 'PASS' | 'FAIL', gradeCode: r.gradeCode || null, defectCodes: r.defectCodes, remarks: r.remarks.trim() || null, checklistAnswers: r.checklistAnswers }));
    if (results.length === 0) return;
    setErrors({});
    try {
      const saved = await save.mutateAsync({ id: lot.id, results });
      setRows(rowsFromLot(saved.serials, saved.results));
      toast.success(`${results.length} result${results.length === 1 ? '' : 's'} saved`);
    } catch (err) {
      const e = toApiError(err);
      const map: Record<string, string> = {};
      for (const d of e.details) {
        const m = /^results\.(\d+)/.exec(d.path);
        if (m && dirty[Number(m[1])]) map[dirty[Number(m[1])].serialNo] = d.message;
      }
      setErrors(map);
      toast.error(explain(e.code, e.message));
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Unit results"
        description={`${lot.progress?.inspected ?? 0} of ${lot.progress?.total ?? lot.serials.length} units have a saved result${dirty.length ? `; ${dirty.length} unsaved` : ''}.`}
        actions={
          editable ? (
            <>
              <Button size="sm" variant="secondary" icon={CheckCheck} onClick={bulkPass} disabled={remaining.length === 0}>
                Pass remaining ({remaining.length})
              </Button>
              <Button size="sm" icon={Save} loading={save.isPending} onClick={() => void submit()} disabled={dirty.length === 0}>
                Save results
              </Button>
            </>
          ) : undefined
        }
      />
      {grades.isError || defects.isError ? <ErrorState message="Could not load grades or defect codes" onRetry={() => { void grades.refetch(); void defects.refetch(); }} /> : null}
      <SerialResultsTable rows={rows} onChange={update} grades={grades.data ?? []} defects={defects.data ?? []} checklist={lot.checklist?.items ?? []} disabled={!editable} errors={errors} />
    </Card>
  );
}

function QuantityDecision({ lot, canApprove, onDecided }: { lot: QcLotDetail; canApprove: boolean; onDecided: () => void }) {
  const grades = useConditionGrades();
  const defects = useDefectCodes();
  const decide = useDecideLot();
  const [passQty, setPassQty] = useState(String(lot.qty));
  const [failQty, setFailQty] = useState('0');
  const [gradeCode, setGradeCode] = useState('');
  const [defectCodes, setDefectCodes] = useState<string[]>([]);
  const [remarks, setRemarks] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const decidable = canApprove && (lot.status === 'OPEN' || lot.status === 'IN_INSPECTION');
  const sum = (Number(passQty) || 0) + (Number(failQty) || 0);

  const submit = async () => {
    setErrors({});
    try {
      await decide.mutateAsync({ id: lot.id, payload: { passQty: Number(passQty) || 0, failQty: Number(failQty) || 0, gradeCode: gradeCode || null, defectCodes, remarks: remarks.trim() || null } });
      toast.success(`${lot.number} decided; posting to inventory`);
      onDecided();
    } catch (err) {
      const e = toApiError(err);
      setErrors(e.fieldErrors);
      toast.error(explain(e.code, e.message));
    }
  };

  if (!decidable && lot.status !== 'OPEN' && lot.status !== 'IN_INSPECTION') return null;
  return (
    <Card>
      <CardHeader title="Decision" description={`Pass + fail must equal the lot quantity (${formatQty(lot.qty)} ${lot.item.unitCode}).`} />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <Field label="Pass quantity" error={errors.passQty}>
            <Input sanitize="decimal" value={passQty} onChange={(e) => { setPassQty(e.target.value); setFailQty(String(Math.max(0, lot.qty - (Number(e.target.value) || 0)))); }} disabled={!decidable} className="text-right tabular h-11 text-base" error={Boolean(errors.passQty) || sum !== lot.qty} />
          </Field>
          <Field label="Fail quantity" error={errors.failQty}>
            <Input sanitize="decimal" value={failQty} onChange={(e) => { setFailQty(e.target.value); setPassQty(String(Math.max(0, lot.qty - (Number(e.target.value) || 0)))); }} disabled={!decidable} className="text-right tabular h-11 text-base" error={Boolean(errors.failQty) || sum !== lot.qty} />
          </Field>
        </div>
        {sum !== lot.qty && <p className="text-xs text-amber-700">Pass + fail is {formatQty(sum)}; the lot has {formatQty(lot.qty)}.</p>}
        <Field label="Condition grade for passed units">
          <div className="max-w-md">
            <GradeSelect grades={grades.data ?? []} value={gradeCode} onChange={setGradeCode} disabled={!decidable} />
          </div>
        </Field>
        {(Number(failQty) || 0) > 0 && (
          <Field label="Defect codes" required error={errors.defectCodes}>
            <DefectCodeChips codes={defects.data ?? []} value={defectCodes} onChange={setDefectCodes} disabled={!decidable} required />
          </Field>
        )}
        <Field label="Remarks" error={errors.remarks}>
          <Textarea rows={2} value={remarks} maxLength={500} onChange={(e) => setRemarks(e.target.value)} disabled={!decidable} />
        </Field>
        {decidable && (
          <div className="flex justify-end">
            <Button icon={Gavel} size="lg" loading={decide.isPending} onClick={() => void submit()} disabled={sum !== lot.qty}>
              Decide
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export function QcLotDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission, session } = useAuth();
  const lot = useQcLot(id);
  const { byId } = useScopedWarehouses();
  const start = useStartLot();
  const decide = useDecideLot();
  const reopen = useReopenLot();
  const grades = useConditionGrades();
  const [reopenOpen, setReopenOpen] = useState(false);
  const [decideOpen, setDecideOpen] = useState(false);
  const [decideGrade, setDecideGrade] = useState('');
  const [heldSerials, setHeldSerials] = useState<string | null>(null);
  const crumbs = [{ label: 'Quality' }, { label: 'QC lots', to: '/qc/lots' }, { label: lot.data?.number ?? '...' }];
  const canInspect = hasPermission('qc.inspect');
  const canApprove = hasPermission('qc.approve');

  const data = lot.data;
  const allInspected = useMemo(() => Boolean(data && data.mode === 'SERIAL' && data.progress && data.progress.inspected >= data.progress.total), [data]);
  const laptopLot = Boolean(data?.isLaptop && data.expectedSpecs && data.mode === 'SERIAL');
  const decideBlocker = data && laptopLot ? laptopDecideBlocker(data) : allInspected ? null : 'Every unit needs a saved result first';

  if (lot.isLoading) {
    return (
      <>
        <PageHeader title="QC lot" breadcrumbs={crumbs} />
        <DetailSkeleton />
      </>
    );
  }
  if (lot.isError || !data) {
    return (
      <>
        <PageHeader title="QC lot" breadcrumbs={crumbs} />
        <Card>
          <ErrorState message={lot.error ? toApiError(lot.error).message : 'QC lot not found'} onRetry={() => void lot.refetch()} />
        </Card>
      </>
    );
  }

  const run = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn();
      toast.success(success);
    } catch (err) {
      const e = toApiError(err);
      toast.error(explain(e.code, e.message));
      throw err;
    }
  };

  const doDecide = async (reason: string) => {
    setHeldSerials(null);
    try {
      await decide.mutateAsync({ id: data.id, payload: { gradeCode: decideGrade || null, defectCodes: [], remarks: reason || null } });
      toast.success(`${data.number} decided; posting to inventory`);
      setDecideOpen(false);
    } catch (err) {
      const e = toApiError(err);
      if (e.code === 'QC_UNITS_ON_HOLD') {
        setHeldSerials(e.details[0]?.message ?? '');
        setDecideOpen(false);
      }
      toast.error(explain(e.code, e.message));
    }
  };

  const sourceTo = data.sourceType === 'GRN' ? `/purchases/receipts/${data.sourceId}` : null;
  const inspectorLabel = data.inspectorId ? (data.inspectorId === session?.user.id ? 'You' : data.inspectorId.slice(0, 8)) : null;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2 flex-wrap">
            <span className="font-mono">{data.number}</span>
            <StatusBadge status={data.status} />
          </span>
        }
        subtitle={
          <span>
            <span className="font-mono text-xs">{data.item.sku}</span> {data.item.name} - {formatQty(data.qty)} {laptopLot ? (data.qty === 1 ? 'laptop' : 'laptops') : data.item.unitCode} - {data.mode === 'SERIAL' ? (laptopLot ? 'laptop inspection' : 'serial inspection') : 'quantity inspection'}
            {data.expectedSpecs && <LaptopSpecsView specs={data.expectedSpecs} variant="inline" className="mt-0.5" />}
          </span>
        }
        breadcrumbs={crumbs}
        actions={
          <>
            {data.status === 'OPEN' && canInspect && (
              <Button icon={Play} loading={start.isPending} onClick={() => void run(() => start.mutateAsync(data.id), 'Inspection started').catch(() => undefined)}>
                Start inspection
              </Button>
            )}
            {data.mode === 'SERIAL' && (data.status === 'OPEN' || data.status === 'IN_INSPECTION') && canApprove && (
              <Button icon={Gavel} onClick={() => setDecideOpen(true)} disabled={Boolean(decideBlocker)} title={decideBlocker ?? undefined}>
                Decide
              </Button>
            )}
            {data.status === 'DECIDED' && canApprove && (
              <Button variant="secondary" icon={RotateCcw} onClick={() => setReopenOpen(true)}>
                Reopen
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-4">
        {laptopLot && (data.status === 'OPEN' || data.status === 'IN_INSPECTION') && canApprove && decideBlocker && (
          <p className="text-xs text-slate-600 flex items-center gap-1.5">
            <Gavel className="w-3.5 h-3.5 text-slate-400" /> Decide is available once every laptop is passed or failed: {decideBlocker}.
          </p>
        )}
        {heldSerials !== null && (data.status === 'OPEN' || data.status === 'IN_INSPECTION') && (
          <StatusBanner
            tone="warning"
            title="Laptops on hold"
            message={
              <span>
                Pass or fail these laptops before deciding the lot: <span className="font-mono">{heldSerials || 'see the list below'}</span>
              </span>
            }
            action={
              <Button size="sm" variant="secondary" onClick={() => setHeldSerials(null)}>
                Dismiss
              </Button>
            }
          />
        )}
        {data.status === 'DECIDED' && <StatusBanner tone="info" title="Posting to inventory..." message={lot.polling ? `${laptopLot ? `${formatQty(data.passQty)} moving to Available, ${formatQty(data.failQty)} to Rejected` : `Pass ${formatQty(data.passQty)}, fail ${formatQty(data.failQty)}`}. Stock buckets are being updated; this page refreshes every 2 seconds.` : 'The posting is taking longer than usual. It will complete in the background.'} action={lot.pollingExpired ? <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => void lot.refetch()}>Refresh</Button> : <RefreshCw className="w-4 h-4 animate-spin text-brand-600" aria-label="Refreshing" />} />}
        {data.status === 'CLOSED' && (
          <StatusBanner
            tone="success"
            title="Posted to inventory"
            message={
              <span className="tabular">
                {laptopLot ? `${formatQty(data.passQty)} moved to Available, ${formatQty(data.failQty)} to Rejected.` : `${formatQty(data.passQty)} passed, ${formatQty(data.failQty)} failed.`} Closed {formatDateTime(data.closedAt)}.
              </span>
            }
          />
        )}
        {data.status === 'CANCELLED' && <StatusBanner tone="danger" title="Lot cancelled" message={data.statusReason ?? undefined} />}
        {data.status === 'IN_INSPECTION' && data.statusReason && <StatusBanner tone="warning" title="Reopened" message={data.statusReason} />}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader title="Lot" />
            <CardBody>
              <DescriptionList
                columns={3}
                items={[
                  { label: 'Source', value: sourceTo ? <Link to={sourceTo} className="text-brand-700 hover:underline font-mono">{data.sourceNumber ?? humanize(data.sourceType)}</Link> : data.sourceNumber ?? humanize(data.sourceType) },
                  { label: 'Warehouse', value: byId(data.warehouseId) ? `${byId(data.warehouseId)!.code} - ${byId(data.warehouseId)!.name}` : data.warehouseId.slice(0, 8) },
                  { label: 'Mode', value: data.mode === 'SERIAL' ? 'Serial (per unit)' : 'Quantity' },
                  { label: 'Quantity', value: `${formatQty(data.qty)} ${data.item.unitCode}` },
                  { label: 'Inspector', value: inspectorLabel },
                  { label: 'Started', value: data.startedAt ? formatDateTime(data.startedAt) : null },
                  { label: 'Checklist', value: data.checklist ? `${data.checklist.name} (v${data.checklistVersion ?? data.checklist.version})` : 'None' },
                  { label: 'Decided', value: data.decidedAt ? formatDateTime(data.decidedAt) : null },
                  { label: 'Created', value: formatDateTime(data.createdAt) },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={laptopLot ? 'Laptop' : 'Item'} />
            <CardBody>
              <DescriptionList columns={1} items={[{ label: laptopLot ? 'Laptop SKU' : 'SKU', value: data.item.sku, mono: true }, { label: laptopLot ? 'Name' : 'Product', value: data.item.name }, { label: 'Serialized', value: data.item.isSerialized ? `Yes${data.item.requiresImei ? ' (IMEI)' : ''}` : 'No' }, { label: 'Serial pattern', value: data.item.serialPattern, mono: true }]} />
            </CardBody>
          </Card>
        </div>

        {laptopLot ? (
          <LaptopInspectionPanel key={`${data.id}:${data.status}`} lot={data} canInspect={canInspect} />
        ) : data.mode === 'SERIAL' ? <SerialInspection key={`${data.id}:${data.status}`} lot={data} canInspect={canInspect} /> : <QuantityDecision key={`${data.id}:${data.status}`} lot={data} canApprove={canApprove} onDecided={() => undefined} />}
      </div>

      <ReasonDialog
        open={decideOpen}
        onClose={() => setDecideOpen(false)}
        title={`Decide ${data.number}`}
        message={
          <div className="space-y-3">
            {laptopLot && data.progress ? (
              <p>
                <span className="font-medium text-emerald-700">
                  {data.progress.passed} laptop{data.progress.passed === 1 ? '' : 's'} move to Available
                </span>{' '}
                and <span className="font-medium text-red-700">{data.progress.failed} to Rejected</span>. Laptops without a grade get the grade chosen here.
              </p>
            ) : (
              <p>Pass and fail counts come from the saved unit results. Units without a grade get the grade chosen here.</p>
            )}
            <GradeSelect grades={grades.data ?? []} value={decideGrade} onChange={setDecideGrade} />
          </div>
        }
        confirmLabel="Decide"
        tone="primary"
        reasonRequired={false}
        reasonLabel="Remarks (optional)"
        loading={decide.isPending}
        onConfirm={({ reason }) => void doDecide(reason)}
      />
      <ReasonDialog open={reopenOpen} onClose={() => setReopenOpen(false)} title={`Reopen ${data.number}`} message="The decision is withdrawn and results can be edited. Lots already posted to inventory (Closed) cannot be reopened." confirmLabel="Reopen" reasonRequired={false} loading={reopen.isPending} onConfirm={({ reason }) => void run(() => reopen.mutateAsync({ id: data.id, reason: reason || null }), `${data.number} reopened`).then(() => setReopenOpen(false)).catch(() => undefined)} />
    </>
  );
}
