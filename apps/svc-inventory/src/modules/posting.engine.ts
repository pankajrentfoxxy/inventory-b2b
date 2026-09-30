/**
 * Posting engine (phase-04 4.5). Runs inside the caller's transaction with the tenant RLS context
 * already set. One posting = a set of signed lines that sum to zero per item, an optional set of
 * serials, and an idempotency key. Balances are updated with conditional UPDATEs in a deterministic
 * key order (no negative stock, no deadlocks); the same key with the same payload replays.
 */
import { EVENT_TYPES } from '@b2b/contracts';
import { HttpError, businessRuleError, enqueueEvent, hashPayload, uuidv7, type ErrorDetail } from '@b2b/platform-kit';
import { Prisma, type Tx } from '../db.js';
import { ALLOWED_TRANSITIONS, POSTING_RULES, REENTRY_BUCKETS, UNBINNED, isAllowedTransition, isVirtualBucket, isWarehouseBucket, type Bucket, type PostingType } from './buckets.js';

export const PRODUCER = 'svc-inventory';

export interface PostingLineInput {
  itemId: string;
  warehouseId: string | null;
  binId: string | null;
  partyId: string | null;
  bucket: Bucket;
  /** Signed. */
  qty: number;
  unitCost: number | null;
  gradeCode: string | null;
}

export interface PostingSerialInput {
  itemId: string;
  serialNo: string;
  imei?: string | null;
  gradeCode?: string | null;
  /** Needed only when the item has several negative / positive lines in one posting. */
  fromLineNo?: number | null;
  toLineNo?: number | null;
  refs?: Partial<Record<'poId' | 'grnId' | 'qcLotId' | 'soId' | 'reservationId' | 'dcId' | 'shipmentId', string | null>>;
}

export interface PostingRequest {
  postingType: PostingType;
  refType: string;
  refId: string;
  refNumber?: string | null;
  idempotencyKey: string;
  requestedByService: string;
  actorId: string | null;
  actorName?: string | null;
  correlationId: string;
  reversalOf?: string | null;
  lines: PostingLineInput[];
  serials?: PostingSerialInput[];
}

export interface PostedLine extends PostingLineInput {
  lineNo: number;
}
export interface PostedSerial {
  serialUnitId: string;
  serialNo: string;
  itemId: string;
  toBucket: Bucket;
}
export interface PostingResult {
  postingId: string;
  postingType: PostingType;
  replayed: boolean;
  lines: PostedLine[];
  serials: PostedSerial[];
}

export interface ItemRefLike {
  id: string;
  sku: string;
  name: string;
  unitCode: string;
  qcRequired: boolean;
  trackInventory: boolean;
  isSerialized: boolean;
  requiresImei: boolean;
  serialPattern: string | null;
  status: string;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const detail = (path: string, message: string, extra?: Record<string, unknown>): ErrorDetail => ({ path, message, ...(extra ?? {}) }) as ErrorDetail;

const isSqlState = (err: unknown, state: string) => {
  const e = err as { code?: string; meta?: { code?: string }; message?: string };
  return (e?.code === 'P2010' && e.meta?.code === state) || (typeof e?.message === 'string' && e.message.includes(state));
};

interface PreparedLine extends PostedLine {
  balanceKey: string | null;
}

function prepareLines(req: PostingRequest, items: Map<string, ItemRefLike>): PreparedLine[] {
  const rule = POSTING_RULES[req.postingType];
  if (!rule) throw businessRuleError('INV_POSTING_TYPE_NOT_ALLOWED', `Unknown posting type ${req.postingType}`);
  if (req.lines.length === 0) throw businessRuleError('INV_UNBALANCED_POSTING', 'A posting needs at least two lines');
  const lines: PreparedLine[] = req.lines.map((l, i) => {
    const qty = round3(l.qty);
    const bucket = l.bucket;
    if (!ALLOWED_TRANSITIONS[bucket]) throw businessRuleError('INV_ILLEGAL_BUCKET_TRANSITION', `Unknown bucket ${String(bucket)}`, [detail(`lines.${i}.bucket`, 'Unknown bucket')]);
    if (qty === 0) throw businessRuleError('INV_UNBALANCED_POSTING', 'Line quantity cannot be zero', [detail(`lines.${i}.qty`, 'Quantity cannot be zero')]);
    const item = items.get(l.itemId);
    if (!item) throw businessRuleError('INV_ITEM_NOT_STOCKED', 'Item is unknown to inventory', [detail(`lines.${i}.itemId`, 'Unknown item')]);
    if (!item.trackInventory || item.status === 'ARCHIVED') throw businessRuleError('INV_ITEM_NOT_STOCKED', `Item ${item.sku} does not track inventory`, [detail(`lines.${i}.itemId`, 'Item does not track inventory')]);
    if (isVirtualBucket(bucket) && (l.warehouseId || l.binId)) throw businessRuleError('INV_ILLEGAL_BUCKET_TRANSITION', 'Virtual buckets have no warehouse', [detail(`lines.${i}.warehouseId`, 'Virtual buckets have no warehouse')]);
    if (isWarehouseBucket(bucket) && !l.warehouseId) throw businessRuleError('INV_WAREHOUSE_UNKNOWN', 'Warehouse is required for stock buckets', [detail(`lines.${i}.warehouseId`, 'Warehouse is required')]);
    if (bucket === 'DELIVERED' && (!l.partyId || l.warehouseId)) throw businessRuleError('INV_ILLEGAL_BUCKET_TRANSITION', 'DELIVERED stock is keyed to a customer, not a warehouse', [detail(`lines.${i}.partyId`, 'Customer is required')]);
    if (item.isSerialized && !Number.isInteger(qty)) throw businessRuleError('INV_NON_INTEGER_SERIALIZED_QTY', `Serialized item ${item.sku} needs whole quantities`, [detail(`lines.${i}.qty`, 'Whole quantities only')]);
    if (qty > 0 && rule.costRequired && isWarehouseBucket(bucket) && (l.unitCost === null || l.unitCost === undefined || l.unitCost < 0)) throw businessRuleError('INV_COST_REQUIRED', `${req.postingType} needs a unit cost on incoming stock`, [detail(`lines.${i}.unitCost`, 'Unit cost is required')]);
    const balanceKey = isWarehouseBucket(bucket) ? `${l.itemId}|${l.warehouseId}|${l.binId ?? UNBINNED}|${bucket}` : bucket === 'DELIVERED' ? `${l.itemId}|customer|${l.partyId}|${bucket}` : null;
    return { ...l, qty, unitCost: l.unitCost === null || l.unitCost === undefined ? null : round4(l.unitCost), binId: isWarehouseBucket(bucket) ? l.binId ?? null : null, lineNo: i + 1, balanceKey };
  });

  // balance per item + transition guard
  const byItem = new Map<string, PreparedLine[]>();
  for (const l of lines) byItem.set(l.itemId, [...(byItem.get(l.itemId) ?? []), l]);
  for (const [itemId, ls] of byItem) {
    const sum = round3(ls.reduce((s, l) => s + l.qty, 0));
    if (sum !== 0) throw businessRuleError('INV_UNBALANCED_POSTING', `Lines for item ${items.get(itemId)?.sku ?? itemId} do not sum to zero`, [detail('lines', `Item ${itemId} sums to ${sum}`)]);
    const negatives = ls.filter((l) => l.qty < 0);
    const positives = ls.filter((l) => l.qty > 0);
    if (!negatives.length || !positives.length) throw businessRuleError('INV_UNBALANCED_POSTING', 'Each item needs a source and a destination line');
    for (const n of negatives) {
      if (!rule.from.includes(n.bucket)) throw businessRuleError('INV_ILLEGAL_BUCKET_TRANSITION', `${req.postingType} cannot take stock from ${n.bucket}`, [detail(`lines.${n.lineNo - 1}.bucket`, `Not allowed for ${req.postingType}`)]);
      for (const p of positives) {
        if (!rule.to.includes(p.bucket)) throw businessRuleError('INV_ILLEGAL_BUCKET_TRANSITION', `${req.postingType} cannot put stock into ${p.bucket}`, [detail(`lines.${p.lineNo - 1}.bucket`, `Not allowed for ${req.postingType}`)]);
        if (!isAllowedTransition(n.bucket, p.bucket, req.postingType)) throw businessRuleError('INV_ILLEGAL_BUCKET_TRANSITION', `Stock cannot move from ${n.bucket} to ${p.bucket}`, [detail('lines', `${n.bucket} -> ${p.bucket}`)]);
        if (req.postingType === 'BIN_MOVE' && (n.warehouseId !== p.warehouseId || (n.binId ?? UNBINNED) === (p.binId ?? UNBINNED))) throw businessRuleError('INV_BIN_MOVE_INVALID', 'Bin moves stay inside one warehouse and change the bin');
      }
    }
  }
  return lines;
}

interface PreparedSerial {
  input: PostingSerialInput;
  item: ItemRefLike;
  from: PreparedLine;
  to: PreparedLine;
  key: string;
}

function prepareSerials(req: PostingRequest, lines: PreparedLine[], items: Map<string, ItemRefLike>): PreparedSerial[] {
  const serials = req.serials ?? [];
  const perItemNeeded = new Map<string, number>();
  for (const l of lines) if (l.qty > 0 && items.get(l.itemId)!.isSerialized) perItemNeeded.set(l.itemId, (perItemNeeded.get(l.itemId) ?? 0) + l.qty);
  const perItemGiven = new Map<string, number>();
  const seen = new Set<string>();
  const prepared: PreparedSerial[] = [];
  for (const [i, s] of serials.entries()) {
    const item = items.get(s.itemId);
    if (!item) throw businessRuleError('INV_ITEM_NOT_STOCKED', 'Serial refers to an unknown item', [detail(`serials.${i}.itemId`, 'Unknown item')]);
    if (!item.isSerialized) throw businessRuleError('INV_ITEM_NOT_SERIALIZED', `Item ${item.sku} is not serialized`, [detail(`serials.${i}.itemId`, 'Item is not serialized')]);
    const serialNo = s.serialNo.trim();
    if (!serialNo) throw businessRuleError('SERIAL_PATTERN_MISMATCH', 'Serial number is empty', [detail(`serials.${i}.serialNo`, 'Serial number is required')]);
    const key = `${s.itemId}|${serialNo.toUpperCase()}`;
    if (seen.has(key)) throw businessRuleError('SERIAL_DUPLICATE', `Serial ${serialNo} appears twice in the request`, [detail(`serials.${i}.serialNo`, 'Duplicate in request')]);
    seen.add(key);
    perItemGiven.set(s.itemId, (perItemGiven.get(s.itemId) ?? 0) + 1);
    const negatives = lines.filter((l) => l.itemId === s.itemId && l.qty < 0);
    const positives = lines.filter((l) => l.itemId === s.itemId && l.qty > 0);
    const from = s.fromLineNo ? negatives.find((l) => l.lineNo === s.fromLineNo) : negatives.length === 1 ? negatives[0] : undefined;
    const to = s.toLineNo ? positives.find((l) => l.lineNo === s.toLineNo) : positives.length === 1 ? positives[0] : undefined;
    if (!from || !to) throw businessRuleError('SERIAL_COUNT_MISMATCH', `Serial ${serialNo} must name its source and destination line`, [detail(`serials.${i}`, 'fromLineNo / toLineNo required')]);
    if (isVirtualBucket(from.bucket)) {
      if (item.serialPattern && !new RegExp(item.serialPattern).test(serialNo)) throw businessRuleError('SERIAL_PATTERN_MISMATCH', `Serial ${serialNo} does not match the pattern for ${item.sku}`, [detail(`serials.${i}.serialNo`, 'Pattern mismatch')]);
      if (item.requiresImei && !s.imei) throw businessRuleError('SERIAL_IMEI_REQUIRED', `IMEI is required for ${item.sku}`, [detail(`serials.${i}.imei`, 'IMEI is required')]);
    }
    prepared.push({ input: { ...s, serialNo }, item, from, to, key });
  }
  for (const [itemId, needed] of perItemNeeded) {
    const given = perItemGiven.get(itemId) ?? 0;
    if (given !== needed) throw businessRuleError('SERIAL_COUNT_MISMATCH', `Item ${items.get(itemId)!.sku} moves ${needed} unit(s) but ${given} serial(s) were given`, [detail('serials', `${given} of ${needed}`)]);
  }
  for (const [itemId] of perItemGiven) if (!perItemNeeded.has(itemId)) throw businessRuleError('SERIAL_COUNT_MISMATCH', 'Serials given for an item that does not move');
  // per-line counts: each positive line of a serialized item receives exactly its qty in serials
  for (const l of lines) {
    if (!(l.qty > 0) || !items.get(l.itemId)!.isSerialized) continue;
    const n = prepared.filter((p) => p.to.lineNo === l.lineNo).length;
    if (n !== l.qty) throw businessRuleError('SERIAL_COUNT_MISMATCH', `Line ${l.lineNo} moves ${l.qty} unit(s) but ${n} serial(s) target it`);
  }
  for (const l of lines) {
    if (!(l.qty < 0) || !items.get(l.itemId)!.isSerialized) continue;
    const n = prepared.filter((p) => p.from.lineNo === l.lineNo).length;
    if (n !== -l.qty) throw businessRuleError('SERIAL_COUNT_MISMATCH', `Line ${l.lineNo} releases ${-l.qty} unit(s) but ${n} serial(s) come from it`);
  }
  // deterministic lock order
  return prepared.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

async function loadReplay(tx: Tx, tenantId: string, postingId: string, postingType: PostingType): Promise<PostingResult> {
  const movements = await tx.stockMovement.findMany({ where: { postingId }, orderBy: { lineNo: 'asc' } });
  const events = await tx.serialEvent.findMany({ where: { postingId }, include: { unit: true } });
  return {
    postingId,
    postingType,
    replayed: true,
    lines: movements.map((m) => ({ lineNo: m.lineNo, itemId: m.itemId, warehouseId: m.warehouseId, binId: m.binId, partyId: m.partyId, bucket: m.bucket as Bucket, qty: Number(m.qty), unitCost: m.unitCost === null ? null : Number(m.unitCost), gradeCode: m.gradeCode })),
    serials: events.map((e) => ({ serialUnitId: e.serialUnitId, serialNo: e.unit.serialNo, itemId: e.unit.itemId, toBucket: e.toBucket as Bucket })),
  };
}

/** Loads the item refs the posting needs (RLS filters by tenant). */
export async function loadItems(tx: Tx, itemIds: string[]): Promise<Map<string, ItemRefLike>> {
  const rows = await tx.itemRef.findMany({ where: { id: { in: [...new Set(itemIds)] } } });
  return new Map(rows.map((r) => [r.id, r]));
}

export async function postInTx(tx: Tx, tenantId: string, req: PostingRequest, items?: Map<string, ItemRefLike>): Promise<PostingResult> {
  const itemMap = items ?? (await loadItems(tx, [...req.lines.map((l) => l.itemId), ...(req.serials ?? []).map((s) => s.itemId)]));
  const lines = prepareLines(req, itemMap);
  const serials = prepareSerials(req, lines, itemMap);
  const rule = POSTING_RULES[req.postingType];

  // warehouses / bins must be known (replicated from master) and bins must belong to their warehouse
  const warehouseIds = [...new Set(lines.map((l) => l.warehouseId).filter((x): x is string => Boolean(x)))];
  if (warehouseIds.length) {
    const known = await tx.warehouseRef.findMany({ where: { id: { in: warehouseIds } } });
    for (const id of warehouseIds) if (!known.some((w) => w.id === id)) throw businessRuleError('INV_WAREHOUSE_UNKNOWN', 'Warehouse is unknown to inventory', [detail('lines', `warehouse ${id}`)]);
  }
  const binIds = [...new Set(lines.map((l) => l.binId).filter((x): x is string => Boolean(x)))];
  if (binIds.length) {
    const bins = await tx.binRef.findMany({ where: { id: { in: binIds } } });
    for (const l of lines) {
      if (!l.binId) continue;
      const b = bins.find((x) => x.id === l.binId);
      if (!b || b.warehouseId !== l.warehouseId) throw businessRuleError('INV_BIN_UNKNOWN', 'Bin is unknown or belongs to another warehouse', [detail(`lines.${l.lineNo - 1}.binId`, 'Unknown bin')]);
      if (b.status !== 'ACTIVE' && l.qty > 0) throw businessRuleError('INV_BIN_UNKNOWN', `Bin ${b.code} is inactive`, [detail(`lines.${l.lineNo - 1}.binId`, 'Inactive bin')]);
    }
  }

  // 1. idempotent posting row
  const payloadHash = hashPayload({ t: req.postingType, r: req.refType, id: req.refId, lines: lines.map((l) => [l.itemId, l.warehouseId, l.binId, l.partyId, l.bucket, l.qty]), serials: serials.map((s) => s.key) });
  const postingId = uuidv7();
  const inserted = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "stock_postings" ("id", "tenant_id", "posting_type", "ref_type", "ref_id", "ref_number", "idempotency_key", "payload_hash", "requested_by_service", "actor_id", "reversal_of")
    VALUES (${postingId}::uuid, ${tenantId}::uuid, ${req.postingType}, ${req.refType}, ${req.refId}::uuid, ${req.refNumber ?? null}, ${req.idempotencyKey}, ${payloadHash}, ${req.requestedByService}, ${req.actorId}::uuid, ${req.reversalOf ?? null}::uuid)
    ON CONFLICT ("tenant_id", "idempotency_key") DO NOTHING
    RETURNING "id"`;
  if (inserted.length === 0) {
    const existing = await tx.stockPosting.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: req.idempotencyKey } } });
    if (!existing) throw new HttpError(409, 'CONCURRENT_MODIFICATION', 'The posting is being recorded by another request. Please retry.', undefined, true);
    if (existing.payloadHash !== payloadHash) throw businessRuleError('INV_POSTING_KEY_CONFLICT', 'This idempotency key was already used with a different posting', [detail('idempotencyKey', 'Key reused with a different payload')]);
    return loadReplay(tx, tenantId, existing.id, existing.postingType as PostingType);
  }

  // 2. balances: aggregate deltas per key, then conditional updates in sorted key order
  const deltas = new Map<string, { line: PreparedLine; delta: number }>();
  for (const l of lines) {
    if (!l.balanceKey) continue;
    const d = deltas.get(l.balanceKey);
    if (d) d.delta = round3(d.delta + l.qty);
    else deltas.set(l.balanceKey, { line: l, delta: l.qty });
  }
  for (const key of [...deltas.keys()].sort()) {
    const { line, delta } = deltas.get(key)!;
    if (delta === 0) continue;
    if (line.bucket === 'DELIVERED') {
      await tx.$executeRaw`INSERT INTO "customer_stock_balances" ("tenant_id", "item_id", "party_id", "bucket", "qty") VALUES (${tenantId}::uuid, ${line.itemId}::uuid, ${line.partyId}::uuid, ${line.bucket}, 0) ON CONFLICT DO NOTHING`;
      const updated = await tx.$queryRaw<{ qty: number }[]>`UPDATE "customer_stock_balances" SET "qty" = "qty" + ${delta}::numeric, "version" = "version" + 1, "updated_at" = now()
        WHERE "tenant_id" = ${tenantId}::uuid AND "item_id" = ${line.itemId}::uuid AND "party_id" = ${line.partyId}::uuid AND "bucket" = ${line.bucket} AND "qty" + ${delta}::numeric >= 0 RETURNING "qty"::float8 AS qty`;
      if (updated.length === 0) throw await insufficient(tx, tenantId, line, -delta);
      continue;
    }
    const binId = line.binId ?? UNBINNED;
    await tx.$executeRaw`INSERT INTO "stock_balances" ("tenant_id", "item_id", "warehouse_id", "bin_id", "bucket", "qty") VALUES (${tenantId}::uuid, ${line.itemId}::uuid, ${line.warehouseId}::uuid, ${binId}::uuid, ${line.bucket}, 0) ON CONFLICT DO NOTHING`;
    const updated = await tx.$queryRaw<{ qty: number }[]>`UPDATE "stock_balances" SET "qty" = "qty" + ${delta}::numeric, "version" = "version" + 1, "updated_at" = now()
      WHERE "tenant_id" = ${tenantId}::uuid AND "item_id" = ${line.itemId}::uuid AND "warehouse_id" = ${line.warehouseId}::uuid AND "bin_id" = ${binId}::uuid AND "bucket" = ${line.bucket} AND "qty" + ${delta}::numeric >= 0
      RETURNING "qty"::float8 AS qty`;
    if (updated.length === 0) throw await insufficient(tx, tenantId, line, -delta);
  }

  // 3. serials (sorted by item + serial for a deterministic lock order)
  const postedSerials: PostedSerial[] = [];
  for (const s of serials) {
    const upper = s.input.serialNo.toUpperCase();
    const existing = await tx.$queryRaw<{ id: string; bucket: string; warehouse_id: string | null; bin_id: string | null; party_id: string | null; serial_no: string }[]>`
      SELECT "id", "bucket", "warehouse_id", "bin_id", "party_id", "serial_no" FROM "serial_units" WHERE "tenant_id" = ${tenantId}::uuid AND "item_id" = ${s.item.id}::uuid AND upper("serial_no") = ${upper} FOR UPDATE`;
    const unit = existing[0];
    const qcStatus = rule.qcStatus ?? null;
    const refs = s.input.refs ?? {};
    let serialUnitId: string;
    if (isVirtualBucket(s.from.bucket)) {
      if (unit && !REENTRY_BUCKETS.includes(unit.bucket as Bucket)) throw businessRuleError('SERIAL_DUPLICATE', `Serial ${s.input.serialNo} already exists for ${s.item.sku} (${unit.bucket})`, [detail('serials', s.input.serialNo, { duplicates: [s.input.serialNo] })]);
      if (unit) {
        serialUnitId = unit.id;
        await tx.serialUnit.update({ where: { id: unit.id }, data: { bucket: s.to.bucket, warehouseId: s.to.warehouseId, binId: s.to.binId, partyId: s.to.partyId, gradeCode: s.input.gradeCode ?? s.to.gradeCode ?? null, qcStatus: qcStatus ?? 'PENDING', unitCost: s.to.unitCost, imei: s.input.imei ?? undefined, ...refs, version: { increment: 1 } } });
      } else {
        serialUnitId = uuidv7();
        try {
          await tx.serialUnit.create({ data: { id: serialUnitId, tenantId, itemId: s.item.id, serialNo: s.input.serialNo, imei: s.input.imei ?? null, bucket: s.to.bucket, warehouseId: s.to.warehouseId, binId: s.to.binId, partyId: s.to.partyId, gradeCode: s.input.gradeCode ?? s.to.gradeCode ?? null, qcStatus: qcStatus ?? 'PENDING', unitCost: s.to.unitCost, ...refs } });
        } catch (err) {
          if ((err as { code?: string }).code === 'P2002' || isSqlState(err, '23505')) throw businessRuleError('SERIAL_DUPLICATE', `Serial ${s.input.serialNo} already exists for ${s.item.sku}`, [detail('serials', s.input.serialNo, { duplicates: [s.input.serialNo] })]);
          throw err;
        }
      }
    } else {
      if (!unit) throw businessRuleError('SERIAL_NOT_IN_EXPECTED_STATE', `Serial ${s.input.serialNo} is unknown for ${s.item.sku}`, [detail('serials', s.input.serialNo)]);
      const sameWarehouse = (unit.warehouse_id ?? null) === (s.from.warehouseId ?? null);
      const sameBin = s.from.binId ? unit.bin_id === s.from.binId : true;
      const sameParty = s.from.bucket === 'DELIVERED' ? unit.party_id === s.from.partyId : true;
      if (unit.bucket !== s.from.bucket || !sameWarehouse || !sameBin || !sameParty) {
        throw businessRuleError('SERIAL_NOT_IN_EXPECTED_STATE', `Serial ${s.input.serialNo} is in ${unit.bucket}, not ${s.from.bucket}`, [detail('serials', s.input.serialNo, { current: unit.bucket, expected: s.from.bucket })]);
      }
      serialUnitId = unit.id;
      await tx.serialUnit.update({ where: { id: unit.id }, data: { bucket: s.to.bucket, warehouseId: s.to.warehouseId, binId: s.to.binId, partyId: s.to.partyId, ...(s.input.gradeCode !== undefined && s.input.gradeCode !== null ? { gradeCode: s.input.gradeCode } : {}), ...(qcStatus ? { qcStatus } : {}), ...refs, version: { increment: 1 } } });
    }
    await tx.serialEvent.create({ data: { id: uuidv7(), tenantId, serialUnitId, postingId, fromBucket: unit ? unit.bucket : null, toBucket: s.to.bucket, warehouseId: s.to.warehouseId, binId: s.to.binId, partyId: s.to.partyId, refType: req.refType, refId: req.refId, refNumber: req.refNumber ?? null } });
    postedSerials.push({ serialUnitId, serialNo: s.input.serialNo, itemId: s.item.id, toBucket: s.to.bucket });
  }

  // 4. ledger lines
  await tx.stockMovement.createMany({ data: lines.map((l) => ({ id: uuidv7(), tenantId, postingId, lineNo: l.lineNo, itemId: l.itemId, warehouseId: l.warehouseId, binId: l.binId, partyId: l.partyId, bucket: l.bucket, qty: l.qty, unitCost: l.unitCost, gradeCode: l.gradeCode })) });

  // 5. weighted average cost on inbound / outbound to the outside world
  for (const l of lines) {
    if (!l.warehouseId) continue;
    const counterpart = lines.find((o) => o.itemId === l.itemId && Math.sign(o.qty) !== Math.sign(l.qty) && isVirtualBucket(o.bucket));
    if (!counterpart) continue;
    if (l.qty > 0 && l.unitCost !== null) {
      await tx.$executeRaw`INSERT INTO "item_cost" ("tenant_id", "item_id", "warehouse_id", "avg_cost", "qty_basis") VALUES (${tenantId}::uuid, ${l.itemId}::uuid, ${l.warehouseId}::uuid, ${l.unitCost}::numeric, ${l.qty}::numeric)
        ON CONFLICT ("tenant_id", "item_id", "warehouse_id") DO UPDATE SET
          "avg_cost" = CASE WHEN "item_cost"."qty_basis" + EXCLUDED."qty_basis" > 0 THEN round((("item_cost"."avg_cost" * "item_cost"."qty_basis") + (EXCLUDED."avg_cost" * EXCLUDED."qty_basis")) / ("item_cost"."qty_basis" + EXCLUDED."qty_basis"), 4) ELSE EXCLUDED."avg_cost" END,
          "qty_basis" = "item_cost"."qty_basis" + EXCLUDED."qty_basis"`;
    } else if (l.qty < 0) {
      await tx.$executeRaw`UPDATE "item_cost" SET "qty_basis" = greatest("qty_basis" + ${l.qty}::numeric, 0) WHERE "tenant_id" = ${tenantId}::uuid AND "item_id" = ${l.itemId}::uuid AND "warehouse_id" = ${l.warehouseId}::uuid`;
    }
  }

  // 6. event
  await enqueueEvent(tx, PRODUCER, {
    eventType: EVENT_TYPES.INVENTORY_POSTING_RECORDED,
    tenantId,
    aggregate: { type: 'stock_posting', id: postingId, version: 0 },
    actor: { type: req.actorId ? 'user' : 'system', id: req.actorId, name: req.actorName ?? null },
    correlationId: req.correlationId,
    payload: {
      postingId,
      postingType: req.postingType,
      refType: req.refType,
      refId: req.refId,
      refNumber: req.refNumber ?? null,
      idempotencyKey: req.idempotencyKey,
      lines: lines.map((l) => ({ lineNo: l.lineNo, itemId: l.itemId, warehouseId: l.warehouseId, binId: l.binId, partyId: l.partyId, bucket: l.bucket, qty: l.qty, unitCost: l.unitCost, gradeCode: l.gradeCode })),
      serials: postedSerials,
    },
  });

  return { postingId, postingType: req.postingType, replayed: false, lines: lines.map(({ balanceKey: _k, ...rest }) => rest), serials: postedSerials };
}

async function insufficient(tx: Tx, tenantId: string, line: PreparedLine, requested: number): Promise<HttpError> {
  let available = 0;
  if (line.bucket === 'DELIVERED') {
    const r = await tx.$queryRaw<{ qty: number }[]>`SELECT "qty"::float8 AS qty FROM "customer_stock_balances" WHERE "tenant_id" = ${tenantId}::uuid AND "item_id" = ${line.itemId}::uuid AND "party_id" = ${line.partyId}::uuid AND "bucket" = ${line.bucket}`;
    available = r[0]?.qty ?? 0;
  } else {
    const r = await tx.$queryRaw<{ qty: number }[]>`SELECT "qty"::float8 AS qty FROM "stock_balances" WHERE "tenant_id" = ${tenantId}::uuid AND "item_id" = ${line.itemId}::uuid AND "warehouse_id" = ${line.warehouseId}::uuid AND "bin_id" = ${line.binId ?? UNBINNED}::uuid AND "bucket" = ${line.bucket}`;
    available = r[0]?.qty ?? 0;
  }
  return businessRuleError('INSUFFICIENT_STOCK', `Not enough stock in ${line.bucket}: ${available} available, ${requested} requested`, [
    detail(`lines.${line.lineNo - 1}.qty`, 'Insufficient stock', { itemId: line.itemId, warehouseId: line.warehouseId, binId: line.binId, bucket: line.bucket, available, requested }),
  ]);
}

export { Prisma };
