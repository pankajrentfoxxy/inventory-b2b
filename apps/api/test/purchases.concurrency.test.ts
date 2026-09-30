/**
 * Phase 0 - procurement race conditions R1-R7, idempotency, outbox / inbox, correlation ids,
 * health and the cross-tenant sweep (phase-plan/phase-00-architecture-foundation.md, steps 9-10).
 *
 * Every concurrency test fires real HTTP requests in parallel against the in-process app and then
 * checks the database invariant the plan defines:
 *   sum(grn_lines.qty for live GRNs) == po_lines.received_quantity <= po_lines.quantity
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { InMemoryPublisher, createOutboxRelay, type EventEnvelope } from '../src/lib/outbox.js';
import { processOnce } from '../src/lib/inbox.js';
import { createHealthRouter } from '../src/modules/health/health.routes.js';
import { correlationId } from '../src/middleware/correlation.js';
import { api, byCode, formOptions, registerOrg, resetDatabase, vendorPayload, type Session } from './helpers.js';

const app = createApp();

/* ---- fixtures -------------------------------------------------------------- */

interface Tenant {
  owner: Session;
  vendorId: string;
  vendor2Id: string;
  locationId: string;
  taxId: string;
  items: { id: string; name: string }[];
}

interface PoLine {
  id: string;
  itemId: string;
  quantity: number;
  receivedQuantity: number;
  remainingQuantity: number;
}
interface PoDetail {
  id: string;
  purchaseOrderNumber: string;
  status: string;
  version: number;
  vendorId: string;
  lines: PoLine[];
  receives: { id: string; status: string }[];
}

let seq = 0;
async function provisionTenant(orgName: string, email: string): Promise<Tenant> {
  const owner = await registerOrg(app, orgName, email);
  const opts = await formOptions(app, owner);
  const unregistered = byCode(opts.gstTreatments, 'UNREGISTERED_BUSINESS').id;
  const v1 = await api(app, owner).post('/api/vendors').send(vendorPayload(opts, { displayName: `${orgName} Supplier`, gstin: null, pan: null, gstTreatmentId: unregistered, bankAccounts: [] }));
  assert.equal(v1.status, 201, JSON.stringify(v1.body));
  const v2 = await api(app, owner).post('/api/vendors').send(vendorPayload(opts, { displayName: `${orgName} Alternate`, gstin: null, pan: null, gstTreatmentId: unregistered, bankAccounts: [] }));
  assert.equal(v2.status, 201, JSON.stringify(v2.body));

  const locations = await api(app, owner).get('/api/settings/locations');
  const locationId = locations.body.data[0].id as string;
  const loc = await api(app, owner).patch(`/api/settings/locations/${locationId}`).send({ addressLine1: '1 Test Road', city: 'Mumbai', state: 'Maharashtra', stateCode: '27', postalCode: '400001' });
  assert.equal(loc.status, 200, JSON.stringify(loc.body));

  const taxes = await api(app, owner).get('/api/settings/taxes');
  const taxId = taxes.body.data.find((t: { name: string }) => t.name === 'GST18').id as string;

  const items = [];
  for (const name of ['Widget A', 'Widget B', 'Widget C']) {
    seq += 1;
    const res = await api(app, owner).post('/api/items').send({ name, sku: `SKU-${seq}`, unit: 'pcs', purchaseRate: 100, taxId });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    items.push({ id: res.body.data.id as string, name });
  }
  return { owner, vendorId: v1.body.data.id, vendor2Id: v2.body.data.id, locationId, taxId, items };
}

function poPayload(t: Tenant, qtyA = 10, qtyB = 5, overrides: Record<string, unknown> = {}) {
  return {
    vendorId: t.vendorId,
    locationId: t.locationId,
    deliveryType: 'LOCATION',
    deliveryLocationId: t.locationId,
    orderDate: '2026-09-30',
    lines: [
      { itemId: t.items[0].id, quantity: qtyA, rate: 100, taxId: t.taxId },
      { itemId: t.items[1].id, quantity: qtyB, rate: 50, taxId: t.taxId },
    ],
    discountType: 'PERCENT',
    discountValue: 0,
    taxDeductionType: 'NONE',
    taxDeductionRate: 0,
    adjustment: 0,
    ...overrides,
  };
}

/** Same order, edited: keeps line ids so received-line guards apply. */
function editPayload(t: Tenant, po: PoDetail, lines: Partial<PoLine & { itemId: string }>[], overrides: Record<string, unknown> = {}) {
  return poPayload(t, 0, 0, {
    lines: lines.map((l, i) => ({ id: l.id ?? po.lines[i].id, itemId: l.itemId ?? po.lines[i].itemId, quantity: l.quantity ?? po.lines[i].quantity, rate: 100, taxId: t.taxId })),
    version: po.version,
    ...overrides,
  });
}

async function createIssuedPo(t: Tenant, qtyA = 10, qtyB = 5): Promise<PoDetail> {
  const res = await api(app, t.owner).post('/api/purchase-orders?issue=true').send(poPayload(t, qtyA, qtyB));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data as PoDetail;
}

async function getPo(t: Tenant, id: string): Promise<PoDetail> {
  const res = await api(app, t.owner).get(`/api/purchase-orders/${id}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data as PoDetail;
}

function receive(s: Session, purchaseOrderId: string, lines: { purchaseOrderLineId: string; quantity: number }[], key: string = randomUUID(), extra: Record<string, unknown> = {}) {
  return api(app, s).post('/api/purchase-receives').set('Idempotency-Key', key).send({ purchaseOrderId, receivedDate: '2026-10-01', lines, ...extra });
}

/** Rows violating the Phase 0 ledger invariant for one purchase order. Must be empty. */
async function invariantViolations(purchaseOrderId: string) {
  return prisma.$queryRaw<{ id: string }[]>`
    SELECT l.id FROM purchase_order_lines l
    LEFT JOIN (SELECT gl.purchase_order_line_id, sum(gl.quantity) q
                 FROM purchase_receive_lines gl JOIN purchase_receives g ON g.id = gl.purchase_receive_id
                WHERE g.status <> 'CANCELLED' GROUP BY gl.purchase_order_line_id) r
           ON r.purchase_order_line_id = l.id
    WHERE l.purchase_order_id = ${purchaseOrderId}::uuid
      AND (coalesce(r.q, 0) <> l.received_quantity OR l.received_quantity > l.quantity OR l.received_quantity < 0)`;
}

async function liveReceiveCount(purchaseOrderId: string) {
  return prisma.purchaseReceive.count({ where: { purchaseOrderId, status: 'RECEIVED' } });
}

const statuses = (responses: request.Response[]) => responses.map((r) => r.status);
const count = (responses: request.Response[], status: number) => responses.filter((r) => r.status === status).length;

let alpha: Tenant;
let beta: Tenant;

before(async () => {
  await resetDatabase();
  alpha = await provisionTenant('Alpha Concurrency', 'owner@alpha-cc.test');
  beta = await provisionTenant('Beta Concurrency', 'owner@beta-cc.test');
});

after(async () => {
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------------- */
describe('R1 - over-receipt race', () => {
  it('10 concurrent GRNs for the full remaining quantity: exactly one succeeds, the rest are 422 OVER_RECEIPT', async () => {
    const po = await createIssuedPo(alpha, 10, 5);
    const responses = await Promise.all(Array.from({ length: 10 }, () => receive(alpha.owner, po.id, [{ purchaseOrderLineId: po.lines[0].id, quantity: 10 }])));
    assert.equal(count(responses, 201), 1, JSON.stringify(statuses(responses)));
    for (const r of responses.filter((r) => r.status !== 201)) {
      assert.equal(r.status, 422, JSON.stringify(r.body));
      assert.equal(r.body.error.code, 'OVER_RECEIPT');
      assert.match(r.body.error.details[0].path, /^lines\.0\.quantity$/);
    }
    const after = await getPo(alpha, po.id);
    assert.equal(after.lines[0].receivedQuantity, 10);
    assert.equal(after.lines[0].remainingQuantity, 0);
    assert.equal(after.status, 'PARTIALLY_RECEIVED');
    assert.equal(await liveReceiveCount(po.id), 1);
    assert.deepEqual(await invariantViolations(po.id), []);
  });

  it('10 concurrent partial GRNs of 3 against 10 ordered: exactly three succeed', async () => {
    const po = await createIssuedPo(alpha, 10, 5);
    const responses = await Promise.all(Array.from({ length: 10 }, () => receive(alpha.owner, po.id, [{ purchaseOrderLineId: po.lines[0].id, quantity: 3 }])));
    assert.equal(count(responses, 201), 3, JSON.stringify(statuses(responses)));
    assert.equal(count(responses, 422), 7);
    const after = await getPo(alpha, po.id);
    assert.equal(after.lines[0].receivedQuantity, 9);
    assert.deepEqual(await invariantViolations(po.id), []);
  });

  it('the database CHECK rejects over-receipt even when the application layer is bypassed', async () => {
    const po = await createIssuedPo(alpha, 10, 5);
    await assert.rejects(
      prisma.$executeRaw`UPDATE purchase_order_lines SET received_quantity = quantity + 1 WHERE id = ${po.lines[0].id}::uuid`,
      /purchase_order_lines_received_within_ordered/,
    );
    await assert.rejects(prisma.$executeRaw`UPDATE purchase_order_lines SET received_quantity = -1 WHERE id = ${po.lines[0].id}::uuid`);
  });
});

/* ------------------------------------------------------------------------- */
describe('R2 - idempotent GRN creation', () => {
  it('requires a well-formed Idempotency-Key', async () => {
    const po = await createIssuedPo(alpha);
    const lines = [{ purchaseOrderLineId: po.lines[0].id, quantity: 1 }];
    const missing = await api(app, alpha.owner).post('/api/purchase-receives').send({ purchaseOrderId: po.id, receivedDate: '2026-10-01', lines });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
    const malformed = await receive(alpha.owner, po.id, lines, 'not-a-uuid');
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error.code, 'IDEMPOTENCY_KEY_INVALID');
    assert.equal(await liveReceiveCount(po.id), 0);
  });

  it('replays the same response for the same key + body and creates one GRN', async () => {
    const po = await createIssuedPo(alpha);
    const key = randomUUID();
    const lines = [{ purchaseOrderLineId: po.lines[0].id, quantity: 4 }];
    const first = await receive(alpha.owner, po.id, lines, key);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.headers['idempotent-replayed'], undefined);
    const second = await receive(alpha.owner, po.id, lines, key);
    assert.equal(second.status, 201, JSON.stringify(second.body));
    assert.equal(second.headers['idempotent-replayed'], 'true');
    assert.deepEqual(second.body, first.body);
    assert.equal(await liveReceiveCount(po.id), 1);
    const stored = await prisma.purchaseReceive.findUnique({ where: { id: first.body.data.id } });
    assert.equal(stored?.idempotencyKey, key, 'the GRN row records the key');
    assert.equal((await getPo(alpha, po.id)).lines[0].receivedQuantity, 4);
  });

  it('5 concurrent submits with the same key create exactly one GRN', async () => {
    const po = await createIssuedPo(alpha);
    const key = randomUUID();
    const lines = [{ purchaseOrderLineId: po.lines[0].id, quantity: 2 }];
    const responses = await Promise.all(Array.from({ length: 5 }, () => receive(alpha.owner, po.id, lines, key)));
    const ok = responses.filter((r) => r.status === 201);
    assert.ok(ok.length >= 1, JSON.stringify(statuses(responses)));
    for (const r of responses) {
      assert.ok([201, 409].includes(r.status), JSON.stringify(r.body));
      if (r.status === 409) assert.equal(r.body.error.code, 'IDEMPOTENCY_IN_PROGRESS');
      else assert.deepEqual(r.body, ok[0].body);
    }
    assert.equal(await liveReceiveCount(po.id), 1);
    assert.equal((await getPo(alpha, po.id)).lines[0].receivedQuantity, 2);
    assert.deepEqual(await invariantViolations(po.id), []);
  });

  it('rejects the same key with a different body (422 IDEMPOTENCY_KEY_REUSED)', async () => {
    const po = await createIssuedPo(alpha);
    const key = randomUUID();
    const first = await receive(alpha.owner, po.id, [{ purchaseOrderLineId: po.lines[0].id, quantity: 1 }], key);
    assert.equal(first.status, 201);
    const reused = await receive(alpha.owner, po.id, [{ purchaseOrderLineId: po.lines[0].id, quantity: 2 }], key);
    assert.equal(reused.status, 422);
    assert.equal(reused.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(await liveReceiveCount(po.id), 1);
  });

  it('replays business errors too, and a failed attempt records nothing', async () => {
    const po = await createIssuedPo(alpha, 3, 1);
    const key = randomUUID();
    const lines = [{ purchaseOrderLineId: po.lines[0].id, quantity: 99 }];
    const first = await receive(alpha.owner, po.id, lines, key);
    assert.equal(first.status, 422);
    assert.equal(first.body.error.code, 'OVER_RECEIPT');
    const again = await receive(alpha.owner, po.id, lines, key);
    assert.equal(again.status, 422);
    assert.equal(again.headers['idempotent-replayed'], 'true');
    assert.deepEqual(again.body, first.body);
    assert.equal(await liveReceiveCount(po.id), 0);
  });

  it('scopes keys per tenant: another organization may use the same key', async () => {
    const key = randomUUID();
    const poA = await createIssuedPo(alpha);
    const poB = await createIssuedPo(beta);
    const a = await receive(alpha.owner, poA.id, [{ purchaseOrderLineId: poA.lines[0].id, quantity: 1 }], key);
    const b = await receive(beta.owner, poB.id, [{ purchaseOrderLineId: poB.lines[0].id, quantity: 1 }], key);
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal(b.status, 201, JSON.stringify(b.body));
    assert.notEqual(a.body.data.id, b.body.data.id);
  });
});

/* ------------------------------------------------------------------------- */
describe('R3 - document numbering under load', () => {
  it('50 concurrent PO creates for a brand-new organization yield 50 unique, gap-free numbers', async () => {
    const gamma = await provisionTenant('Gamma Numbering', 'owner@gamma-cc.test');
    const responses = await Promise.all(Array.from({ length: 50 }, () => api(app, gamma.owner).post('/api/purchase-orders').send(poPayload(gamma))));
    assert.equal(count(responses, 201), 50, JSON.stringify(statuses(responses)));
    const numbers = responses.map((r) => r.body.data.purchaseOrderNumber as string);
    assert.equal(new Set(numbers).size, 50, 'no duplicates');
    const suffixes = numbers.map((n) => Number(n.slice('PO-'.length))).sort((a, b) => a - b);
    assert.deepEqual(suffixes, Array.from({ length: 50 }, (_, i) => i + 1), 'no gaps');
    const next = await api(app, gamma.owner).get('/api/purchase-orders/next-number');
    assert.equal(next.body.data.preview, 'PO-00051');
  });

  it('concurrent GRNs against different orders receive unique, sequential numbers', async () => {
    const delta = await provisionTenant('Delta Numbering', 'owner@delta-cc.test');
    const orders = await Promise.all(Array.from({ length: 8 }, () => createIssuedPo(delta)));
    const responses = await Promise.all(orders.map((po) => receive(delta.owner, po.id, [{ purchaseOrderLineId: po.lines[0].id, quantity: 1 }])));
    assert.equal(count(responses, 201), 8, JSON.stringify(statuses(responses)));
    const suffixes = responses.map((r) => Number((r.body.data.receiveNumber as string).slice('GRN-'.length))).sort((a, b) => a - b);
    assert.deepEqual(suffixes, [1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

/* ------------------------------------------------------------------------- */
describe('R4 - optimistic concurrency on the purchase order', () => {
  it('exposes version, bumps it on every write and rejects a stale version with 409', async () => {
    const created = await api(app, alpha.owner).post('/api/purchase-orders').send(poPayload(alpha));
    assert.equal(created.status, 201);
    const po = created.body.data as PoDetail;
    assert.equal(po.version, 0);

    const edit = await api(app, alpha.owner).put(`/api/purchase-orders/${po.id}`).send(editPayload(alpha, po, [{}, {}], { referenceNumber: 'REQ-1' }));
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    assert.equal(edit.body.data.version, 1);

    const issued = await api(app, alpha.owner).post(`/api/purchase-orders/${po.id}/issue`);
    assert.equal(issued.status, 200);
    assert.equal(issued.body.data.version, 2);

    const stale = await api(app, alpha.owner).put(`/api/purchase-orders/${po.id}`).send(editPayload(alpha, po, [{}, {}], { referenceNumber: 'REQ-2' }));
    assert.equal(stale.status, 409, JSON.stringify(stale.body));
    assert.equal(stale.body.error.code, 'PO_VERSION_CONFLICT');
    assert.equal((await getPo(alpha, po.id)).version, 2, 'the stale edit changed nothing');

    const fresh = await api(app, alpha.owner).put(`/api/purchase-orders/${po.id}`).send(editPayload(alpha, { ...po, version: 2 }, [{}, {}], { referenceNumber: 'REQ-2' }));
    assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
    assert.equal(fresh.body.data.version, 3);

    const legacyClient = await api(app, alpha.owner).put(`/api/purchase-orders/${po.id}`).send(editPayload(alpha, po, [{}, {}], { version: undefined }));
    assert.equal(legacyClient.status, 200, 'clients that do not send a version still work');
    assert.equal(legacyClient.body.data.version, 4);
  });

  it('two parallel edits based on the same version: exactly one wins', async () => {
    const created = await api(app, alpha.owner).post('/api/purchase-orders').send(poPayload(alpha));
    const po = created.body.data as PoDetail;
    const [a, b] = await Promise.all([
      api(app, alpha.owner).put(`/api/purchase-orders/${po.id}`).send(editPayload(alpha, po, [{ quantity: 11 }, {}])),
      api(app, alpha.owner).put(`/api/purchase-orders/${po.id}`).send(editPayload(alpha, po, [{ quantity: 12 }, {}])),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], JSON.stringify([a.body, b.body]));
    const after = await getPo(alpha, po.id);
    assert.equal(after.version, 1);
    const winner = a.status === 200 ? a : b;
    assert.equal(after.lines[0].quantity, winner.body.data.lines[0].quantity);
  });

  it('issue and edit in parallel: each write either applies once or is rejected, never lost', async () => {
    for (let round = 0; round < 5; round += 1) {
      const created = await api(app, alpha.owner).post('/api/purchase-orders').send(poPayload(alpha));
      const po = created.body.data as PoDetail;
      const [issue, edit] = await Promise.all([
        api(app, alpha.owner).post(`/api/purchase-orders/${po.id}/issue`),
        api(app, alpha.owner).put(`/api/purchase-orders/${po.id}`).send(editPayload(alpha, po, [{ quantity: 20 }, {}])),
      ]);
      assert.ok([200, 409].includes(issue.status), JSON.stringify(issue.body));
      assert.ok([200, 409].includes(edit.status), JSON.stringify(edit.body));
      const after = await getPo(alpha, po.id);
      const successes = [issue, edit].filter((r) => r.status === 200).length;
      assert.equal(after.version, successes, 'version counts exactly the writes that were applied');
      if (edit.status === 200) assert.equal(after.lines[0].quantity, 20);
      if (issue.status === 200) assert.equal(after.status, 'ISSUED');
    }
  });
});

/* ------------------------------------------------------------------------- */
describe('R5 - received lines are protected', () => {
  let po: PoDetail;
  before(async () => {
    po = await createIssuedPo(alpha, 10, 5);
    const r = await receive(alpha.owner, po.id, [{ purchaseOrderLineId: po.lines[0].id, quantity: 4 }]);
    assert.equal(r.status, 201);
    po = await getPo(alpha, po.id);
  });

  it('cannot reduce quantity below the received quantity', async () => {
    const res = await api(app, alpha.owner).put(`/api/purchase-orders/${po.id}`).send(editPayload(alpha, po, [{ quantity: 3 }, {}]));
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.error.details[0].path, 'lines.0.quantity');
  });

  it('cannot swap the item on a received line', async () => {
    const res = await api(app, alpha.owner).put(`/api/purchase-orders/${po.id}`).send(editPayload(alpha, po, [{ itemId: alpha.items[2].id }, {}]));
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.error.details[0].path, 'lines.0.itemId');
    const after = await getPo(alpha, po.id);
    assert.equal(after.lines[0].itemId, alpha.items[0].id, 'the GRN still refers to the item that arrived');
  });

  it('cannot remove a received line or change the vendor', async () => {
    const removed = await api(app, alpha.owner).put(`/api/purchase-orders/${po.id}`).send(editPayload(alpha, po, [{ id: po.lines[1].id, itemId: po.lines[1].itemId, quantity: 5 }]));
    assert.equal(removed.status, 422);
    assert.ok(removed.body.error.details.some((d: { path: string }) => d.path === 'lines'));
    const vendor = await api(app, alpha.owner).put(`/api/purchase-orders/${po.id}`).send(editPayload(alpha, po, [{}, {}], { vendorId: alpha.vendor2Id }));
    assert.equal(vendor.status, 422);
    assert.equal(vendor.body.error.details[0].path, 'vendorId');
  });

  it('a lawful edit (increase quantity, change rate) still works and bumps the version', async () => {
    const res = await api(app, alpha.owner).put(`/api/purchase-orders/${po.id}`).send(editPayload(alpha, po, [{ quantity: 12 }, {}]));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.version, po.version + 1);
    assert.equal(res.body.data.lines[0].remainingQuantity, 8);
    assert.equal(res.body.data.status, 'PARTIALLY_RECEIVED');
  });

  it('edit vs. receive race: ordered quantity never drops below the received quantity', async () => {
    for (let round = 0; round < 5; round += 1) {
      const fresh = await createIssuedPo(alpha, 10, 5);
      const [edit, grn] = await Promise.all([
        api(app, alpha.owner).put(`/api/purchase-orders/${fresh.id}`).send(editPayload(alpha, fresh, [{ quantity: 4 }, {}])),
        receive(alpha.owner, fresh.id, [{ purchaseOrderLineId: fresh.lines[0].id, quantity: 6 }]),
      ]);
      assert.ok(!(edit.status === 200 && grn.status === 201), `both succeeded: ${JSON.stringify([edit.body, grn.body])}`);
      const after = await getPo(alpha, fresh.id);
      assert.ok(after.lines[0].receivedQuantity <= after.lines[0].quantity);
      assert.deepEqual(await invariantViolations(fresh.id), []);
    }
  });
});

/* ------------------------------------------------------------------------- */
describe('R6 - cancel vs. receive race', () => {
  it('cancelling and receiving concurrently never both succeed (15 rounds)', async () => {
    for (let round = 0; round < 15; round += 1) {
      const po = await createIssuedPo(alpha, 10, 5);
      const [cancel, grn] = await Promise.all([
        api(app, alpha.owner).post(`/api/purchase-orders/${po.id}/cancel`).send({ reason: 'race' }),
        receive(alpha.owner, po.id, [{ purchaseOrderLineId: po.lines[0].id, quantity: 5 }]),
      ]);
      const after = await getPo(alpha, po.id);
      const live = await liveReceiveCount(po.id);
      if (cancel.status === 200) {
        assert.equal(after.status, 'CANCELLED');
        assert.equal(live, 0, 'a cancelled order never has a live GRN');
        assert.equal(grn.status, 409, JSON.stringify(grn.body));
        assert.equal(grn.body.error.code, 'PO_NOT_RECEIVABLE');
      } else {
        assert.equal(grn.status, 201, JSON.stringify(grn.body));
        assert.equal(cancel.status, 409, JSON.stringify(cancel.body));
        assert.equal(cancel.body.error.code, 'PO_HAS_RECEIVES');
        assert.equal(after.status, 'PARTIALLY_RECEIVED');
        assert.equal(live, 1);
      }
      assert.deepEqual(await invariantViolations(po.id), []);
    }
  });

  it('close vs. receive: a closed order never gains a receipt afterwards', async () => {
    for (let round = 0; round < 5; round += 1) {
      const po = await createIssuedPo(alpha, 10, 5);
      const [close, grn] = await Promise.all([
        api(app, alpha.owner).post(`/api/purchase-orders/${po.id}/close`),
        receive(alpha.owner, po.id, [{ purchaseOrderLineId: po.lines[0].id, quantity: 5 }]),
      ]);
      assert.equal(close.status, 200, JSON.stringify(close.body));
      const after = await getPo(alpha, po.id);
      assert.equal(after.status, 'CLOSED');
      if (grn.status === 201) {
        // Receipt landed first; the close then saw a partially received order and closed it.
        assert.equal(await liveReceiveCount(po.id), 1);
        assert.equal(after.lines[0].receivedQuantity, 5);
      } else {
        assert.equal(grn.status, 409);
        assert.equal(await liveReceiveCount(po.id), 0);
      }
      assert.deepEqual(await invariantViolations(po.id), []);
    }
  });
});

/* ------------------------------------------------------------------------- */
describe('R7 - status and quantities are recomputed inside the same transaction', () => {
  it('5 concurrent receipts of 2 each fill a line of 10 exactly, then the order completes', async () => {
    const po = await createIssuedPo(alpha, 10, 4);
    const responses = await Promise.all(Array.from({ length: 5 }, () => receive(alpha.owner, po.id, [{ purchaseOrderLineId: po.lines[0].id, quantity: 2 }])));
    assert.equal(count(responses, 201), 5, JSON.stringify(statuses(responses)));
    let after = await getPo(alpha, po.id);
    assert.equal(after.lines[0].receivedQuantity, 10);
    assert.equal(after.status, 'PARTIALLY_RECEIVED');
    assert.equal(after.version, 5, 'each receipt bumped the version once');
    const rest = await receive(alpha.owner, po.id, [{ purchaseOrderLineId: po.lines[1].id, quantity: 4 }]);
    assert.equal(rest.status, 201);
    after = await getPo(alpha, po.id);
    assert.equal(after.status, 'RECEIVED');
    assert.deepEqual(await invariantViolations(po.id), []);
  });

  it('cancelling two different GRNs concurrently reverses both; cancelling the same GRN twice reverses once', async () => {
    const po = await createIssuedPo(alpha, 10, 5);
    const [g1, g2, g3] = await Promise.all([
      receive(alpha.owner, po.id, [{ purchaseOrderLineId: po.lines[0].id, quantity: 3 }]),
      receive(alpha.owner, po.id, [{ purchaseOrderLineId: po.lines[0].id, quantity: 3 }]),
      receive(alpha.owner, po.id, [{ purchaseOrderLineId: po.lines[0].id, quantity: 3 }]),
    ]);
    for (const g of [g1, g2, g3]) assert.equal(g.status, 201, JSON.stringify(g.body));
    assert.equal((await getPo(alpha, po.id)).lines[0].receivedQuantity, 9);

    const [c1, c2] = await Promise.all([
      api(app, alpha.owner).post(`/api/purchase-receives/${g1.body.data.id}/cancel`).send({}),
      api(app, alpha.owner).post(`/api/purchase-receives/${g2.body.data.id}/cancel`).send({}),
    ]);
    assert.equal(c1.status, 200, JSON.stringify(c1.body));
    assert.equal(c2.status, 200, JSON.stringify(c2.body));
    let after = await getPo(alpha, po.id);
    assert.equal(after.lines[0].receivedQuantity, 3);
    assert.equal(after.status, 'PARTIALLY_RECEIVED');

    const doubles = await Promise.all(Array.from({ length: 3 }, () => api(app, alpha.owner).post(`/api/purchase-receives/${g3.body.data.id}/cancel`).send({})));
    assert.equal(count(doubles, 200), 1, JSON.stringify(statuses(doubles)));
    for (const d of doubles.filter((r) => r.status !== 200)) {
      assert.equal(d.status, 409);
      assert.equal(d.body.error.code, 'RECEIVE_ALREADY_CANCELLED');
    }
    after = await getPo(alpha, po.id);
    assert.equal(after.lines[0].receivedQuantity, 0, 'never negative, never double-reversed');
    assert.equal(after.status, 'ISSUED');
    assert.deepEqual(await invariantViolations(po.id), []);
  });
});

/* ------------------------------------------------------------------------- */
describe('outbox - audit.recorded.v1 events', () => {
  it('every PO / GRN action writes an envelope in the same transaction, carrying the request correlation id', async () => {
    const corr = `test-${randomUUID()}`;
    const created = await api(app, alpha.owner).post('/api/purchase-orders?issue=true').set('x-correlation-id', corr).send(poPayload(alpha));
    assert.equal(created.status, 201);
    assert.equal(created.headers['x-correlation-id'], corr);
    const po = created.body.data as PoDetail;
    const grn = await receive(alpha.owner, po.id, [{ purchaseOrderLineId: po.lines[0].id, quantity: 1 }], randomUUID(), {});
    assert.equal(grn.status, 201);
    const cancelled = await api(app, alpha.owner).post(`/api/purchase-receives/${grn.body.data.id}/cancel`).send({ reason: 'audit test' });
    assert.equal(cancelled.status, 200);

    const rows = await prisma.outboxEvent.findMany({ where: { tenantId: alpha.owner.orgId, OR: [{ aggregateId: po.id }, { aggregateId: grn.body.data.id }] }, orderBy: { createdAt: 'asc' } });
    const envelopes = rows.map((r) => r.envelope as unknown as EventEnvelope<{ action: string }>);
    assert.deepEqual(envelopes.map((e) => e.payload.action), ['PO_CREATED', 'PO_ISSUED', 'GRN_CREATED', 'GRN_CANCELLED']);
    for (const e of envelopes) {
      assert.equal(e.eventType, 'audit.recorded');
      assert.equal(e.eventVersion, 1);
      assert.equal(e.tenantId, alpha.owner.orgId);
      assert.equal(e.producer, 'legacy-api');
      assert.equal(e.actor.type, 'user');
      assert.equal(e.actor.id, alpha.owner.userId);
      assert.match(e.eventId, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    assert.equal(envelopes[0].correlationId, corr);
    assert.equal(envelopes[1].correlationId, corr);
    assert.deepEqual(envelopes.map((e) => e.aggregate.type), ['purchase_order', 'purchase_order', 'purchase_receive', 'purchase_receive']);
    assert.equal(envelopes[0].aggregate.version, 0);
    assert.equal(rows.every((r) => r.publishedAt === null), true, 'the relay has not run yet');
  });

  it('a failed transaction leaves no outbox row', async () => {
    const po = await createIssuedPo(alpha, 2, 1);
    const before = await prisma.outboxEvent.count();
    const res = await receive(alpha.owner, po.id, [{ purchaseOrderLineId: po.lines[0].id, quantity: 50 }]);
    assert.equal(res.status, 422);
    assert.equal(await prisma.outboxEvent.count(), before);
  });

  it('the relay publishes every event exactly once and recovers from a broker outage', async () => {
    const publisher = new InMemoryPublisher();
    const relay = createOutboxRelay({ publisher, batchSize: 500 });
    const pending = await prisma.outboxEvent.count({ where: { publishedAt: null } });
    assert.ok(pending > 0);

    publisher.failing = true;
    const failedRun = await relay.runOnce();
    assert.equal(failedRun.published, 0);
    assert.equal(failedRun.failed, pending);
    assert.equal(publisher.published.length, 0);
    const deferred = await prisma.outboxEvent.findFirst({ where: { publishedAt: null } });
    assert.equal(deferred?.attempts, 1);
    assert.match(deferred?.lastError ?? '', /broker unavailable/);
    assert.ok(deferred!.nextAttemptAt.getTime() > Date.now(), 'retry is backed off');

    const backedOff = await relay.runOnce();
    assert.equal(backedOff.published + backedOff.failed, 0, 'rows in backoff are not retried early');

    publisher.failing = false;
    const recovered = await relay.runOnce({ includeDeferred: true });
    assert.equal(recovered.published, pending);
    assert.equal(recovered.failed, 0);
    assert.equal(await prisma.outboxEvent.count({ where: { publishedAt: null } }), 0);

    const again = await relay.runOnce({ includeDeferred: true });
    assert.equal(again.published, 0, 'nothing is published twice');
    const ids = publisher.published.map((p) => p.envelope.eventId);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, pending);
    assert.ok(publisher.published.every((p) => p.routingKey === 'audit.recorded.v1'));
  });
});

/* ------------------------------------------------------------------------- */
describe('inbox - processed_events', () => {
  it('the same event delivered three times has its effect once', async () => {
    const eventId = randomUUID();
    let effects = 0;
    const results = [];
    for (let i = 0; i < 3; i += 1) {
      results.push(
        await processOnce('test-consumer', eventId, async () => {
          effects += 1;
        }),
      );
    }
    assert.deepEqual(results, [true, false, false]);
    assert.equal(effects, 1);
  });

  it('concurrent duplicate deliveries still apply once', async () => {
    const eventId = randomUUID();
    let effects = 0;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        processOnce('test-consumer', eventId, async () => {
          effects += 1;
        }),
      ),
    );
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(effects, 1);
    const other = await processOnce('another-consumer', eventId, async () => {
      effects += 1;
    });
    assert.equal(other, true, 'consumers are independent');
  });
});

/* ------------------------------------------------------------------------- */
describe('correlation ids, health and error envelope', () => {
  it('echoes an inbound correlation id and mints one when absent', async () => {
    const echoed = await request(app).get('/api/health').set('x-correlation-id', 'abc-123');
    assert.equal(echoed.headers['x-correlation-id'], 'abc-123');
    const minted = await request(app).get('/api/health');
    assert.match(minted.headers['x-correlation-id'], /^[0-9a-f-]{36}$/);
  });

  it('puts the correlation id into every error envelope', async () => {
    const res = await request(app).get('/api/nope').set('x-correlation-id', 'err-1');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.correlationId, 'err-1');
    assert.equal(res.body.success, false);
    const denied = await api(app, alpha.owner).get('/api/purchase-orders/not-a-uuid');
    assert.equal(denied.status, 404, 'malformed ids are a 404, never a 500');
    assert.ok(denied.body.error.correlationId);
  });

  it('drops identity headers sent by clients', async () => {
    // x-tenant-id must not be able to select another tenant: the membership decides.
    const res = await api(app, alpha.owner).get('/api/purchase-orders').set('x-tenant-id', beta.owner.orgId).set('x-user-id', beta.owner.userId);
    assert.equal(res.status, 200);
    assert.ok(res.body.data.every((po: { purchaseOrderNumber: string }) => typeof po.purchaseOrderNumber === 'string'));
    const cross = await api(app, alpha.owner).get('/api/purchase-orders?limit=100');
    const betaPo = await createIssuedPo(beta);
    assert.ok(!cross.body.data.some((po: { id: string }) => po.id === betaPo.id));
  });

  it('/health/live and /health/ready report status; ready is 503 when a dependency is down', async () => {
    const live = await request(app).get('/health/live');
    assert.equal(live.status, 200);
    assert.equal(live.body.status, 'ok');
    const ready = await request(app).get('/health/ready');
    assert.equal(ready.status, 200, JSON.stringify(ready.body));
    assert.equal(ready.body.checks.database, 'ok');

    const broken = express();
    broken.use(correlationId);
    broken.use(
      '/health',
      createHealthRouter({
        database: async () => {
          throw new Error('connection refused');
        },
      }),
    );
    const down = await request(broken).get('/health/ready').set('x-correlation-id', 'hc-1');
    assert.equal(down.status, 503);
    assert.equal(down.body.error.code, 'NOT_READY');
    assert.equal(down.body.error.retryable, true);
    assert.equal(down.body.error.correlationId, 'hc-1');
    assert.equal(down.body.checks.database, 'down');
  });
});

/* ------------------------------------------------------------------------- */
describe('tenant isolation sweep (Phase 0 step 10)', () => {
  it('every purchase route answers 404 for another tenant ids, including transitions and receives', async () => {
    const po = await createIssuedPo(alpha, 10, 5);
    const grn = await receive(alpha.owner, po.id, [{ purchaseOrderLineId: po.lines[0].id, quantity: 1 }]);
    assert.equal(grn.status, 201);
    const grnId = grn.body.data.id as string;
    const b = () => api(app, beta.owner);

    const attempts: [string, () => request.Test][] = [
      ['GET po', () => b().get(`/api/purchase-orders/${po.id}`)],
      ['PUT po', () => b().put(`/api/purchase-orders/${po.id}`).send(editPayload(beta, po, [{}, {}], { vendorId: beta.vendorId, locationId: beta.locationId, deliveryLocationId: beta.locationId, lines: [{ itemId: beta.items[0].id, quantity: 1, rate: 1 }] }))],
      ['DELETE po', () => b().delete(`/api/purchase-orders/${po.id}`)],
      ['issue', () => b().post(`/api/purchase-orders/${po.id}/issue`)],
      ['cancel', () => b().post(`/api/purchase-orders/${po.id}/cancel`).send({})],
      ['close', () => b().post(`/api/purchase-orders/${po.id}/close`)],
      ['reopen', () => b().post(`/api/purchase-orders/${po.id}/reopen`)],
      ['activity', () => b().get(`/api/purchase-orders/${po.id}/activity`)],
      ['documents', () => b().get(`/api/purchase-orders/${po.id}/documents`)],
      ['GET grn', () => b().get(`/api/purchase-receives/${grnId}`)],
      ['cancel grn', () => b().post(`/api/purchase-receives/${grnId}/cancel`).send({})],
      ['receive against foreign po', () => b().post('/api/purchase-receives').set('Idempotency-Key', randomUUID()).send({ purchaseOrderId: po.id, receivedDate: '2026-10-01', lines: [{ purchaseOrderLineId: po.lines[0].id, quantity: 1 }] })],
    ];
    for (const [name, send] of attempts) {
      const res = await send();
      assert.equal(res.status, 404, `${name}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    const after = await getPo(alpha, po.id);
    assert.equal(after.status, 'PARTIALLY_RECEIVED', 'nothing changed');
    assert.equal(await liveReceiveCount(po.id), 1);
  });
});
