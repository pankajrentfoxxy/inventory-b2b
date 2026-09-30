import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { computePurchaseOrderTotals } from '@b2b/shared';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { addMemberWithRole, api, byCode, formOptions, registerOrg, resetDatabase, vendorPayload, type Session } from './helpers.js';

const app = createApp();

let owner: Session;
let executive: Session; // create/edit PO + receive, but cannot issue / cancel
let viewer: Session;
let otherOwner: Session;
let vendorId: string;
let vendorKarnatakaId: string;
let locationId: string;
let gst18: { id: string; rate: number };
let itemA: { id: string; name: string };
let itemB: { id: string; name: string };

before(async () => {
  await resetDatabase();
  owner = await registerOrg(app, 'Alpha Traders', 'owner@alpha.test');
  otherOwner = await registerOrg(app, 'Beta Supplies', 'owner@beta.test');
  executive = await addMemberWithRole(app, owner, 'PURCHASE_EXECUTIVE', 'exec@alpha.test');
  viewer = await addMemberWithRole(app, owner, 'VIEWER', 'viewer@alpha.test');

  const opts = await formOptions(app, owner);
  const v1 = await api(app, owner).post('/api/vendors').send(vendorPayload(opts));
  vendorId = v1.body.data.id;
  const v2 = await api(app, owner).post('/api/vendors').send(
    vendorPayload(opts, { displayName: 'Karnataka Components', sourceOfSupplyId: byCode(opts.sourcesOfSupply, '29').id, gstin: null, pan: null, gstTreatmentId: byCode(opts.gstTreatments, 'UNREGISTERED_BUSINESS').id, bankAccounts: [] }),
  );
  assert.equal(v2.status, 201, JSON.stringify(v2.body));
  vendorKarnatakaId = v2.body.data.id;

  // Put the primary location in Maharashtra (27) so vendor 1 is intra-state and vendor 2 inter-state.
  const locations = await api(app, owner).get('/api/settings/locations');
  locationId = locations.body.data[0].id;
  const upd = await api(app, owner).patch(`/api/settings/locations/${locationId}`).send({ addressLine1: '12 Andheri East', city: 'Mumbai', state: 'Maharashtra', stateCode: '27', postalCode: '400069' });
  assert.equal(upd.status, 200, JSON.stringify(upd.body));

  const taxes = await api(app, owner).get('/api/settings/taxes');
  gst18 = taxes.body.data.find((t: { name: string }) => t.name === 'GST18');
});

after(async () => {
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------------- */
describe('shared PO arithmetic', () => {
  it('pro-rates a transaction discount before tax and splits CGST/SGST intra-state', () => {
    const t = computePurchaseOrderTotals({
      lines: [
        { quantity: 2, rate: 1000, taxRate: 18 },
        { quantity: 1, rate: 500, taxRate: 5 },
      ],
      discountType: 'PERCENT',
      discountValue: 10,
      taxDeductionType: 'TDS',
      taxDeductionRate: 1,
      adjustment: -0.5,
      intraState: true,
    });
    assert.equal(t.subTotal, 2500);
    assert.equal(t.discountAmount, 250);
    assert.equal(t.taxableTotal, 2250);
    // 1800 taxable @18 = 324, 450 taxable @5 = 22.5
    assert.equal(t.taxTotal, 346.5);
    assert.deepEqual(t.taxBreakup.map((b) => `${b.label}${b.rate}:${b.amount}`), ['CGST2.5:11.25', 'SGST2.5:11.25', 'CGST9:162', 'SGST9:162']);
    assert.equal(t.taxDeductionAmount, 22.5);
    assert.equal(t.total, 2250 + 346.5 - 22.5 - 0.5);
  });

  it('charges IGST inter-state and caps an amount discount at the subtotal', () => {
    const t = computePurchaseOrderTotals({ lines: [{ quantity: 1, rate: 100, taxRate: 18 }], discountType: 'AMOUNT', discountValue: 500, taxDeductionType: 'NONE', taxDeductionRate: 0, adjustment: 0, intraState: false });
    assert.equal(t.discountAmount, 100);
    assert.equal(t.taxTotal, 0);
    assert.equal(t.total, 0);
    const u = computePurchaseOrderTotals({ lines: [{ quantity: 3, rate: 99.99, taxRate: 18 }], discountType: 'PERCENT', discountValue: 0, taxDeductionType: 'NONE', taxDeductionRate: 0, adjustment: 0, intraState: false });
    assert.deepEqual(u.taxBreakup, [{ label: 'IGST', rate: 18, amount: 53.99 }]);
    assert.equal(u.total, 353.96);
  });
});

/* ------------------------------------------------------------------------- */
describe('items', () => {
  it('creates items with tax and SKU, rejects duplicate SKUs and bad HSN codes', async () => {
    const a = await api(app, owner).post('/api/items').send({ name: 'Samsung 870 EVO 500GB SSD', sku: 'ssd-870-500', unit: 'pcs', hsnCode: '84717020', purchaseRate: 3200, taxId: gst18.id });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal(a.body.data.sku, 'SSD-870-500', 'SKU is upper-cased');
    assert.equal(a.body.data.tax.rate, 18);
    itemA = a.body.data;

    const b = await api(app, owner).post('/api/items').send({ name: 'Laptop Charger 65W', sku: 'CHG-65', unit: 'pcs', purchaseRate: 850, taxId: gst18.id });
    assert.equal(b.status, 201);
    itemB = b.body.data;

    const dup = await api(app, owner).post('/api/items').send({ name: 'Another', sku: 'SSD-870-500' });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'DUPLICATE_SKU');

    const bad = await api(app, owner).post('/api/items').send({ name: 'Bad', hsnCode: '12' });
    assert.equal(bad.status, 422);
    assert.ok(bad.body.error.details.some((d: { path: string }) => d.path === 'hsnCode'));
  });

  it('rejects a tax from another organization', async () => {
    const otherTaxes = await api(app, otherOwner).get('/api/settings/taxes');
    const res = await api(app, owner).post('/api/items').send({ name: 'Cross', taxId: otherTaxes.body.data[0].id });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.details[0].path, 'taxId');
  });

  it('lists, searches and scopes items per tenant; viewer cannot create', async () => {
    const list = await api(app, owner).get('/api/items?search=ssd');
    assert.equal(list.status, 200);
    assert.equal(list.body.data.length, 1);
    assert.equal(list.body.counts.ALL, 1, 'counts follow the active search');
    const all = await api(app, owner).get('/api/items');
    assert.equal(all.body.counts.ALL, 2);
    assert.equal(all.body.counts.ACTIVE, 2);
    const other = await api(app, otherOwner).get('/api/items');
    assert.equal(other.body.data.length, 0);
    const denied = await api(app, viewer).post('/api/items').send({ name: 'Nope' });
    assert.equal(denied.status, 403);
    const canRead = await api(app, viewer).get(`/api/items/${itemA.id}`);
    assert.equal(canRead.status, 200);
  });
});

/* ------------------------------------------------------------------------- */
function poPayload(overrides: Record<string, unknown> = {}) {
  return {
    vendorId,
    locationId,
    deliveryType: 'LOCATION',
    deliveryLocationId: locationId,
    orderDate: '2026-09-28',
    expectedDeliveryDate: '2026-10-05',
    referenceNumber: 'REQ-77',
    lines: [
      { itemId: itemA.id, quantity: 10, rate: 3200, taxId: gst18.id },
      { itemId: itemB.id, quantity: 5, rate: 850, taxId: gst18.id, description: 'Type-C chargers' },
    ],
    discountType: 'PERCENT',
    discountValue: 0,
    taxDeductionType: 'NONE',
    taxDeductionRate: 0,
    adjustment: 0,
    notes: 'Deliver to loading bay 2',
    ...overrides,
  };
}

describe('purchase orders', () => {
  let draftId: string;
  let issuedId: string;

  it('previews the next number and creates a draft with auto-number and computed totals', async () => {
    const preview = await api(app, owner).get('/api/purchase-orders/next-number');
    assert.equal(preview.status, 200);
    assert.equal(preview.body.data.preview, 'PO-00001');

    const res = await api(app, owner).post('/api/purchase-orders').send(poPayload());
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const po = res.body.data;
    draftId = po.id;
    assert.equal(po.purchaseOrderNumber, 'PO-00001');
    assert.equal(po.status, 'DRAFT');
    assert.equal(po.isIntraState, true, 'Maharashtra vendor delivered to Maharashtra warehouse');
    assert.equal(po.subTotal, 36250);
    assert.equal(po.taxTotal, 6525);
    assert.equal(po.total, 42775);
    assert.deepEqual(po.taxBreakup.map((b: { label: string }) => b.label), ['CGST', 'SGST']);
    assert.equal(po.lines[0].name, 'Samsung 870 EVO 500GB SSD', 'item name is snapshotted');
    assert.equal(po.lines[0].hsnCode, '84717020');
    assert.equal(po.lines[1].description, 'Type-C chargers');
    assert.equal(po.deliveryAddress.city, 'Mumbai');
    assert.equal(po.receiveState, 'NONE');
  });

  it('records a creation audit entry', async () => {
    const res = await api(app, owner).get(`/api/purchase-orders/${draftId}/activity`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data[0].action, 'PO_CREATED');
  });

  it('charges IGST for an inter-state vendor and honours a manual number', async () => {
    const res = await api(app, owner).post('/api/purchase-orders').send(poPayload({ vendorId: vendorKarnatakaId, purchaseOrderNumber: 'PO-00010' }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.isIntraState, false);
    assert.deepEqual(res.body.data.taxBreakup.map((b: { label: string }) => b.label), ['IGST']);
    // The sequence jumps past the manual number.
    const next = await api(app, owner).get('/api/purchase-orders/next-number');
    assert.equal(next.body.data.preview, 'PO-00011');
    const dup = await api(app, owner).post('/api/purchase-orders').send(poPayload({ purchaseOrderNumber: 'po-00010' }));
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'DUPLICATE_DOCUMENT_NUMBER');
  });

  it('lets the user override source and destination of supply', async () => {
    // Maharashtra vendor delivered to Maharashtra, but declared as sourced from Karnataka -> IGST.
    const res = await api(app, owner).post('/api/purchase-orders').send(poPayload({ sourceOfSupplyCode: '29' }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.sourceOfSupplyCode, '29');
    assert.equal(res.body.data.placeOfSupplyCode, '27');
    assert.equal(res.body.data.isIntraState, false);
    await api(app, owner).delete(`/api/purchase-orders/${res.body.data.id}`);
    const bad = await api(app, owner).post('/api/purchase-orders').send(poPayload({ destinationOfSupplyCode: '99' }));
    assert.equal(bad.status, 422);
    assert.equal(bad.body.error.details[0].path, 'destinationOfSupplyCode');
  });

  it('validates required fields, inactive vendors, foreign items and delivery address', async () => {
    const empty = await api(app, owner).post('/api/purchase-orders').send({});
    assert.equal(empty.status, 422);
    const paths = empty.body.error.details.map((d: { path: string }) => d.path);
    assert.ok(paths.includes('vendorId'));
    assert.ok(paths.includes('orderDate'));

    const noLines = await api(app, owner).post('/api/purchase-orders').send(poPayload({ lines: [] }));
    assert.equal(noLines.status, 422);

    const otherItems = await api(app, otherOwner).post('/api/items').send({ name: 'Beta item' });
    const foreign = await api(app, owner).post('/api/purchase-orders').send(poPayload({ lines: [{ itemId: otherItems.body.data.id, quantity: 1, rate: 1 }] }));
    assert.equal(foreign.status, 422);
    assert.equal(foreign.body.error.details[0].path, 'lines.0.itemId');

    const custom = await api(app, owner).post('/api/purchase-orders').send(poPayload({ deliveryType: 'CUSTOM', deliveryLocationId: null, deliveryAddress: null }));
    assert.equal(custom.status, 422);
    assert.equal(custom.body.error.details[0].path, 'deliveryAddress.addressLine1');

    await api(app, owner).patch(`/api/vendors/${vendorKarnatakaId}/status`).send({ status: 'INACTIVE' });
    const inactive = await api(app, owner).post('/api/purchase-orders').send(poPayload({ vendorId: vendorKarnatakaId }));
    assert.equal(inactive.status, 422);
    assert.match(inactive.body.error.details[0].message, /inactive/);
    await api(app, owner).patch(`/api/vendors/${vendorKarnatakaId}/status`).send({ status: 'ACTIVE' });
  });

  it('applies a transaction discount, TDS and adjustment', async () => {
    const res = await api(app, owner).post('/api/purchase-orders').send(poPayload({ discountType: 'AMOUNT', discountValue: 250, taxDeductionType: 'TDS', taxDeductionRate: 1, taxDeductionLabel: '194Q', adjustment: 10 }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const po = res.body.data;
    assert.equal(po.discountAmount, 250);
    assert.equal(po.taxTotal, 6480); // (36250 - 250) * 18%
    assert.equal(po.taxDeductionAmount, 360);
    assert.equal(po.total, 36000 + 6480 - 360 + 10);
    await api(app, owner).delete(`/api/purchase-orders/${po.id}`);
  });

  it('lists with counts, status filter, search and sorting; other tenants see nothing', async () => {
    const list = await api(app, owner).get('/api/purchase-orders?sortBy=purchaseOrderNumber&sortOrder=asc');
    assert.equal(list.status, 200);
    assert.equal(list.body.data[0].purchaseOrderNumber, 'PO-00001');
    assert.equal(list.body.counts.DRAFT, 2);
    const search = await api(app, owner).get('/api/purchase-orders?search=karnataka');
    assert.equal(search.body.data.length, 1);
    const other = await api(app, otherOwner).get('/api/purchase-orders');
    assert.equal(other.body.data.length, 0);
    const cross = await api(app, otherOwner).get(`/api/purchase-orders/${draftId}`);
    assert.equal(cross.status, 404);
  });

  it('issues a draft; executive cannot issue or cancel but can edit', async () => {
    const denied = await api(app, executive).post(`/api/purchase-orders/${draftId}/issue`);
    assert.equal(denied.status, 403);
    const asDraftOnly = await api(app, executive).post('/api/purchase-orders?issue=true').send(poPayload());
    assert.equal(asDraftOnly.status, 400);

    const edit = await api(app, executive).put(`/api/purchase-orders/${draftId}`).send(poPayload({ referenceNumber: 'REQ-78' }));
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    assert.equal(edit.body.data.referenceNumber, 'REQ-78');

    const issued = await api(app, owner).post(`/api/purchase-orders/${draftId}/issue`);
    assert.equal(issued.status, 200);
    assert.equal(issued.body.data.status, 'ISSUED');
    issuedId = draftId;
    const again = await api(app, owner).post(`/api/purchase-orders/${draftId}/issue`);
    assert.equal(again.status, 409);
  });

  it('save-and-issue creates an issued order directly', async () => {
    const res = await api(app, owner).post('/api/purchase-orders?issue=true').send(poPayload({ vendorId: vendorKarnatakaId }));
    assert.equal(res.status, 201);
    assert.equal(res.body.data.status, 'ISSUED');
    const acts = await api(app, owner).get(`/api/purchase-orders/${res.body.data.id}/activity`);
    assert.deepEqual(acts.body.data.map((a: { action: string }) => a.action), ['PO_ISSUED', 'PO_CREATED']);
    await api(app, owner).post(`/api/purchase-orders/${res.body.data.id}/cancel`).send({ reason: 'test' });
  });

  it('viewer can read but cannot create, edit or delete', async () => {
    assert.equal((await api(app, viewer).get(`/api/purchase-orders/${issuedId}`)).status, 200);
    assert.equal((await api(app, viewer).post('/api/purchase-orders').send(poPayload())).status, 403);
    assert.equal((await api(app, viewer).put(`/api/purchase-orders/${issuedId}`).send(poPayload())).status, 403);
    assert.equal((await api(app, viewer).delete(`/api/purchase-orders/${issuedId}`)).status, 403);
  });

  /* ---- receives ------------------------------------------------------------ */
  let receiveId: string;

  it('receives part of an issued order and moves it to PARTIALLY_RECEIVED', async () => {
    const po = (await api(app, owner).get(`/api/purchase-orders/${issuedId}`)).body.data;
    const preview = await api(app, owner).get('/api/purchase-receives/next-number');
    assert.equal(preview.body.data.preview, 'GRN-00001');

    const res = await api(app, executive).post('/api/purchase-receives').set('Idempotency-Key', randomUUID()).send({
      purchaseOrderId: issuedId,
      receivedDate: '2026-10-01',
      notes: 'First lot',
      lines: [
        { purchaseOrderLineId: po.lines[0].id, quantity: 4 },
        { purchaseOrderLineId: po.lines[1].id, quantity: 0 },
      ],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    receiveId = res.body.data.id;
    assert.equal(res.body.data.receiveNumber, 'GRN-00001');
    assert.equal(res.body.data.totalQuantity, 4);
    assert.equal(res.body.data.lines.length, 1, 'zero-quantity lines are dropped');

    const after = (await api(app, owner).get(`/api/purchase-orders/${issuedId}`)).body.data;
    assert.equal(after.status, 'PARTIALLY_RECEIVED');
    assert.equal(after.lines[0].receivedQuantity, 4);
    assert.equal(after.lines[0].remainingQuantity, 6);
    assert.equal(after.receives.length, 1);
  });

  it('rejects receiving more than the remaining quantity and receiving against drafts', async () => {
    const po = (await api(app, owner).get(`/api/purchase-orders/${issuedId}`)).body.data;
    const over = await api(app, owner).post('/api/purchase-receives').set('Idempotency-Key', randomUUID()).send({ purchaseOrderId: issuedId, receivedDate: '2026-10-02', lines: [{ purchaseOrderLineId: po.lines[0].id, quantity: 7 }] });
    assert.equal(over.status, 422);
    assert.match(over.body.error.details[0].message, /Only 6/);

    const draft = await api(app, owner).post('/api/purchase-orders').send(poPayload());
    const notIssued = await api(app, owner).post('/api/purchase-receives').set('Idempotency-Key', randomUUID()).send({ purchaseOrderId: draft.body.data.id, receivedDate: '2026-10-02', lines: [{ purchaseOrderLineId: draft.body.data.lines[0].id, quantity: 1 }] });
    assert.equal(notIssued.status, 409);
    assert.equal(notIssued.body.error.code, 'PO_NOT_RECEIVABLE');
    await api(app, owner).delete(`/api/purchase-orders/${draft.body.data.id}`);
  });

  it('protects received lines during edits', async () => {
    const po = (await api(app, owner).get(`/api/purchase-orders/${issuedId}`)).body.data;
    const shrink = await api(app, owner).put(`/api/purchase-orders/${issuedId}`).send(poPayload({ lines: [{ id: po.lines[0].id, itemId: itemA.id, quantity: 3, rate: 3200, taxId: gst18.id }, { id: po.lines[1].id, itemId: itemB.id, quantity: 5, rate: 850, taxId: gst18.id }] }));
    assert.equal(shrink.status, 422);
    assert.equal(shrink.body.error.details[0].path, 'lines.0.quantity');

    const remove = await api(app, owner).put(`/api/purchase-orders/${issuedId}`).send(poPayload({ lines: [{ id: po.lines[1].id, itemId: itemB.id, quantity: 5, rate: 850, taxId: gst18.id }] }));
    assert.equal(remove.status, 422);

    const vendorChange = await api(app, owner).put(`/api/purchase-orders/${issuedId}`).send(poPayload({ vendorId: vendorKarnatakaId }));
    assert.equal(vendorChange.status, 422);
    assert.equal(vendorChange.body.error.details[0].path, 'vendorId');

    // Increasing quantity is fine and keeps the PO partially received.
    const grow = await api(app, owner).put(`/api/purchase-orders/${issuedId}`).send(poPayload({ lines: [{ id: po.lines[0].id, itemId: itemA.id, quantity: 12, rate: 3200, taxId: gst18.id }, { id: po.lines[1].id, itemId: itemB.id, quantity: 5, rate: 850, taxId: gst18.id }] }));
    assert.equal(grow.status, 200, JSON.stringify(grow.body));
    assert.equal(grow.body.data.status, 'PARTIALLY_RECEIVED');
    assert.equal(grow.body.data.lines[0].remainingQuantity, 8);
  });

  it('cannot cancel a PO with receives; receiving everything marks it RECEIVED', async () => {
    const blocked = await api(app, owner).post(`/api/purchase-orders/${issuedId}/cancel`).send({});
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'PO_HAS_RECEIVES');

    const po = (await api(app, owner).get(`/api/purchase-orders/${issuedId}`)).body.data;
    const rest = await api(app, owner).post('/api/purchase-receives').set('Idempotency-Key', randomUUID()).send({
      purchaseOrderId: issuedId,
      receivedDate: '2026-10-03',
      lines: po.lines.map((l: { id: string; remainingQuantity: number }) => ({ purchaseOrderLineId: l.id, quantity: l.remainingQuantity })),
    });
    assert.equal(rest.status, 201, JSON.stringify(rest.body));
    const done = (await api(app, owner).get(`/api/purchase-orders/${issuedId}`)).body.data;
    assert.equal(done.status, 'RECEIVED');
    assert.equal(done.receiveState, 'FULL');

    const noMore = await api(app, owner).post('/api/purchase-receives').set('Idempotency-Key', randomUUID()).send({ purchaseOrderId: issuedId, receivedDate: '2026-10-04', lines: [{ purchaseOrderLineId: po.lines[0].id, quantity: 1 }] });
    assert.equal(noMore.status, 409);
  });

  it('cancelling a receive reverses quantities; viewer cannot cancel', async () => {
    assert.equal((await api(app, viewer).post(`/api/purchase-receives/${receiveId}/cancel`).send({})).status, 403);
    assert.equal((await api(app, executive).post(`/api/purchase-receives/${receiveId}/cancel`).send({})).status, 403);
    const res = await api(app, owner).post(`/api/purchase-receives/${receiveId}/cancel`).send({ reason: 'Damaged lot returned' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'CANCELLED');
    const po = (await api(app, owner).get(`/api/purchase-orders/${issuedId}`)).body.data;
    assert.equal(po.status, 'PARTIALLY_RECEIVED');
    assert.equal(po.lines[0].receivedQuantity, 8);
    const twice = await api(app, owner).post(`/api/purchase-receives/${receiveId}/cancel`).send({});
    assert.equal(twice.status, 409);
  });

  it('lists receives with tenant scoping and links back to the PO', async () => {
    const list = await api(app, owner).get('/api/purchase-receives');
    assert.equal(list.status, 200);
    assert.equal(list.body.counts.ALL, 2);
    assert.equal(list.body.counts.CANCELLED, 1);
    assert.equal(list.body.data[0].purchaseOrder.purchaseOrderNumber, 'PO-00001');
    assert.equal((await api(app, otherOwner).get(`/api/purchase-receives/${receiveId}`)).status, 404);
    const txns = await api(app, owner).get(`/api/vendors/${vendorId}/transactions`);
    assert.equal(txns.body.data.modules.purchaseOrders.available, true);
    assert.ok(txns.body.data.modules.purchaseOrders.total >= 1);
    assert.equal(txns.body.data.modules.purchaseReceives.total, 2);
  });

  it('closes and reopens a partially received order; delete only applies to drafts', async () => {
    const closed = await api(app, owner).post(`/api/purchase-orders/${issuedId}/close`);
    assert.equal(closed.status, 200);
    assert.equal(closed.body.data.status, 'CLOSED');
    const noDelete = await api(app, owner).delete(`/api/purchase-orders/${issuedId}`);
    assert.equal(noDelete.status, 409);
    const reopened = await api(app, owner).post(`/api/purchase-orders/${issuedId}/reopen`);
    assert.equal(reopened.body.data.status, 'PARTIALLY_RECEIVED');

    const draft = await api(app, owner).post('/api/purchase-orders').send(poPayload());
    const del = await api(app, owner).delete(`/api/purchase-orders/${draft.body.data.id}`);
    assert.equal(del.status, 200);
    assert.equal((await api(app, owner).get(`/api/purchase-orders/${draft.body.data.id}`)).status, 404);
  });

  it('supports PO custom fields defined in settings', async () => {
    const def = await api(app, owner).post('/api/settings/custom-fields').send({ entityType: 'PURCHASE_ORDER', label: 'Project Code', fieldType: 'TEXT', isRequired: true });
    assert.equal(def.status, 201, JSON.stringify(def.body));
    const missing = await api(app, owner).post('/api/purchase-orders').send(poPayload());
    assert.equal(missing.status, 422);
    assert.match(missing.body.error.details[0].message, /Project Code is required/);
    const ok = await api(app, owner).post('/api/purchase-orders').send(poPayload({ customFields: [{ fieldId: def.body.data.id, value: 'RF-2026' }] }));
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.data.customFields[0].value, 'RF-2026');
    const vendorFields = await api(app, owner).get('/api/settings/custom-fields');
    assert.equal(vendorFields.body.data.length, 0, 'PO fields do not leak into the vendor form');
    await api(app, owner).patch(`/api/settings/custom-fields/${def.body.data.id}`).send({ isActive: false });
  });
});

/* ------------------------------------------------------------------------- */
describe('purchase settings', () => {
  it('manages locations, taxes and numbering; viewer can read but not change', async () => {
    const loc = await api(app, owner).post('/api/settings/locations').send({ name: 'Pune Warehouse', type: 'WAREHOUSE', addressLine1: 'Plot 7 Chakan', city: 'Pune', state: 'Maharashtra', stateCode: '27', postalCode: '410501' });
    assert.equal(loc.status, 201, JSON.stringify(loc.body));
    assert.equal(loc.body.data.isPrimary, false);
    assert.equal((await api(app, viewer).post('/api/settings/locations').send({ name: 'x' })).status, 403);
    assert.equal((await api(app, viewer).get('/api/settings/locations')).status, 200);

    const tax = await api(app, owner).post('/api/settings/taxes').send({ name: 'GST3', rate: 3 });
    assert.equal(tax.status, 201);
    const dup = await api(app, owner).post('/api/settings/taxes').send({ name: 'GST18', rate: 18 });
    assert.equal(dup.status, 409);

    const seq = await api(app, owner).put('/api/settings/document-sequences/PURCHASE_ORDER').send({ prefix: 'PO/26-27/', nextNumber: 500, padding: 4 });
    assert.equal(seq.status, 200, JSON.stringify(seq.body));
    assert.equal(seq.body.data.preview, 'PO/26-27/0500');
    const next = await api(app, owner).get('/api/purchase-orders/next-number');
    assert.equal(next.body.data.preview, 'PO/26-27/0500');
    const bundle = await api(app, owner).get('/api/settings/purchase-order-form-options');
    assert.equal(bundle.status, 200);
    assert.ok(bundle.body.data.taxes.length >= 5);
    assert.ok(bundle.body.data.locations.length >= 2);
  });
});
