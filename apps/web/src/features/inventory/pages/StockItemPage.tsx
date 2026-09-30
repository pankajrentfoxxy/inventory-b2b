import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, CardBody, CardHeader, DetailSkeleton, EmptyState, ErrorState, PageHeader, Stat, StatGrid, StatusBadge } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatMoney, formatQty, humanize } from '../../../lib/utils';
import { LaptopSpecsView } from '../../../components/LaptopSpecs';
import { useStockByItem, useWarehouseMaps } from '../hooks';
import { WAREHOUSE_BUCKETS, type Bucket, type StockByItem } from '../types';

const th = 'text-left px-4 py-2 text-[11px] uppercase tracking-wider text-slate-500 font-semibold';
const td = 'px-4 py-2 text-sm';

function sumBucket(data: StockByItem, bucket: Bucket) {
  return data.byWarehouse.filter((r) => r.bucket === bucket).reduce((s, r) => s + r.qty, 0);
}

export function StockItemPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const query = useStockByItem(itemId);
  const maps = useWarehouseMaps();
  const data = query.data;

  // Bucket x warehouse pivot for the "by warehouse" card (the API returns one row per bucket).
  const pivot = useMemo(() => {
    if (!data) return [];
    const byWh = new Map<string, { code: string; buckets: Partial<Record<Bucket, number>> }>();
    for (const r of data.byWarehouse) {
      const row = byWh.get(r.warehouseId) ?? { code: r.warehouseCode, buckets: {} };
      row.buckets[r.bucket] = (row.buckets[r.bucket] ?? 0) + r.qty;
      byWh.set(r.warehouseId, row);
    }
    return Array.from(byWh.entries()).map(([id, v]) => ({ warehouseId: id, ...v }));
  }, [data]);

  const crumbs = [{ label: 'Inventory' }, { label: 'Stock', to: '/inventory/stock' }, { label: data?.item.sku ?? '...' }];

  if (query.isLoading) {
    return (
      <>
        <PageHeader title="Stock" breadcrumbs={crumbs} />
        <DetailSkeleton />
      </>
    );
  }
  if (query.isError || !data) {
    const e = toApiError(query.error);
    return (
      <>
        <PageHeader title="Stock" breadcrumbs={crumbs} />
        <Card>
          <ErrorState title={e.status === 404 ? 'Item not found' : 'Could not load stock'} message={e.message} onRetry={() => void query.refetch()} />
        </Card>
      </>
    );
  }

  const item = data.item;
  const ledgerLink = `/inventory/ledger?itemId=${item.id}`;
  const serialsLink = `/inventory/serials?itemId=${item.id}`;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2 flex-wrap">
            <span className="font-mono">{item.sku}</span>
            {item.isSerialized && <Badge tone="purple">Serialized</Badge>}
          </span>
        }
        subtitle={item.name}
        breadcrumbs={crumbs}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => navigate(ledgerLink)}>Ledger</Button>
            {item.isSerialized && <Button variant="secondary" size="sm" onClick={() => navigate(serialsLink)}>Serial numbers</Button>}
            {hasPermission('inventory.adjust') && <Button size="sm" onClick={() => navigate(`/inventory/adjustments/new?itemId=${item.id}`)}>Adjust</Button>}
          </>
        }
      />

      <StatGrid className="md:grid-cols-5 mb-5">
        <Stat label="Available" value={formatQty(sumBucket(data, 'AVAILABLE'))} tone="green" hint={item.unitCode} />
        <Stat label="QC hold" value={formatQty(sumBucket(data, 'QC_HOLD'))} tone="amber" />
        <Stat label="Reserved" value={formatQty(sumBucket(data, 'RESERVED'))} tone="blue" />
        <Stat label="Rejected" value={formatQty(sumBucket(data, 'REJECTED'))} tone="red" />
        <Stat label="In transit" value={formatQty(sumBucket(data, 'IN_TRANSIT'))} />
      </StatGrid>

      {item.specs && (
        <Card className="mb-5">
          <CardHeader title="Laptop configuration" description="The eight specifications of this SKU." />
          <CardBody>
            <LaptopSpecsView specs={item.specs} variant="grid" />
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader title="By warehouse" description="Quantity in each bucket per warehouse (only warehouses in your scope)." />
          {pivot.length === 0 ? (
            <EmptyState title="No stock in any warehouse" hint="Balances appear once opening stock, a receipt or an adjustment is posted." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse">
                <thead className="border-b border-slate-200 bg-slate-50/60">
                  <tr>
                    <th className={th}>Warehouse</th>
                    {WAREHOUSE_BUCKETS.map((b) => (
                      <th key={b} className={`${th} text-right`}>{humanize(b)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pivot.map((r) => (
                    <tr key={r.warehouseId}>
                      <td className={`${td} font-medium`}>
                        <Link to={`/inventory/stock?warehouseId=${r.warehouseId}`} className="text-brand-700 hover:underline">{r.code}</Link>
                      </td>
                      {WAREHOUSE_BUCKETS.map((b) => (
                        <td key={b} className={`${td} text-right tabular`}>{formatQty(r.buckets[b] ?? 0)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="By bin" />
          {data.byBin.length === 0 ? (
            <EmptyState title="No binned stock" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead className="border-b border-slate-200 bg-slate-50/60">
                  <tr>
                    <th className={th}>Warehouse</th>
                    <th className={th}>Bin</th>
                    <th className={th}>Bucket</th>
                    <th className={`${th} text-right`}>Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.byBin.map((r, i) => (
                    <tr key={`${r.warehouseId}:${r.binId ?? 'none'}:${r.bucket}:${i}`}>
                      <td className={td}>{maps.warehouseLabel(r.warehouseId)}</td>
                      <td className={`${td} font-mono text-[13px]`}>{r.binCode ?? <span className="text-slate-400">Unbinned</span>}</td>
                      <td className={td}><StatusBadge status={r.bucket} /></td>
                      <td className={`${td} text-right tabular`}>{formatQty(r.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {item.isSerialized && (
          <Card className="overflow-hidden">
            <CardHeader title="By grade" description="Serial units per grade." actions={<Link to={serialsLink} className="text-xs text-brand-700 hover:underline">All serials</Link>} />
            {data.byGrade.length === 0 ? (
              <EmptyState title="No serial units in stock" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead className="border-b border-slate-200 bg-slate-50/60">
                    <tr>
                      <th className={th}>Warehouse</th>
                      <th className={th}>Bucket</th>
                      <th className={th}>Grade</th>
                      <th className={`${th} text-right`}>Units</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.byGrade.map((r, i) => (
                      <tr key={`${r.warehouseId}:${r.bucket}:${r.gradeCode ?? ''}:${i}`}>
                        <td className={td}>{maps.warehouseLabel(r.warehouseId)}</td>
                        <td className={td}><StatusBadge status={r.bucket} /></td>
                        <td className={td}>{r.gradeCode ?? <span className="text-slate-400">Ungraded</span>}</td>
                        <td className={`${td} text-right tabular`}>{formatQty(r.qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        <Card className="overflow-hidden">
          <CardHeader title="Delivered to customers" description="Units currently with customers (DELIVERED bucket)." />
          {data.delivered.length === 0 ? (
            <EmptyState title="Nothing delivered" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead className="border-b border-slate-200 bg-slate-50/60">
                  <tr>
                    <th className={th}>Customer</th>
                    <th className={`${th} text-right`}>Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.delivered.map((r) => (
                    <tr key={r.partyId}>
                      <td className={td}>
                        <Link to={`/parties/customers/${r.partyId}`} className="font-mono text-[13px] text-brand-700 hover:underline">{r.partyId.slice(0, 8)}...</Link>
                      </td>
                      <td className={`${td} text-right tabular`}>{formatQty(r.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Cost" description="Moving average cost per warehouse." />
          {data.cost.length === 0 ? (
            <EmptyState title="No cost recorded" hint="Average cost is built from costed receipts and opening stock." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead className="border-b border-slate-200 bg-slate-50/60">
                  <tr>
                    <th className={th}>Warehouse</th>
                    <th className={`${th} text-right`}>Avg cost</th>
                    <th className={`${th} text-right`}>Qty basis</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.cost.map((c) => (
                    <tr key={c.warehouseId}>
                      <td className={td}>{maps.warehouseLabel(c.warehouseId)}</td>
                      <td className={`${td} text-right tabular`}>{formatMoney(c.avgCost)}</td>
                      <td className={`${td} text-right tabular`}>{formatQty(c.qtyBasis)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <CardBody className="border-t border-slate-100">
            <Link to={ledgerLink} className="text-sm text-brand-700 hover:underline">Open the ledger for this item</Link>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
