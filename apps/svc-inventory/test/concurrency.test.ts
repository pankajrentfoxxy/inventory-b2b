/**
 * Concurrency and invariants (phase-04 4.10): 50 parallel takes from 20, deadlock-free cross
 * locking, parallel identical keys, parallel identical serials, and a randomized soak whose ledger
 * must reconcile exactly with balances and serial counts. INVENTORY_SOAK_POSTINGS scales the soak.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { serviceToken, tenantToken, type InMemoryBroker } from '@b2b/test-kit';
import type { InventoryRuntime } from '../src/service.js';
import { UNBINNED, api, bootRuntime, idem, internal, product, seedRefs, warehouse } from './support.js';

let rt: InventoryRuntime;
let broker: InMemoryBroker;
const tenant = randomUUID();
const owner = tenantToken({ tenantId: tenant, name: 'Owner' });
const sales = serviceToken('svc-sales', 'svc-inventory');
const wh = warehouse(tenant, { code: 'MAIN' });
const itemA = product(tenant, { sku: 'A' });
const itemB = product(tenant, { sku: 'B' });
const serialItem = product(tenant, { sku: 'SER', isSerialized: true });
const soakItem = product(tenant, { sku: 'SOAK', isSerialized: true });
const bins = [{ id: randomUUID(), warehouseId: wh.id, code: 'B1' }, { id: randomUUID(), warehouseId: wh.id, code: 'B2' }];

before(async () => {
  ({ rt, broker } = await bootRuntime());
  await seedRefs(broker, tenant, [itemA, itemB, serialItem, soakItem], [wh], bins);
});
after(async () => {
  await rt.stop();
});

const balance = async (itemId: string, bucket: string, binId = UNBINNED) => {
  const rows = await rt.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant}, true)`;
    return tx.$queryRaw<{ qty: number }[]>`SELECT qty::float8 AS qty FROM stock_balances WHERE item_id = ${itemId}::uuid AND warehouse_id = ${wh.id}::uuid AND bucket = ${bucket} AND bin_id = ${binId}::uuid`;
  });
  return rows[0]?.qty ?? 0;
};
const reserve = (itemId: string, qty: number, key = `SO:${randomUUID()}`, refId = randomUUID()) => internal(rt, sales, tenant).post('/internal/v1/postings', { postingType: 'RESERVE', refType: 'SO', refId, idempotencyKey: key, lines: [{ itemId, warehouseId: wh.id, bucket: 'AVAILABLE', qty: -qty }, { itemId, warehouseId: wh.id, bucket: 'RESERVED', qty }] });

describe('concurrency', () => {
  it('50 parallel postings taking 1 from AVAILABLE=20: exactly 20 succeed, balance never negative', async () => {
    const open = await api(rt, owner).post('/api/v1/inventory/opening-stock', { warehouseId: wh.id, lines: [{ itemId: itemA.id, qty: 20, unitCost: 5 }, { itemId: itemB.id, qty: 1000, unitCost: 1 }] }, idem());
    assert.equal(open.status, 201, JSON.stringify(open.body));
    const results = await Promise.all(Array.from({ length: 50 }, () => reserve(itemA.id, 1)));
    const ok = results.filter((r) => r.status === 201);
    const failed = results.filter((r) => r.status === 422);
    assert.equal(ok.length, 20, JSON.stringify(results.map((r) => [r.status, r.body?.error?.code])));
    assert.equal(failed.length, 30);
    assert.ok(failed.every((r) => r.body.error.code === 'INSUFFICIENT_STOCK'));
    assert.equal(await balance(itemA.id, 'AVAILABLE'), 0);
    assert.equal(await balance(itemA.id, 'RESERVED'), 20);
  });

  it('postings touching (A,B) and (B,A) in parallel never deadlock', async () => {
    const pair = (first: string, second: string) => internal(rt, sales, tenant).post('/internal/v1/postings', { postingType: 'RESERVE', refType: 'SO', refId: randomUUID(), idempotencyKey: `SO:${randomUUID()}`, lines: [
      { itemId: first, warehouseId: wh.id, bucket: 'AVAILABLE', qty: -1 }, { itemId: first, warehouseId: wh.id, bucket: 'RESERVED', qty: 1 },
      { itemId: second, warehouseId: wh.id, bucket: 'AVAILABLE', qty: -1 }, { itemId: second, warehouseId: wh.id, bucket: 'RESERVED', qty: 1 },
    ] });
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2 ? pair(itemA.id, itemB.id) : pair(itemB.id, itemA.id))));
    const codes = results.map((r) => [r.status, r.body?.error?.code]);
    assert.ok(results.every((r) => r.status === 201 || r.body.error.code === 'INSUFFICIENT_STOCK'), JSON.stringify(codes));
    assert.ok(!results.some((r) => r.status >= 500), 'no deadlock / server error');
    assert.equal(await balance(itemA.id, 'AVAILABLE'), 0, 'A was already exhausted so every pair fails on A');
    assert.equal(await balance(itemB.id, 'RESERVED'), 0, 'and B never moved because the posting is atomic');
  });

  it('the same idempotency key in parallel yields one posting', async () => {
    const key = `SO:${randomUUID()}`;
    const refId = randomUUID();
    const results = await Promise.all(Array.from({ length: 12 }, () => reserve(itemB.id, 3, key, refId)));
    assert.ok(results.every((r) => r.status === 201 || r.status === 200), JSON.stringify(results.map((r) => [r.status, r.body?.error?.code])));
    const ids = new Set(results.map((r) => r.body.data.postingId));
    assert.equal(ids.size, 1);
    assert.equal(await balance(itemB.id, 'RESERVED'), 3);
  });

  it('parallel opening stock with the same serial: exactly one succeeds', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => api(rt, owner).post('/api/v1/inventory/opening-stock', { warehouseId: wh.id, lines: [{ itemId: serialItem.id, qty: 1, unitCost: 1, serials: [{ serialNo: 'DUP-1' }] }] }, idem())));
    assert.equal(results.filter((r) => r.status === 201).length, 1, JSON.stringify(results.map((r) => [r.status, r.body?.error?.code])));
    assert.ok(results.filter((r) => r.status === 422).every((r) => ['SERIAL_DUPLICATE', 'INV_OPENING_NOT_ALLOWED'].includes(r.body.error.code)));
    assert.equal(await balance(serialItem.id, 'AVAILABLE'), 1);
  });
});

describe('soak', () => {
  it('random postings keep ledger = balances, every posting balanced, serial counts = balances', async () => {
    const N = Number(process.env.INVENTORY_SOAK_POSTINGS ?? 400);
    const seed = await api(rt, owner).post('/api/v1/inventory/opening-stock', { warehouseId: wh.id, lines: [{ itemId: soakItem.id, qty: 40, unitCost: 100, serials: Array.from({ length: 40 }, (_, i) => ({ serialNo: `S-${i}` })) }] }, idem());
    assert.equal(seed.status, 201, JSON.stringify(seed.body));
    const serialsIn = new Map<string, string>(Array.from({ length: 40 }, (_, i) => [`S-${i}`, 'AVAILABLE']));
    const rand = (n: number) => Math.floor(Math.random() * n);
    let done = 0;
    const ops: (() => Promise<unknown>)[] = [];
    for (let i = 0; i < N; i += 1) {
      const kind = rand(6);
      if (kind === 0) ops.push(() => api(rt, owner).post('/api/v1/inventory/adjustments', { warehouseId: wh.id, reasonCode: 'FOUND', lines: [{ itemId: itemB.id, qtyDelta: 1 + rand(5), unitCost: 2 }] }).then((r) => api(rt, owner).post(`/api/v1/inventory/adjustments/${r.body.data.id}/submit`)));
      else if (kind === 1) ops.push(() => api(rt, owner).post('/api/v1/inventory/adjustments', { warehouseId: wh.id, reasonCode: 'LOSS', lines: [{ itemId: itemB.id, qtyDelta: -(1 + rand(5)) }] }).then((r) => api(rt, owner).post(`/api/v1/inventory/adjustments/${r.body.data.id}/submit`)));
      else if (kind === 2) ops.push(() => reserve(itemB.id, 1 + rand(4)));
      else if (kind === 3) ops.push(() => internal(rt, sales, tenant).post('/internal/v1/postings', { postingType: 'RELEASE', refType: 'SO', refId: randomUUID(), idempotencyKey: `REL:${randomUUID()}`, lines: [{ itemId: itemB.id, warehouseId: wh.id, bucket: 'RESERVED', qty: -(1 + rand(4)) }, { itemId: itemB.id, warehouseId: wh.id, bucket: 'AVAILABLE', qty: 1 + rand(4) }] }));
      else if (kind === 4) ops.push(() => api(rt, owner).post('/api/v1/inventory/bin-moves', { warehouseId: wh.id, itemId: itemB.id, qty: 1 + rand(3), fromBinId: rand(2) ? null : bins[0].id, toBinId: rand(2) ? bins[1].id : bins[0].id }, idem()));
      else ops.push(async () => {
        const s = `S-${rand(40)}`;
        const from = serialsIn.get(s)!;
        const to = from === 'AVAILABLE' ? 'RESERVED' : 'AVAILABLE';
        const r = await internal(rt, sales, tenant).post('/internal/v1/postings', { postingType: from === 'AVAILABLE' ? 'RESERVE' : 'RELEASE', refType: 'SO', refId: randomUUID(), idempotencyKey: `SER:${randomUUID()}`, lines: [{ itemId: soakItem.id, warehouseId: wh.id, bucket: from, qty: -1 }, { itemId: soakItem.id, warehouseId: wh.id, bucket: to, qty: 1 }], serials: [{ itemId: soakItem.id, serialNo: s }] });
        if (r.status === 201) serialsIn.set(s, to);
        return r;
      });
    }
    // run in batches of 8 to mix contention with throughput
    for (let i = 0; i < ops.length; i += 8) {
      const batch = ops.slice(i, i + 8).map((op) => op().then((r) => { done += 1; return r; }));
      const results = (await Promise.all(batch)) as { status: number; body: { error?: { code: string } } }[];
      for (const r of results) assert.ok(r.status < 500, JSON.stringify(r.body));
    }
    assert.equal(done, N);
    const report = await rt.service.reconciliation(tenant);
    assert.equal(report.ledgerMismatches.length, 0, JSON.stringify(report.ledgerMismatches));
    assert.equal(report.unbalancedPostings.length, 0, JSON.stringify(report.unbalancedPostings));
    assert.equal(report.serialMismatches.length, 0, JSON.stringify(report.serialMismatches));
    assert.equal(report.negativeBalances.length, 0);
    assert.equal(report.ok, true);
    const reservedSerials = [...serialsIn.values()].filter((b) => b === 'RESERVED').length;
    assert.equal(await balance(soakItem.id, 'RESERVED'), reservedSerials);
    const invalid = (await rt.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant}, true)`;
      return tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM stock_balances WHERE qty < 0`;
    }))[0].n;
    assert.equal(invalid, 0);
  });
});
