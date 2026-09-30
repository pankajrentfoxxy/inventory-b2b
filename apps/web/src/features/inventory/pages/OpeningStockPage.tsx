import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, Download, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, IconButton, Input, PageHeader, Select, StatusBadge, Tabs, Textarea } from '../../../components/ui';
import { shouldRetryWithSameKey, useIdempotencyKey } from '../../../hooks/useIdempotencyKey';
import { toApiError } from '../../../lib/api';
import { formatMoney, formatQty, humanize } from '../../../lib/utils';
import { masterLookupApi } from '../api';
import { BinSelect } from '../components/BinSelect';
import { ProductPicker } from '../components/ProductPicker';
import { SerialsTextarea, parseSerials } from '../components/SerialsTextarea';
import { WarehousePicker } from '../components/WarehousePicker';
import { describeInventoryError, lineIndexOf } from '../components/errors';
import { useImportOpeningStock, useOpeningStock, useScopedWarehouses, useWarehouseMaps, useWarehouses } from '../hooks';
import { OPENING_BUCKETS, type OpeningImportResult, type OpeningImportRow, type OpeningLineInput, type OpeningStockInput, type ProductLookup } from '../types';

/* ---- manual entry --------------------------------------------------------------- */

interface LineDraft {
  key: string;
  itemId: string;
  product: ProductLookup | null;
  bucket: (typeof OPENING_BUCKETS)[number];
  binId: string;
  qty: string;
  unitCost: string;
  gradeCode: string;
  serialsText: string;
}
let seq = 0;
const newLine = (): LineDraft => ({ key: `o${++seq}`, itemId: '', product: null, bucket: 'AVAILABLE', binId: '', qty: '', unitCost: '', gradeCode: '', serialsText: '' });

function toLineInput(l: LineDraft): OpeningLineInput {
  return {
    itemId: l.itemId,
    binId: l.binId || null,
    bucket: l.bucket,
    qty: Number(l.qty) || 0,
    unitCost: l.unitCost === '' ? 0 : Number(l.unitCost),
    gradeCode: l.gradeCode.trim() || null,
    serials: l.product?.isSerialized ? parseSerials(l.serialsText).map((serialNo) => ({ serialNo })) : [],
  };
}

function ManualEntry() {
  const navigate = useNavigate();
  const scoped = useScopedWarehouses();
  const maps = useWarehouseMaps();
  const post = useOpeningStock();
  const idempotency = useIdempotencyKey();
  const [step, setStep] = useState<1 | 2>(1);
  const [warehouseId, setWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>(() => [newLine()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lineErrors, setLineErrors] = useState<Record<string, Record<string, string>>>({});
  const [blocked, setBlocked] = useState<{ lineKey: string | null; message: string } | null>(null);

  useEffect(() => {
    if (!warehouseId && scoped.defaultId) setWarehouseId(scoped.defaultId);
  }, [scoped.defaultId, warehouseId]);

  const updateLine = (key: string, patch: Partial<LineDraft>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setLineErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  };
  const removeLine = (key: string) => setLines((ls) => (ls.length === 1 ? [newLine()] : ls.filter((l) => l.key !== key)));

  const filled = lines.filter((l) => l.itemId);
  const payload = useMemo<OpeningStockInput>(() => ({ warehouseId, notes: notes.trim() || null, lines: filled.map(toLineInput) }), [warehouseId, notes, filled]);
  const ready = Boolean(warehouseId) && filled.length > 0 && filled.every((l) => Number(l.qty) > 0 && l.unitCost !== '');

  const submit = async () => {
    setErrors({});
    setLineErrors({});
    setBlocked(null);
    try {
      const result = await post.mutateAsync({ payload, idempotencyKey: idempotency.keyFor(payload) });
      idempotency.reset();
      toast.success(`Opening stock posted: ${result.lines.length / 2} line(s), ${result.serials} serial(s)`);
      navigate(filled.length === 1 ? `/inventory/stock/${filled[0].itemId}` : `/inventory/stock?warehouseId=${warehouseId}`);
    } catch (err) {
      const e = toApiError(err);
      if (!shouldRetryWithSameKey(e.status)) idempotency.reset();
      const top: Record<string, string> = {};
      const perLine: Record<string, Record<string, string>> = {};
      for (const d of e.details) {
        const idx = lineIndexOf(d.path);
        const line = idx !== null ? filled[idx] : undefined;
        if (line) perLine[line.key] = { ...(perLine[line.key] ?? {}), [d.path.split('.')[2] ?? 'line']: d.message };
        else if (d.path) top[d.path] = d.message;
      }
      setErrors(top);
      setLineErrors(perLine);
      if (e.code === 'INV_OPENING_NOT_ALLOWED') {
        const idx = lineIndexOf(e.details[0]?.path);
        setBlocked({ lineKey: idx !== null ? filled[idx]?.key ?? null : null, message: describeInventoryError(e) });
      }
      toast.error(describeInventoryError(e));
      setStep(1);
    }
  };

  const th = 'text-[11px] uppercase tracking-wider text-slate-500 font-semibold px-3 py-2.5';

  return (
    <div className="space-y-5">
      <ol className="flex items-center gap-3 text-sm">
        {[1, 2].map((n) => (
          <li key={n} className="flex items-center gap-2">
            <span className={`w-6 h-6 rounded-full text-xs font-semibold flex items-center justify-center ${step === n ? 'bg-brand-600 text-white' : step > n ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{n}</span>
            <span className={step === n ? 'font-medium text-slate-900' : 'text-slate-500'}>{n === 1 ? 'Warehouse and lines' : 'Review and post'}</span>
            {n === 1 && <span className="text-slate-300 mx-1">/</span>}
          </li>
        ))}
      </ol>

      {blocked && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex gap-2" role="alert">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            {blocked.message} <Link to="/inventory/adjustments/new" className="underline font-medium">Start an adjustment</Link>
          </span>
        </div>
      )}

      {step === 1 ? (
        <>
          <Card>
            <CardBody className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Warehouse" required error={errors.warehouseId} htmlFor="os-warehouse">
                <WarehousePicker id="os-warehouse" value={warehouseId} onChange={(v) => { setWarehouseId(v); setLines((ls) => ls.map((l) => ({ ...l, binId: '' }))); }} error={Boolean(errors.warehouseId)} />
              </Field>
              <Field label="Notes" error={errors.notes} htmlFor="os-notes" className="md:col-span-2">
                <Input id="os-notes" sanitize="singleLine" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Stock take date, source of the counts" error={Boolean(errors.notes)} />
              </Field>
            </CardBody>
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title="Lines" description="Items that have never moved in this warehouse. Unit cost is required (it seeds the average cost)." actions={<Button size="sm" variant="secondary" icon={Plus} onClick={() => setLines((ls) => [...ls, newLine()])}>Add line</Button>} />
            {errors.lines && <p className="px-5 pt-3 text-xs text-red-600" role="alert">{errors.lines}</p>}
            {!warehouseId ? (
              <EmptyState title="Choose a warehouse first" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1040px] text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50/60">
                    <tr>
                      <th className={`${th} text-left w-[26%]`}>Item</th>
                      <th className={`${th} text-left w-32`}>Bucket</th>
                      <th className={`${th} text-left w-40`}>Bin</th>
                      <th className={`${th} text-right w-28`}>Qty</th>
                      <th className={`${th} text-right w-32`}>Unit cost</th>
                      <th className={`${th} text-left w-24`}>Grade</th>
                      <th className={`${th} text-left`}>Serials</th>
                      <th className="w-12" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lines.map((l) => {
                      const le = lineErrors[l.key] ?? {};
                      const isBlocked = blocked?.lineKey === l.key;
                      return (
                        <tr key={l.key} className={`align-top ${isBlocked ? 'bg-amber-50/60' : ''}`}>
                          <td className="px-3 py-3">
                            <ProductPicker value={l.itemId} onChange={(id, p) => updateLine(l.key, { itemId: id, product: p, serialsText: p?.isSerialized ? l.serialsText : '' })} error={Boolean(le.itemId)} />
                            {le.itemId && <p className="text-xs text-red-600 mt-1">{le.itemId}</p>}
                            {l.product && <p className="text-xs text-slate-500 mt-1">{l.product.unitCode}{l.product.isSerialized ? ' - serialized' : ''}</p>}
                          </td>
                          <td className="px-3 py-3">
                            <Select value={l.bucket} onChange={(e) => updateLine(l.key, { bucket: e.target.value as LineDraft['bucket'] })} options={OPENING_BUCKETS.map((b) => ({ value: b, label: humanize(b) }))} error={Boolean(le.bucket)} />
                          </td>
                          <td className="px-3 py-3">
                            <BinSelect warehouseId={warehouseId} value={l.binId} onChange={(v) => updateLine(l.key, { binId: v })} error={Boolean(le.binId)} />
                            {le.binId && <p className="text-xs text-red-600 mt-1">{le.binId}</p>}
                          </td>
                          <td className="px-3 py-3">
                            <Input sanitize="decimal" aria-label="Quantity" value={l.qty} onChange={(e) => updateLine(l.key, { qty: e.target.value })} error={Boolean(le.qty)} className="text-right tabular" />
                            {le.qty && <p className="text-xs text-red-600 mt-1 text-right">{le.qty}</p>}
                          </td>
                          <td className="px-3 py-3">
                            <Input sanitize="decimal" aria-label="Unit cost" value={l.unitCost} onChange={(e) => updateLine(l.key, { unitCost: e.target.value })} error={Boolean(le.unitCost)} className="text-right tabular" />
                            {le.unitCost && <p className="text-xs text-red-600 mt-1 text-right">{le.unitCost}</p>}
                          </td>
                          <td className="px-3 py-3">
                            <Input sanitize="code" aria-label="Grade" value={l.gradeCode} maxLength={20} onChange={(e) => updateLine(l.key, { gradeCode: e.target.value })} placeholder="A" error={Boolean(le.gradeCode)} />
                          </td>
                          <td className="px-3 py-3">
                            {l.product?.isSerialized ? <SerialsTextarea value={l.serialsText} onChange={(t) => updateLine(l.key, { serialsText: t })} expected={Math.trunc(Number(l.qty) || 0)} error={le.serials} rows={2} /> : <span className="text-xs text-slate-400">{l.product ? 'Not serialized' : '-'}</span>}
                          </td>
                          <td className="px-2 py-3 text-right">
                            <IconButton icon={Trash2} label="Remove line" onClick={() => removeLine(l.key)} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <div className="flex items-center gap-2">
            <Button onClick={() => setStep(2)} disabled={!ready}>Review</Button>
            <Button variant="ghost" onClick={() => navigate('/inventory/stock')}>Cancel</Button>
          </div>
        </>
      ) : (
        <>
          <Card className="overflow-hidden">
            <CardHeader title={`Posting to ${maps.warehouseLabel(warehouseId)}`} description={notes || 'No notes'} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/60">
                  <tr>
                    <th className={`${th} text-left`}>Item</th>
                    <th className={`${th} text-left`}>Bucket</th>
                    <th className={`${th} text-left`}>Bin</th>
                    <th className={`${th} text-right`}>Qty</th>
                    <th className={`${th} text-right`}>Unit cost</th>
                    <th className={`${th} text-right`}>Serials</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filled.map((l) => (
                    <tr key={l.key}>
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-slate-900">{l.product?.name ?? l.itemId}</p>
                        <p className="text-xs text-slate-500 font-mono">{l.product?.sku}</p>
                      </td>
                      <td className="px-3 py-2.5"><StatusBadge status={l.bucket} dot={false} /></td>
                      <td className="px-3 py-2.5 font-mono text-[13px]">{maps.binLabel(l.binId || null)}</td>
                      <td className="px-3 py-2.5 text-right tabular">{formatQty(Number(l.qty))} {l.product?.unitCode}</td>
                      <td className="px-3 py-2.5 text-right tabular">{formatMoney(Number(l.unitCost))}</td>
                      <td className="px-3 py-2.5 text-right tabular">{l.product?.isSerialized ? parseSerials(l.serialsText).length : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="flex items-center gap-2">
            <Button onClick={() => void submit()} loading={post.isPending}>Post opening stock</Button>
            <Button variant="secondary" onClick={() => setStep(1)} disabled={post.isPending}>Back</Button>
          </div>
        </>
      )}
    </div>
  );
}

/* ---- bulk import ----------------------------------------------------------------- */

interface ParsedRow {
  row: number;
  raw: string;
  itemRef: string;
  warehouseRef: string;
  qty: string;
  unitCost: string;
  serials: string[];
  problem?: string;
}

function splitRow(line: string): string[] {
  const sep = line.includes('\t') ? '\t' : ',';
  return line.split(sep).map((c) => c.trim());
}

/** Case-insensitive match for UUIDs and codes. */
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function toCsv(rows: string[][]): string {
  const cell = (v: string) => (v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v.split('"').join('""')}"` : v);
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

function BulkImport() {
  const warehouses = useWarehouses();
  const importRows = useImportOpeningStock();
  const [text, setText] = useState('');
  const [resolving, setResolving] = useState(false);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [result, setResult] = useState<OpeningImportResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const parse = (): ParsedRow[] =>
    text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((raw, i) => {
        const [itemRef = '', warehouseRef = '', qty = '', unitCost = '', serials = ''] = splitRow(raw);
        const row: ParsedRow = { row: i + 1, raw, itemRef, warehouseRef, qty, unitCost, serials: serials ? serials.split(';').map((s) => s.trim()).filter(Boolean) : [] };
        if (!itemRef || !warehouseRef || !qty || unitCost === '') row.problem = 'Needs item, warehouse, qty and unit cost';
        return row;
      });

  const run = async () => {
    setFailure(null);
    setResult(null);
    const rows = parse();
    setParsed(rows);
    if (rows.length === 0) {
      toast.error('Paste at least one row');
      return;
    }
    setResolving(true);
    try {
      // Resolve SKUs through the product lookup (one call per distinct SKU); ids pass straight through.
      const refs = Array.from(new Set(rows.filter((r) => !r.problem).map((r) => r.itemRef)));
      const products = new Map<string, ProductLookup>();
      await Promise.all(
        refs.map(async (ref) => {
          const hits = await masterLookupApi.products(ref).catch(() => [] as ProductLookup[]);
          const hit = hits.find((p) => same(p.sku, ref) || same(p.id, ref));
          if (hit) products.set(ref, hit);
        }),
      );
      const whList = warehouses.data ?? [];
      const payload: OpeningImportRow[] = [];
      const indexOfPayload: number[] = [];
      const resolved = rows.map((r) => {
        if (r.problem) return r;
        const product = products.get(r.itemRef);
        const wh = whList.find((w) => same(w.code, r.warehouseRef) || same(w.id, r.warehouseRef));
        if (!product) return { ...r, problem: `Unknown SKU or item id: ${r.itemRef}` };
        if (!wh) return { ...r, problem: `Unknown warehouse: ${r.warehouseRef}` };
        indexOfPayload.push(r.row);
        payload.push({ itemId: product.id, warehouseId: wh.id, bucket: 'AVAILABLE', qty: Number(r.qty), unitCost: Number(r.unitCost), binId: null, gradeCode: null, serials: r.serials.map((serialNo) => ({ serialNo })) });
        return r;
      });
      setParsed(resolved);
      if (payload.length === 0) {
        toast.error('No rows could be resolved');
        return;
      }
      const res = await importRows.mutateAsync(payload);
      // The service numbers results by payload position; map them back to the pasted row numbers.
      setResult({ ...res, results: res.results.map((x) => ({ ...x, row: indexOfPayload[x.row - 1] ?? x.row })) });
      if (res.failed === 0) toast.success(`${res.posted} row(s) posted`);
      else toast.error(`${res.posted} posted, ${res.failed} failed`);
    } catch (err) {
      const e = toApiError(err);
      setFailure(e.message);
      toast.error(e.message);
    } finally {
      setResolving(false);
    }
  };

  const outcome = useMemo(() => {
    const byRow = new Map<number, { status: 'POSTED' | 'FAILED'; message: string }>();
    for (const r of parsed) if (r.problem) byRow.set(r.row, { status: 'FAILED', message: r.problem });
    for (const r of result?.results ?? []) byRow.set(r.row, { status: r.status, message: r.status === 'POSTED' ? `Posted (${r.postingId?.slice(0, 8)}...)` : r.error ? `${r.error.code}: ${r.error.message}` : 'Failed' });
    return byRow;
  }, [parsed, result]);
  const failures = parsed.filter((r) => outcome.get(r.row)?.status === 'FAILED');
  const shown = result || parsed.some((r) => r.problem);

  const downloadErrors = () => {
    const csv = toCsv([['row', 'item', 'warehouse', 'qty', 'unitCost', 'serials', 'error'], ...failures.map((r) => [String(r.row), r.itemRef, r.warehouseRef, r.qty, r.unitCost, r.serials.join(';'), outcome.get(r.row)?.message ?? ''])]);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'opening-stock-errors.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Paste rows" description="One row per line, tab or comma separated: SKU or item id, warehouse code or id, qty, unit cost, optional serials separated by ;" />
        <CardBody className="space-y-3">
          <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={'SKU-001,MAIN,10,250\nSKU-002,MAIN,2,12000,SN001;SN002'} className="font-mono text-xs" disabled={resolving || importRows.isPending} />
          <p className="text-xs text-slate-500">Rows post one at a time into the AVAILABLE bucket (unbinned); a bad row never blocks the others. Items that already have movements in that warehouse are rejected - use an adjustment for them.</p>
          <div className="flex items-center gap-2">
            <Button onClick={() => void run()} loading={resolving || importRows.isPending} disabled={!text.trim() || warehouses.isLoading}>Import</Button>
            {shown && (
              <Button variant="ghost" onClick={() => { setParsed([]); setResult(null); setFailure(null); }}>
                Clear results
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      {failure && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex gap-2" role="alert">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{failure}</span>
        </div>
      )}

      {shown && (
        <Card className="overflow-hidden">
          <CardHeader
            title="Results"
            description={result ? `${result.posted} posted, ${parsed.filter((r) => r.problem).length} not resolved, ${result.failed} rejected by inventory` : `${failures.length} row(s) could not be resolved`}
            actions={failures.length > 0 ? <Button size="sm" variant="secondary" icon={Download} onClick={downloadErrors}>Download errors as CSV</Button> : undefined}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/60">
                <tr>
                  <th className="text-left px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500 font-semibold w-12">Row</th>
                  <th className="text-left px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Item</th>
                  <th className="text-left px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Warehouse</th>
                  <th className="text-right px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Qty</th>
                  <th className="text-right px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Unit cost</th>
                  <th className="text-right px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Serials</th>
                  <th className="text-left px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {parsed.map((r) => {
                  const o = outcome.get(r.row);
                  const ok = o?.status === 'POSTED';
                  return (
                    <tr key={r.row} className={ok ? 'bg-emerald-50/60' : o ? 'bg-red-50/60' : undefined}>
                      <td className="px-3 py-2 tabular text-slate-500">{r.row}</td>
                      <td className="px-3 py-2 font-mono text-[13px]">{r.itemRef}</td>
                      <td className="px-3 py-2">{r.warehouseRef}</td>
                      <td className="px-3 py-2 text-right tabular">{r.qty}</td>
                      <td className="px-3 py-2 text-right tabular">{r.unitCost}</td>
                      <td className="px-3 py-2 text-right tabular">{r.serials.length || '-'}</td>
                      <td className="px-3 py-2">
                        {o ? (
                          <span className={`inline-flex items-start gap-1.5 text-xs ${ok ? 'text-emerald-700' : 'text-red-700'}`}>
                            {ok ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
                            {o.message}
                          </span>
                        ) : (
                          <Badge tone="gray">Pending</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ---- page ------------------------------------------------------------------------- */

export function OpeningStockPage() {
  const [tab, setTab] = useState<'manual' | 'import'>('manual');
  return (
    <>
      <PageHeader title="Opening stock" breadcrumbs={[{ label: 'Inventory' }, { label: 'Stock', to: '/inventory/stock' }, { label: 'Opening stock' }]} subtitle="Seed balances for items that have never moved in a warehouse. Later corrections go through adjustments." />
      <Tabs tabs={[{ key: 'manual', label: 'Manual entry' }, { key: 'import', label: 'Bulk import' }]} value={tab} onChange={setTab} className="mb-5" />
      {tab === 'manual' ? <ManualEntry /> : <BulkImport />}
    </>
  );
}
