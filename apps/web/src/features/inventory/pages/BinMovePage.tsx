import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, MoveRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Field, Input, PageHeader, Select, StatusBadge, TableSkeleton } from '../../../components/ui';
import { shouldRetryWithSameKey, useIdempotencyKey } from '../../../hooks/useIdempotencyKey';
import { toApiError } from '../../../lib/api';
import { formatQty, humanize } from '../../../lib/utils';
import { BinSelect } from '../components/BinSelect';
import { ProductPicker } from '../components/ProductPicker';
import { SerialsTextarea, parseSerials } from '../components/SerialsTextarea';
import { WarehousePicker } from '../components/WarehousePicker';
import { describeInventoryError } from '../components/errors';
import { useBinMove, useScopedWarehouses, useStockByItem, useWarehouseMaps } from '../hooks';
import { BIN_MOVE_BUCKETS, type BinMoveInput, type BinMoveResult, type ProductLookup } from '../types';

export function BinMovePage() {
  const scoped = useScopedWarehouses();
  const maps = useWarehouseMaps();
  const move = useBinMove();
  const idempotency = useIdempotencyKey();

  const [warehouseId, setWarehouseId] = useState('');
  const [itemId, setItemId] = useState('');
  const [product, setProduct] = useState<ProductLookup | null>(null);
  const [bucket, setBucket] = useState<BinMoveInput['bucket']>('AVAILABLE');
  const [fromBinId, setFromBinId] = useState('');
  const [toBinId, setToBinId] = useState('');
  const [qty, setQty] = useState('');
  const [serialsText, setSerialsText] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<(BinMoveResult & { itemId: string; itemLabel: string }) | null>(null);

  useEffect(() => {
    if (!warehouseId && scoped.defaultId) setWarehouseId(scoped.defaultId);
  }, [scoped.defaultId, warehouseId]);

  const stock = useStockByItem(itemId || undefined);
  const bins = useMemo(() => (stock.data?.byBin ?? []).filter((b) => !warehouseId || b.warehouseId === warehouseId), [stock.data, warehouseId]);

  const payload = useMemo<BinMoveInput>(
    () => ({ warehouseId, itemId, bucket, fromBinId: fromBinId || null, toBinId: toBinId || null, qty: Number(qty) || 0, serialNumbers: product?.isSerialized ? parseSerials(serialsText) : [] }),
    [warehouseId, itemId, bucket, fromBinId, toBinId, qty, product, serialsText],
  );
  const ready = Boolean(warehouseId && itemId) && Number(qty) > 0 && fromBinId !== toBinId;

  const submit = async () => {
    setErrors({});
    setDone(null);
    try {
      const result = await move.mutateAsync({ payload, idempotencyKey: idempotency.keyFor(payload) });
      idempotency.reset();
      toast.success(`Moved ${formatQty(payload.qty)} ${product?.unitCode ?? ''} to ${maps.binLabel(toBinId || null)}`);
      setDone({ ...result, itemId, itemLabel: product ? `${product.sku} - ${product.name}` : itemId });
      setQty('');
      setSerialsText('');
    } catch (err) {
      const e = toApiError(err);
      if (!shouldRetryWithSameKey(e.status)) idempotency.reset();
      const map: Record<string, string> = {};
      for (const d of e.details) if (d.path) map[d.path.split('.')[0]] = d.message;
      setErrors(map);
      toast.error(describeInventoryError(e));
    }
  };

  return (
    <>
      <PageHeader title="Bin move" breadcrumbs={[{ label: 'Inventory' }, { label: 'Stock', to: '/inventory/stock' }, { label: 'Bin moves' }]} subtitle="Move stock between bins inside one warehouse. Quantities and buckets stay the same; only the location changes." />
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        <Card className="xl:col-span-3">
          <CardBody className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Warehouse" required error={errors.warehouseId} htmlFor="bm-warehouse">
                <WarehousePicker id="bm-warehouse" value={warehouseId} onChange={(v) => { setWarehouseId(v); setFromBinId(''); setToBinId(''); }} error={Boolean(errors.warehouseId)} />
              </Field>
              <Field label="Item" required error={errors.itemId} htmlFor="bm-item">
                <ProductPicker id="bm-item" value={itemId} onChange={(id, p) => { setItemId(id); setProduct(p); setSerialsText(''); setDone(null); }} error={Boolean(errors.itemId)} allowClear />
              </Field>
              <Field label="Bucket" required error={errors.bucket} htmlFor="bm-bucket">
                <Select id="bm-bucket" value={bucket} onChange={(e) => setBucket(e.target.value as BinMoveInput['bucket'])} options={BIN_MOVE_BUCKETS.map((b) => ({ value: b, label: humanize(b) }))} error={Boolean(errors.bucket)} />
              </Field>
              <Field label="Quantity" required error={errors.qty} htmlFor="bm-qty">
                <Input id="bm-qty" sanitize="decimal" value={qty} onChange={(e) => setQty(e.target.value)} error={Boolean(errors.qty)} className="text-right tabular" suffix={product?.unitCode} />
              </Field>
              <Field label="From bin" error={errors.fromBinId} htmlFor="bm-from" hint="Leave empty for unbinned stock">
                <BinSelect id="bm-from" warehouseId={warehouseId} value={fromBinId} onChange={setFromBinId} error={Boolean(errors.fromBinId)} placeholder="Unbinned" />
              </Field>
              <Field label="To bin" error={errors.toBinId ?? (fromBinId === toBinId && (fromBinId || toBinId) ? 'Choose a different bin' : undefined)} htmlFor="bm-to">
                <BinSelect id="bm-to" warehouseId={warehouseId} value={toBinId} onChange={setToBinId} error={Boolean(errors.toBinId)} placeholder="Unbinned" />
              </Field>
            </div>
            {product?.isSerialized && (
              <Field label="Serial numbers" required error={undefined} htmlFor="bm-serials">
                <SerialsTextarea id="bm-serials" value={serialsText} onChange={setSerialsText} expected={Math.trunc(Number(qty) || 0)} error={errors.serialNumbers ?? errors.serials} rows={4} />
              </Field>
            )}
            <div className="flex items-center gap-2 pt-1">
              <Button icon={MoveRight} onClick={() => void submit()} loading={move.isPending} disabled={!ready}>Move stock</Button>
            </div>
            {done && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 flex gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  Posted <span className="font-mono text-[13px]">{done.postingId}</span> for {done.itemLabel}{done.serials ? ` (${done.serials} serial${done.serials === 1 ? '' : 's'})` : ''}.{' '}
                  <Link to={`/inventory/stock/${done.itemId}`} className="underline font-medium">View item stock</Link>
                  {' or '}
                  <Link to={`/inventory/ledger?itemId=${done.itemId}&refType=BIN_MOVE`} className="underline font-medium">open the ledger</Link>.
                </span>
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="xl:col-span-2 overflow-hidden">
          <CardHeader title="Current bins" description={itemId ? `Where ${product?.sku ?? 'this item'} sits in ${warehouseId ? maps.warehouseLabel(warehouseId) : 'every warehouse'}` : 'Pick an item to see its bins'} />
          {!itemId ? (
            <EmptyState title="No item selected" />
          ) : stock.isLoading ? (
            <TableSkeleton rows={4} cols={3} />
          ) : stock.isError ? (
            <ErrorState message={toApiError(stock.error).message} onRetry={() => void stock.refetch()} />
          ) : bins.length === 0 ? (
            <EmptyState title="No stock in this warehouse" hint="Nothing to move here." />
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/60 text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold">Bin</th>
                  <th className="text-left px-4 py-2 font-semibold">Bucket</th>
                  <th className="text-right px-4 py-2 font-semibold">Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bins.map((b, i) => (
                  <tr
                    key={`${b.binId ?? 'none'}:${b.bucket}:${i}`}
                    className="cursor-pointer hover:bg-slate-50"
                    title="Use as source"
                    onClick={() => {
                      setFromBinId(b.binId ?? '');
                      if (BIN_MOVE_BUCKETS.includes(b.bucket as BinMoveInput['bucket'])) setBucket(b.bucket as BinMoveInput['bucket']);
                    }}
                  >
                    <td className="px-4 py-2 font-mono text-[13px]">{b.binCode ?? <span className="text-slate-400">Unbinned</span>}</td>
                    <td className="px-4 py-2"><StatusBadge status={b.bucket} dot={false} /></td>
                    <td className="px-4 py-2 text-right tabular">{formatQty(b.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
