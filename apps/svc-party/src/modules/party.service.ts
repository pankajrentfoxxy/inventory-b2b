/**
 * Suppliers and customers (phase-03). GSTIN format + mod-36 checksum come from the shared
 * validators; the GSTIN state must match the default billing address; registered treatments need a
 * GSTIN; duplicates per tenant and party type are rejected. Every change emits a snapshot event
 * with the new version so procurement / sales / billing keep local `party_ref` caches.
 */
import { EVENT_TYPES, type PartySnapshot } from '@b2b/contracts';
import { validateGstin } from '@b2b/shared';
import { businessRuleError, conflict, decodeCursor, encodeCursor, enqueueEvent, notFound, setTenantContext, uuidv7, type SecretBox, type TenantContext } from '@b2b/platform-kit';
import type { Prisma, PrismaClient, Tx } from '../db.js';
import { GSTIN_REQUIRED_TREATMENTS, type AddressInput, type PartyInput } from './party.schema.js';

export const PRODUCER = 'svc-party';
export type PartyType = 'SUPPLIER' | 'CUSTOMER';

export interface Actor {
  userId: string | null;
  name: string | null;
  correlationId: string;
}
export const actorFrom = (ctx: TenantContext): Actor => ({ userId: ctx.userId, name: ctx.userName, correlationId: ctx.correlationId });

type PartyRow = Prisma.PartyGetPayload<{ include: { addresses: true; contacts: true; bankAccounts: true } }>;
const include = { addresses: true, contacts: true, bankAccounts: true } as const;

const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; meta?: { code?: string } };
  return e?.code === 'P2002' || (e?.code === 'P2010' && e.meta?.code === '23505');
};

function codeFrom(name: string): string {
  const letters = name.toUpperCase().split('').filter((c) => (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === ' ');
  return letters.join('').split(' ').filter(Boolean).map((w) => w.slice(0, 4)).join('').slice(0, 12) || 'PARTY';
}

export class PartyService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly box: SecretBox,
  ) {}

  tx<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, tenantId);
      return fn(tx);
    }, { maxWait: 15_000, timeout: 30_000 });
  }

  private async audit(tx: Tx, tenantId: string, actor: Actor, entry: { action: string; partyId: string; summary?: string; oldValue?: unknown; newValue?: unknown; version?: number | null }) {
    await enqueueEvent(tx, PRODUCER, {
      eventType: EVENT_TYPES.AUDIT_RECORDED,
      tenantId,
      aggregate: { type: 'party', id: entry.partyId, version: entry.version ?? null },
      actor: { type: actor.userId ? 'user' : 'system', id: actor.userId, name: actor.name },
      correlationId: actor.correlationId,
      payload: { action: entry.action, entityType: 'PARTY', entityId: entry.partyId, summary: entry.summary ?? null, oldValue: entry.oldValue ?? null, newValue: entry.newValue ?? null, actorName: actor.name },
    });
  }

  private eventType(partyType: PartyType, verb: 'created' | 'updated' | 'blocked'): string {
    const map = {
      SUPPLIER: { created: EVENT_TYPES.PARTY_SUPPLIER_CREATED, updated: EVENT_TYPES.PARTY_SUPPLIER_UPDATED, blocked: EVENT_TYPES.PARTY_SUPPLIER_BLOCKED },
      CUSTOMER: { created: EVENT_TYPES.PARTY_CUSTOMER_CREATED, updated: EVENT_TYPES.PARTY_CUSTOMER_UPDATED, blocked: EVENT_TYPES.PARTY_CUSTOMER_BLOCKED },
    } as const;
    return map[partyType][verb];
  }

  snapshot(p: PartyRow): PartySnapshot {
    const billing = p.addresses.find((a) => a.kind === 'BILLING' && a.isDefault) ?? p.addresses.find((a) => a.kind === 'BILLING') ?? null;
    return {
      id: p.id, tenantId: p.tenantId, partyType: p.partyType as PartyType, code: p.code, legalName: p.legalName, displayName: p.displayName, gstTreatment: p.gstTreatment, gstin: p.gstin, pan: p.pan,
      stateCode: p.gstin ? p.gstin.slice(0, 2) : billing?.stateCode ?? null,
      billingAddress: billing ? { attention: billing.attention, line1: billing.line1, line2: billing.line2, city: billing.city, state: billing.state, stateCode: billing.stateCode, pincode: billing.pincode, country: billing.country, phone: billing.phone } : null,
      paymentTermId: p.paymentTermId, status: p.status, blockedReason: p.blockedReason, version: p.version,
    };
  }

  serialize(p: PartyRow, revealBank = false) {
    return {
      ...this.snapshot(p), email: p.email, phone: p.phone, website: p.website, creditLimit: p.creditLimit === null ? null : Number(p.creditLimit), creditDays: p.creditDays, linkedPartyId: p.linkedPartyId, remarks: p.remarks, customFields: p.customFields, createdAt: p.createdAt, updatedAt: p.updatedAt,
      addresses: p.addresses.map((a) => ({ id: a.id, kind: a.kind, attention: a.attention, line1: a.line1, line2: a.line2, city: a.city, state: a.state, stateCode: a.stateCode, pincode: a.pincode ?? '', country: a.country, phone: a.phone, isDefault: a.isDefault })),
      contacts: p.contacts.map((c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, designation: c.designation, isPrimary: c.isPrimary })),
      bankAccounts: p.bankAccounts.map((b) => ({ id: b.id, bankName: b.bankName, accountHolder: b.accountHolder, accountNumber: revealBank ? this.box.decrypt(b.accountNumberEnc) : `****${b.accountLast4}`, ifsc: b.ifsc, branch: b.branch, accountType: b.accountType, isPrimary: b.isPrimary })),
    };
  }

  /* ---- validation ---------------------------------------------------------- */

  private validateGst(input: { gstTreatment: string; gstin?: string | null; pan?: string | null }, billing: { stateCode: string } | null) {
    const problems: { path: string; message: string }[] = [];
    if ((GSTIN_REQUIRED_TREATMENTS as readonly string[]).includes(input.gstTreatment) && !input.gstin) problems.push({ path: 'gstin', message: `GSTIN is required for ${input.gstTreatment.toLowerCase()} businesses` });
    if (input.gstin) {
      const problem = validateGstin(input.gstin, true);
      if (problem) throw businessRuleError('PARTY_INVALID_GSTIN', problem, [{ path: 'gstin', message: problem }]);
      if (billing && input.gstin.slice(0, 2) !== billing.stateCode) {
        throw businessRuleError('PARTY_GSTIN_STATE_MISMATCH', 'GSTIN state code does not match the billing address state', [{ path: 'gstin', message: `GSTIN is for state ${input.gstin.slice(0, 2)}; billing address is ${billing.stateCode}` }]);
      }
      if (input.pan && input.gstin.slice(2, 12) !== input.pan) problems.push({ path: 'pan', message: 'PAN does not match the GSTIN' });
    }
    if (problems.length) throw businessRuleError('VALIDATION_FAILED', 'Please fix the highlighted fields', problems);
  }

  private normaliseAddresses(addresses: AddressInput[]): AddressInput[] {
    const out = addresses.map((a) => ({ ...a }));
    for (const kind of ['BILLING', 'SHIPPING'] as const) {
      const ofKind = out.filter((a) => a.kind === kind);
      if (ofKind.length && !ofKind.some((a) => a.isDefault)) ofKind[0].isDefault = true;
      let seen = false;
      for (const a of ofKind) {
        if (a.isDefault && seen) a.isDefault = false;
        if (a.isDefault) seen = true;
      }
    }
    return out;
  }

  private async emit(tx: Tx, tenantId: string, type: string, id: string, actor: Actor) {
    const p = await tx.party.findUniqueOrThrow({ where: { id }, include });
    await enqueueEvent(tx, PRODUCER, { eventType: type, tenantId, aggregate: { type: 'party', id, version: p.version }, actor: { type: actor.userId ? 'user' : 'system', id: actor.userId, name: actor.name }, correlationId: actor.correlationId, payload: this.snapshot(p) as unknown as Record<string, unknown> });
    return p;
  }

  private async uniqueCode(tx: Tx, tenantId: string, partyType: PartyType, preferred: string | null, name: string): Promise<string> {
    if (preferred) {
      const dup = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "parties" WHERE "tenant_id" = ${tenantId}::uuid AND "party_type" = ${partyType} AND lower("code") = lower(${preferred})`;
      if (dup.length) throw businessRuleError('MASTER_DUPLICATE_CODE', `Code ${preferred} is already used`, [{ path: 'code', message: 'Already used' }]);
      return preferred;
    }
    const base = codeFrom(name);
    for (let i = 0; i < 50; i += 1) {
      const candidate = i === 0 ? base : `${base}${i + 1}`;
      const dup = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "parties" WHERE "tenant_id" = ${tenantId}::uuid AND "party_type" = ${partyType} AND lower("code") = lower(${candidate})`;
      if (!dup.length) return candidate;
    }
    return `${base}${uuidv7().slice(-6).toUpperCase()}`;
  }

  /* ---- create / read / update ------------------------------------------------ */

  async create(tenantId: string, actor: Actor, partyType: PartyType, input: PartyInput, opts: { id?: string } = {}) {
    return this.tx(tenantId, async (tx) => {
      const addresses = this.normaliseAddresses(input.addresses);
      const billing = addresses.find((a) => a.kind === 'BILLING' && a.isDefault) ?? null;
      this.validateGst(input, billing);
      if (input.gstin) {
        const dup = await tx.party.findFirst({ where: { tenantId, partyType, gstin: input.gstin } });
        if (dup) throw businessRuleError('PARTY_DUPLICATE_GSTIN', `A ${partyType.toLowerCase()} with GSTIN ${input.gstin} already exists`, [{ path: 'gstin', message: 'Already registered' }]);
      }
      const code = await this.uniqueCode(tx, tenantId, partyType, input.code ?? null, input.displayName);
      const id = opts.id ?? uuidv7();
      try {
        await tx.party.create({
          data: {
            id, tenantId, partyType, code, legalName: input.legalName, displayName: input.displayName, gstTreatment: input.gstTreatment, gstin: input.gstin ?? null, pan: input.pan ?? null, paymentTermId: input.paymentTermId ?? null,
            creditLimit: input.creditLimit ?? null, creditDays: input.creditDays ?? null, email: input.email ?? null, phone: input.phone ?? null, website: input.website ?? null, remarks: input.remarks ?? null, customFields: input.customFields as Prisma.InputJsonValue, status: 'ACTIVE',
            addresses: { create: addresses.map((a) => ({ id: uuidv7(), tenantId, kind: a.kind, attention: a.attention ?? null, line1: a.line1, line2: a.line2 ?? null, city: a.city, state: a.state ?? null, stateCode: a.stateCode, pincode: a.pincode ?? '', country: a.country, phone: a.phone ?? null, isDefault: a.isDefault })) },
            contacts: { create: input.contacts.map((c, i) => ({ id: uuidv7(), tenantId, name: c.name, email: c.email ?? null, phone: c.phone ?? null, designation: c.designation ?? null, isPrimary: c.isPrimary || (i === 0 && !input.contacts.some((x) => x.isPrimary)) })) },
            bankAccounts: { create: input.bankAccounts.map((b, i) => ({ id: uuidv7(), tenantId, bankName: b.bankName, accountHolder: b.accountHolder, accountNumberEnc: this.box.encrypt(b.accountNumber ?? ''), accountLast4: (b.accountNumber ?? '').slice(-4), ifsc: b.ifsc ?? '', branch: b.branch ?? null, accountType: b.accountType, isPrimary: b.isPrimary || (i === 0 && !input.bankAccounts.some((x) => x.isPrimary)) })) },
          },
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw businessRuleError('PARTY_DUPLICATE_GSTIN', 'A party with this code or GSTIN already exists', [{ path: 'gstin', message: 'Already registered' }]);
        throw err;
      }
      const p = await this.emit(tx, tenantId, this.eventType(partyType, 'created'), id, actor);
      await this.audit(tx, tenantId, actor, { action: `${partyType}_CREATED`, partyId: id, summary: `${p.code} ${p.displayName}`, newValue: { code: p.code, gstin: p.gstin }, version: 0 });
      return this.serialize(p);
    });
  }

  async get(tenantId: string, partyType: PartyType, id: string, revealBank = false) {
    const p = await this.tx(tenantId, (tx) => tx.party.findFirst({ where: { id, tenantId, partyType }, include }));
    if (!p) throw notFound(`${partyType === 'SUPPLIER' ? 'Supplier' : 'Customer'} not found`);
    const refs = await this.tx(tenantId, (tx) => tx.entityReference.findMany({ where: { tenantId, entityType: partyType, entityId: id } }));
    return { ...this.serialize(p, revealBank), referencedBy: refs.map((r) => r.referencedBy) };
  }

  async list(tenantId: string, partyType: PartyType, q: { q?: string; status?: string; gstTreatment?: string; limit: number; cursor?: string }) {
    const cursor = decodeCursor(q.cursor);
    const where: Prisma.PartyWhereInput = { tenantId, partyType };
    if (q.status) where.status = q.status;
    if (q.gstTreatment) where.gstTreatment = q.gstTreatment;
    if (q.q) where.OR = [{ displayName: { contains: q.q, mode: 'insensitive' } }, { legalName: { contains: q.q, mode: 'insensitive' } }, { code: { contains: q.q, mode: 'insensitive' } }, { gstin: { contains: q.q.toUpperCase() } }, { email: { contains: q.q, mode: 'insensitive' } }];
    if (cursor && typeof cursor[0] === 'string' && typeof cursor[1] === 'string') where.AND = [{ OR: [{ displayName: { gt: cursor[0] } }, { displayName: cursor[0], id: { gt: cursor[1] } }] }];
    const rows = await this.tx(tenantId, (tx) => tx.party.findMany({ where, include, orderBy: [{ displayName: 'asc' }, { id: 'asc' }], take: q.limit + 1 }));
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return { data: page.map((p) => this.serialize(p)), nextCursor: rows.length > q.limit && last ? encodeCursor([last.displayName, last.id]) : null };
  }

  async lookup(tenantId: string, partyType: PartyType, q: string | undefined) {
    const rows = await this.tx(tenantId, (tx) => tx.party.findMany({ where: { tenantId, partyType, status: 'ACTIVE', ...(q ? { OR: [{ displayName: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }, { gstin: { contains: q.toUpperCase() } }] } : {}) }, include, orderBy: { displayName: 'asc' }, take: 20 }));
    return rows.map((p) => this.snapshot(p));
  }

  async patch(tenantId: string, actor: Actor, partyType: PartyType, id: string, patch: Record<string, unknown>, expectedVersion: number | null) {
    return this.tx(tenantId, async (tx) => {
      const current = await tx.party.findFirst({ where: { id, tenantId, partyType }, include });
      if (!current) throw notFound('Not found');
      if (expectedVersion !== null && expectedVersion !== current.version) throw conflict('The record was modified by someone else', 'VERSION_CONFLICT');
      const changed: Record<string, unknown> = {};
      const before: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        const prev = (current as unknown as Record<string, unknown>)[k];
        const prevNorm = prev !== null && typeof prev === 'object' && 'toNumber' in (prev as object) ? Number(prev) : prev;
        if (JSON.stringify(prevNorm) !== JSON.stringify(v)) {
          changed[k] = v;
          before[k] = prevNorm;
        }
      }
      if (!Object.keys(changed).length) return this.serialize(current);
      const billing = current.addresses.find((a) => a.kind === 'BILLING' && a.isDefault) ?? null;
      this.validateGst({ gstTreatment: (changed.gstTreatment as string) ?? current.gstTreatment, gstin: (changed.gstin as string | null | undefined) === undefined ? current.gstin : (changed.gstin as string | null), pan: (changed.pan as string | null | undefined) === undefined ? current.pan : (changed.pan as string | null) }, billing);
      if (changed.gstin) {
        const dup = await tx.party.findFirst({ where: { tenantId, partyType, gstin: changed.gstin as string, id: { not: id } } });
        if (dup) throw businessRuleError('PARTY_DUPLICATE_GSTIN', 'GSTIN already registered', [{ path: 'gstin', message: 'Already registered' }]);
      }
      const r = await tx.party.updateMany({ where: { id, version: current.version }, data: { ...(changed as Prisma.PartyUncheckedUpdateInput), version: current.version + 1 } });
      if (r.count !== 1) throw conflict('The record was modified by someone else', 'VERSION_CONFLICT');
      const p = await this.emit(tx, tenantId, this.eventType(partyType, 'updated'), id, actor);
      await this.audit(tx, tenantId, actor, { action: `${partyType}_UPDATED`, partyId: id, oldValue: before, newValue: changed, version: p.version });
      return this.serialize(p);
    });
  }

  /* ---- lifecycle -------------------------------------------------------------- */

  async setStatus(tenantId: string, actor: Actor, partyType: PartyType, id: string, status: 'ACTIVE' | 'INACTIVE') {
    return this.tx(tenantId, async (tx) => {
      const current = await tx.party.findFirst({ where: { id, tenantId, partyType } });
      if (!current) throw notFound('Not found');
      if (current.status === 'BLOCKED') throw conflict('Unblock the party first', 'PARTY_INVALID_TRANSITION');
      if (current.status === status) throw conflict(`Already ${status}`, 'PARTY_INVALID_TRANSITION');
      await tx.party.update({ where: { id }, data: { status, version: { increment: 1 } } });
      const p = await this.emit(tx, tenantId, this.eventType(partyType, 'updated'), id, actor);
      await this.audit(tx, tenantId, actor, { action: `${partyType}_${status}`, partyId: id, oldValue: { status: current.status }, newValue: { status }, version: p.version });
      return this.serialize(p);
    });
  }

  async block(tenantId: string, actor: Actor, partyType: PartyType, id: string, reason: string) {
    return this.tx(tenantId, async (tx) => {
      const current = await tx.party.findFirst({ where: { id, tenantId, partyType } });
      if (!current) throw notFound('Not found');
      if (current.status === 'BLOCKED') throw conflict('Already blocked', 'PARTY_INVALID_TRANSITION');
      await tx.party.update({ where: { id }, data: { status: 'BLOCKED', blockedReason: reason, version: { increment: 1 } } });
      const p = await this.emit(tx, tenantId, this.eventType(partyType, 'blocked'), id, actor);
      await this.audit(tx, tenantId, actor, { action: `${partyType}_BLOCKED`, partyId: id, oldValue: { status: current.status }, newValue: { status: 'BLOCKED', reason }, version: p.version });
      return this.serialize(p);
    });
  }

  async unblock(tenantId: string, actor: Actor, partyType: PartyType, id: string, reason: string) {
    return this.tx(tenantId, async (tx) => {
      const current = await tx.party.findFirst({ where: { id, tenantId, partyType } });
      if (!current) throw notFound('Not found');
      if (current.status !== 'BLOCKED') throw conflict('Party is not blocked', 'PARTY_INVALID_TRANSITION');
      await tx.party.update({ where: { id }, data: { status: 'ACTIVE', blockedReason: null, version: { increment: 1 } } });
      const p = await this.emit(tx, tenantId, this.eventType(partyType, 'updated'), id, actor);
      await this.audit(tx, tenantId, actor, { action: `${partyType}_UNBLOCKED`, partyId: id, oldValue: { status: 'BLOCKED' }, newValue: { status: 'ACTIVE', reason }, version: p.version });
      return this.serialize(p);
    });
  }

  /** Hard delete only when never referenced; the UI offers "deactivate" by default. */
  async delete(tenantId: string, actor: Actor, partyType: PartyType, id: string) {
    return this.tx(tenantId, async (tx) => {
      const current = await tx.party.findFirst({ where: { id, tenantId, partyType } });
      if (!current) throw notFound('Not found');
      const refs = await tx.entityReference.findMany({ where: { tenantId, entityType: partyType, entityId: id } });
      if (refs.length) throw businessRuleError('MASTER_IN_USE', 'This party has transactions; deactivate or block it instead', refs.map((r) => ({ path: 'referencedBy', message: r.referencedBy })));
      await tx.party.delete({ where: { id } });
      await this.audit(tx, tenantId, actor, { action: `${partyType}_DELETED`, partyId: id, oldValue: { code: current.code } });
      return { id, deleted: true };
    });
  }

  /* ---- sub-resources ------------------------------------------------------------ */

  async addAddress(tenantId: string, actor: Actor, partyType: PartyType, partyId: string, input: AddressInput) {
    return this.tx(tenantId, async (tx) => {
      const p = await tx.party.findFirst({ where: { id: partyId, tenantId, partyType }, include });
      if (!p) throw notFound('Not found');
      if (input.kind === 'BILLING' && (input.isDefault || !p.addresses.some((a) => a.kind === 'BILLING'))) {
        this.validateGst({ gstTreatment: p.gstTreatment, gstin: p.gstin, pan: p.pan }, { stateCode: input.stateCode });
      }
      const makeDefault = input.isDefault || !p.addresses.some((a) => a.kind === input.kind);
      if (makeDefault) await tx.partyAddress.updateMany({ where: { partyId, kind: input.kind, isDefault: true }, data: { isDefault: false } });
      const a = await tx.partyAddress.create({ data: { id: uuidv7(), tenantId, partyId, kind: input.kind, attention: input.attention ?? null, line1: input.line1, line2: input.line2 ?? null, city: input.city, state: input.state ?? null, stateCode: input.stateCode, pincode: input.pincode ?? '', country: input.country, phone: input.phone ?? null, isDefault: makeDefault } });
      await tx.party.update({ where: { id: partyId }, data: { version: { increment: 1 } } });
      await this.emit(tx, tenantId, this.eventType(partyType, 'updated'), partyId, actor);
      await this.audit(tx, tenantId, actor, { action: 'ADDRESS_ADDED', partyId, newValue: { kind: a.kind, city: a.city, stateCode: a.stateCode } });
      return a;
    });
  }

  async removeAddress(tenantId: string, actor: Actor, partyType: PartyType, partyId: string, addressId: string) {
    return this.tx(tenantId, async (tx) => {
      const a = await tx.partyAddress.findFirst({ where: { id: addressId, partyId, tenantId, party: { partyType } } });
      if (!a) throw notFound('Address not found');
      await tx.partyAddress.delete({ where: { id: addressId } });
      if (a.isDefault) {
        const next = await tx.partyAddress.findFirst({ where: { partyId, kind: a.kind } });
        if (next) await tx.partyAddress.update({ where: { id: next.id }, data: { isDefault: true } });
      }
      await tx.party.update({ where: { id: partyId }, data: { version: { increment: 1 } } });
      await this.emit(tx, tenantId, this.eventType(partyType, 'updated'), partyId, actor);
      await this.audit(tx, tenantId, actor, { action: 'ADDRESS_REMOVED', partyId, oldValue: { kind: a.kind, city: a.city } });
      return { id: addressId, deleted: true };
    });
  }

  async addContact(tenantId: string, actor: Actor, partyType: PartyType, partyId: string, input: { name: string; email?: string | null; phone?: string | null; designation?: string | null; isPrimary: boolean }) {
    return this.tx(tenantId, async (tx) => {
      const p = await tx.party.findFirst({ where: { id: partyId, tenantId, partyType }, include: { contacts: true } });
      if (!p) throw notFound('Not found');
      const makePrimary = input.isPrimary || p.contacts.length === 0;
      if (makePrimary) await tx.partyContact.updateMany({ where: { partyId, isPrimary: true }, data: { isPrimary: false } });
      const c = await tx.partyContact.create({ data: { id: uuidv7(), tenantId, partyId, name: input.name, email: input.email ?? null, phone: input.phone ?? null, designation: input.designation ?? null, isPrimary: makePrimary } });
      await this.audit(tx, tenantId, actor, { action: 'CONTACT_ADDED', partyId, newValue: { name: c.name } });
      return c;
    });
  }

  async removeContact(tenantId: string, actor: Actor, partyType: PartyType, partyId: string, contactId: string) {
    return this.tx(tenantId, async (tx) => {
      const c = await tx.partyContact.findFirst({ where: { id: contactId, partyId, tenantId, party: { partyType } } });
      if (!c) throw notFound('Contact not found');
      await tx.partyContact.delete({ where: { id: contactId } });
      await this.audit(tx, tenantId, actor, { action: 'CONTACT_REMOVED', partyId, oldValue: { name: c.name } });
      return { id: contactId, deleted: true };
    });
  }

  async addBankAccount(tenantId: string, actor: Actor, partyType: PartyType, partyId: string, input: { bankName: string; accountHolder: string; accountNumber: string; ifsc: string; branch?: string | null; accountType: string; isPrimary: boolean }) {
    return this.tx(tenantId, async (tx) => {
      const p = await tx.party.findFirst({ where: { id: partyId, tenantId, partyType }, include: { bankAccounts: true } });
      if (!p) throw notFound('Not found');
      const makePrimary = input.isPrimary || p.bankAccounts.length === 0;
      if (makePrimary) await tx.partyBankAccount.updateMany({ where: { partyId, isPrimary: true }, data: { isPrimary: false } });
      const b = await tx.partyBankAccount.create({ data: { id: uuidv7(), tenantId, partyId, bankName: input.bankName, accountHolder: input.accountHolder, accountNumberEnc: this.box.encrypt(input.accountNumber), accountLast4: input.accountNumber.slice(-4), ifsc: input.ifsc, branch: input.branch ?? null, accountType: input.accountType, isPrimary: makePrimary } });
      // Never the full number in audit rows (CLAUDE.md rule).
      await this.audit(tx, tenantId, actor, { action: 'BANK_ACCOUNT_ADDED', partyId, newValue: { bankName: b.bankName, last4: b.accountLast4, ifsc: b.ifsc } });
      return { id: b.id, bankName: b.bankName, accountHolder: b.accountHolder, accountNumber: `****${b.accountLast4}`, ifsc: b.ifsc, branch: b.branch, accountType: b.accountType, isPrimary: b.isPrimary };
    });
  }

  async removeBankAccount(tenantId: string, actor: Actor, partyType: PartyType, partyId: string, accountId: string) {
    return this.tx(tenantId, async (tx) => {
      const b = await tx.partyBankAccount.findFirst({ where: { id: accountId, partyId, tenantId, party: { partyType } } });
      if (!b) throw notFound('Bank account not found');
      await tx.partyBankAccount.delete({ where: { id: accountId } });
      await this.audit(tx, tenantId, actor, { action: 'BANK_ACCOUNT_REMOVED', partyId, oldValue: { bankName: b.bankName, last4: b.accountLast4 } });
      return { id: accountId, deleted: true };
    });
  }

  async revealBankAccount(tenantId: string, actor: Actor, partyType: PartyType, partyId: string, accountId: string) {
    return this.tx(tenantId, async (tx) => {
      const b = await tx.partyBankAccount.findFirst({ where: { id: accountId, partyId, tenantId, party: { partyType } } });
      if (!b) throw notFound('Bank account not found');
      await this.audit(tx, tenantId, actor, { action: 'BANK_ACCOUNT_REVEALED', partyId, newValue: { accountId, last4: b.accountLast4 } });
      return { id: b.id, accountNumber: this.box.decrypt(b.accountNumberEnc) };
    });
  }

  /* ---- internal ------------------------------------------------------------------- */

  async snapshotById(tenantId: string, id: string): Promise<PartySnapshot | null> {
    const p = await this.tx(tenantId, (tx) => tx.party.findFirst({ where: { id, tenantId }, include }));
    return p ? this.snapshot(p) : null;
  }

  async batch(tenantId: string, ids: string[]): Promise<PartySnapshot[]> {
    const rows = await this.tx(tenantId, (tx) => tx.party.findMany({ where: { tenantId, id: { in: ids } }, include }));
    return rows.map((p) => this.snapshot(p));
  }

  async recordReferences(tx: Tx, tenantId: string, refs: { entityType: PartyType; entityId: string; referencedBy: string }[]) {
    for (const r of refs) await tx.$executeRaw`INSERT INTO "entity_references" ("tenant_id", "entity_type", "entity_id", "referenced_by") VALUES (${tenantId}::uuid, ${r.entityType}, ${r.entityId}::uuid, ${r.referencedBy}) ON CONFLICT DO NOTHING`;
  }
}
