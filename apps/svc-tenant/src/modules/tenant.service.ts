/**
 * Tenant lifecycle (phase-01 1.3 state machine). Every transition: lock row -> transition table ->
 * guards -> conditional UPDATE on (status, version) -> history row -> audit + lifecycle event in the
 * same transaction (README 5.7). Data is never deleted by a transition.
 */
import { EVENT_TYPES, type TenantLifecyclePayload } from '@b2b/contracts';
import { HttpError, businessRuleError, conflict, decodeCursor, encodeCursor, enqueueEvent, notFound, uuidv7, type TenantContext } from '@b2b/platform-kit';
import type { Prisma, PrismaClient, Tx } from '../db.js';
import type { CreateTenantInput, UpdateTenantInput } from './tenant.schema.js';

export const PRODUCER = 'svc-tenant';
export type TenantStatus = 'PENDING' | 'APPROVED' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED' | 'REJECTED';

interface Transition {
  command: string;
  from: TenantStatus[];
  to: TenantStatus;
  event: string;
  reasonRequired: boolean;
}

export const TRANSITIONS: Record<string, Transition> = {
  approve: { command: 'approve', from: ['PENDING'], to: 'APPROVED', event: EVENT_TYPES.TENANT_APPROVED, reasonRequired: false },
  reject: { command: 'reject', from: ['PENDING'], to: 'REJECTED', event: EVENT_TYPES.TENANT_REJECTED, reasonRequired: true },
  activate: { command: 'activate', from: ['APPROVED'], to: 'ACTIVE', event: EVENT_TYPES.TENANT_ACTIVATED, reasonRequired: false },
  suspend: { command: 'suspend', from: ['ACTIVE'], to: 'SUSPENDED', event: EVENT_TYPES.TENANT_SUSPENDED, reasonRequired: true },
  reactivate: { command: 'reactivate', from: ['SUSPENDED'], to: 'ACTIVE', event: EVENT_TYPES.TENANT_REACTIVATED, reasonRequired: true },
  deactivate: { command: 'deactivate', from: ['ACTIVE', 'SUSPENDED'], to: 'DEACTIVATED', event: EVENT_TYPES.TENANT_DEACTIVATED, reasonRequired: true },
};

export interface Actor {
  id: string | null;
  name: string | null;
  correlationId: string;
  ip?: string | null;
  userAgent?: string | null;
}

export const actorFrom = (ctx: TenantContext, ip?: string | null, userAgent?: string | null): Actor => ({ id: ctx.userId, name: ctx.userName, correlationId: ctx.correlationId, ip, userAgent });

type TenantRow = NonNullable<Awaited<ReturnType<PrismaClient['tenant']['findUnique']>>>;

export interface TenantServiceOptions {
  fourEyes: boolean;
}

function codeFrom(name: string): string {
  const letters = name.toUpperCase().split('').filter((c) => (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === ' ');
  const words = letters.join('').split(' ').filter(Boolean);
  const base = words.map((w) => w.slice(0, 4)).join('').slice(0, 12) || 'TEN';
  return base;
}

export class TenantService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: TenantServiceOptions,
  ) {}

  /* ---- helpers ---------------------------------------------------------- */

  private async audit(tx: Tx, actor: Actor, entry: { action: string; tenantId: string; summary?: string; oldValue?: unknown; newValue?: unknown; reason?: string | null; version: number }) {
    await enqueueEvent(tx, PRODUCER, {
      eventType: EVENT_TYPES.AUDIT_RECORDED,
      tenantId: entry.tenantId,
      aggregate: { type: 'tenant', id: entry.tenantId, version: entry.version },
      actor: { type: actor.id ? 'user' : 'system', id: actor.id, name: actor.name },
      correlationId: actor.correlationId,
      payload: { action: entry.action, entityType: 'TENANT', entityId: entry.tenantId, summary: entry.summary ?? null, oldValue: entry.oldValue ?? null, newValue: entry.newValue ?? null, reason: entry.reason ?? null, actorName: actor.name, ip: actor.ip ?? null, userAgent: actor.userAgent ?? null },
    });
  }

  private lifecyclePayload(t: TenantRow, previous: TenantStatus | null, reason: string | null, actorId: string | null): TenantLifecyclePayload {
    return { tenantId: t.id, code: t.code, legalName: t.legalName, displayName: t.displayName, status: t.status, previousStatus: previous, reason, ownerName: t.ownerName, ownerEmail: t.ownerEmail, actorId, occurredAt: new Date().toISOString(), source: t.source, stateCode: t.stateCode, registeredAddress: t.registeredAddress as Record<string, unknown> };
  }

  private serialize(t: TenantRow) {
    return {
      id: t.id, code: t.code, legalName: t.legalName, displayName: t.displayName, pan: t.pan, gstin: t.gstin, registeredAddress: t.registeredAddress, stateCode: t.stateCode,
      ownerName: t.ownerName, ownerEmail: t.ownerEmail, ownerPhone: t.ownerPhone, status: t.status, statusReason: t.statusReason, source: t.source,
      createdBy: t.createdBy, approvedBy: t.approvedBy, approvedAt: t.approvedAt, activatedAt: t.activatedAt, suspendedAt: t.suspendedAt, deactivatedAt: t.deactivatedAt,
      createdAt: t.createdAt, updatedAt: t.updatedAt, version: t.version,
    };
  }

  private async lock(tx: Tx, id: string): Promise<TenantRow> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "tenants" WHERE "id" = ${id}::uuid FOR UPDATE`;
    if (!rows[0]) throw notFound('Tenant not found', 'TENANT_NOT_FOUND');
    return tx.tenant.findUniqueOrThrow({ where: { id } });
  }

  private async uniqueCode(tx: Tx, preferred: string | null, name: string): Promise<string> {
    const base = preferred ?? codeFrom(name);
    if (preferred) {
      const exists = await tx.tenant.findUnique({ where: { code: base } });
      if (exists) throw businessRuleError('TENANT_DUPLICATE_CODE', `Code ${base} is already used`, [{ path: 'code', message: 'This code is already used' }]);
      return base;
    }
    for (let i = 0; i < 50; i += 1) {
      const candidate = i === 0 ? base : `${base}${i + 1}`;
      if (!(await tx.tenant.findUnique({ where: { code: candidate } }))) return candidate;
    }
    return `${base}${uuidv7().slice(-6).toUpperCase()}`;
  }

  /* ---- create ----------------------------------------------------------- */

  async create(input: CreateTenantInput, source: 'ADMIN_CREATED' | 'APPLICATION' | 'LEGACY_MIGRATION', actor: Actor, extra: { id?: string; status?: TenantStatus; application?: { ip: string | null; captchaScore: number | null } } = {}) {
    return this.prisma.$transaction(async (tx) => {
      if (input.gstin) {
        const dup = await tx.tenant.findFirst({ where: { gstin: input.gstin, status: { not: 'REJECTED' } } });
        if (dup) throw businessRuleError('TENANT_DUPLICATE_GSTIN', 'A tenant with this GSTIN already exists', [{ path: 'gstin', message: 'This GSTIN is already registered' }]);
      }
      const code = await this.uniqueCode(tx, input.code ?? null, input.displayName);
      const status: TenantStatus = extra.status ?? 'PENDING';
      const tenant = await tx.tenant.create({
        data: {
          id: extra.id ?? uuidv7(), code, legalName: input.legalName, displayName: input.displayName, pan: input.pan ?? null, gstin: input.gstin ?? null,
          registeredAddress: input.registeredAddress, stateCode: input.gstin ? input.gstin.slice(0, 2) : input.registeredAddress.stateCode,
          ownerName: input.ownerName, ownerEmail: input.ownerEmail, ownerPhone: input.ownerPhone ?? null, status, source, createdBy: actor.id,
          activatedAt: status === 'ACTIVE' ? new Date() : null,
          settings: { create: {} },
        },
      });
      await tx.tenantStatusHistory.create({ data: { id: uuidv7(), tenantId: tenant.id, fromStatus: null, toStatus: status, reason: null, actorId: actor.id, actorName: actor.name } });
      if (extra.application) await tx.vendorApplication.create({ data: { id: uuidv7(), tenantId: tenant.id, payload: input as object, submittedIp: extra.application.ip, captchaScore: extra.application.captchaScore } });
      await enqueueEvent(tx, PRODUCER, { eventType: EVENT_TYPES.TENANT_CREATED, tenantId: tenant.id, aggregate: { type: 'tenant', id: tenant.id, version: 0 }, actor: { type: actor.id ? 'user' : 'system', id: actor.id, name: actor.name }, correlationId: actor.correlationId, payload: this.lifecyclePayload(tenant, null, null, actor.id) });
      if (status === 'ACTIVE') {
        await enqueueEvent(tx, PRODUCER, { eventType: EVENT_TYPES.TENANT_ACTIVATED, tenantId: tenant.id, aggregate: { type: 'tenant', id: tenant.id, version: 0 }, actor: { type: 'system', id: null }, correlationId: actor.correlationId, payload: this.lifecyclePayload(tenant, null, 'legacy migration', actor.id) });
      }
      await this.audit(tx, actor, { action: 'TENANT_CREATED', tenantId: tenant.id, summary: `Tenant ${tenant.code} created (${source})`, newValue: { status, legalName: tenant.legalName, gstin: tenant.gstin }, version: 0 });
      return this.serialize(tenant);
    });
  }

  /* ---- update profile ---------------------------------------------------- */

  async update(id: string, input: UpdateTenantInput, expectedVersion: number | null, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, id);
      if (expectedVersion !== null && expectedVersion !== current.version) throw conflict('The tenant was modified by someone else. Reload and try again.', 'VERSION_CONFLICT');
      if (current.status === 'DEACTIVATED' || current.status === 'REJECTED') throw conflict(`A ${current.status.toLowerCase()} tenant cannot be edited`, 'TENANT_INVALID_TRANSITION');
      if (input.gstin && input.gstin !== current.gstin) {
        const dup = await tx.tenant.findFirst({ where: { gstin: input.gstin, status: { not: 'REJECTED' }, id: { not: id } } });
        if (dup) throw businessRuleError('TENANT_DUPLICATE_GSTIN', 'A tenant with this GSTIN already exists', [{ path: 'gstin', message: 'This GSTIN is already registered' }]);
      }
      const changed: Record<string, unknown> = {};
      const before: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input)) {
        if (v === undefined) continue;
        const prev = (current as unknown as Record<string, unknown>)[k];
        if (JSON.stringify(prev) !== JSON.stringify(v)) {
          changed[k] = v;
          before[k] = prev;
        }
      }
      if (Object.keys(changed).length === 0) return this.serialize(current);
      const updated = await tx.tenant.updateMany({ where: { id, version: current.version }, data: { ...(changed as object), version: current.version + 1, ...(changed.gstin ? { stateCode: String(changed.gstin).slice(0, 2) } : {}) } });
      if (updated.count !== 1) throw conflict('The tenant was modified by someone else. Reload and try again.', 'VERSION_CONFLICT');
      await this.audit(tx, actor, { action: 'TENANT_UPDATED', tenantId: id, summary: `Updated ${Object.keys(changed).join(', ')}`, oldValue: before, newValue: changed, version: current.version + 1 });
      return this.serialize(await tx.tenant.findUniqueOrThrow({ where: { id } }));
    });
  }

  /* ---- transitions -------------------------------------------------------- */

  async transition(id: string, command: keyof typeof TRANSITIONS, actor: Actor, input: { reason?: string | null; confirmCode?: string } = {}) {
    const spec = TRANSITIONS[command];
    if (!spec) throw notFound();
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, id);
      const from = current.status as TenantStatus;
      if (!spec.from.includes(from)) {
        throw conflict(`Tenant ${current.code} cannot be ${command}d from status ${from}`, 'TENANT_INVALID_TRANSITION', [{ path: 'status', message: `expected ${spec.from.join(' or ')}` }]);
      }
      const reason = input.reason?.trim() || null;
      if (spec.reasonRequired && !reason) throw businessRuleError('VALIDATION_FAILED', 'A reason is required', [{ path: 'reason', message: 'Reason is required' }]);
      if (command === 'approve') {
        if (this.options.fourEyes && current.createdBy && actor.id && current.createdBy === actor.id) {
          throw businessRuleError('TENANT_FOUR_EYES', 'The person who created the tenant cannot approve it');
        }
        const missing: string[] = [];
        if (!current.pan && !current.gstin) missing.push('pan');
        if (!current.ownerEmail) missing.push('ownerEmail');
        const addr = current.registeredAddress as { line1?: string; pincode?: string } | null;
        if (!addr?.line1 || !addr?.pincode) missing.push('registeredAddress');
        if (missing.length) throw businessRuleError('VALIDATION_FAILED', 'KYC fields are incomplete', missing.map((m) => ({ path: m, message: 'Required before approval' })));
      }
      if (command === 'activate' && !current.ownerEmail) throw businessRuleError('VALIDATION_FAILED', 'Owner email is required before activation', [{ path: 'ownerEmail', message: 'Required' }]);
      if (command === 'deactivate' && input.confirmCode !== current.code) throw businessRuleError('TENANT_CONFIRM_CODE_MISMATCH', 'Type the tenant code exactly to confirm deactivation', [{ path: 'confirmCode', message: `Expected ${current.code}` }]);

      const now = new Date();
      const stamps: Record<string, unknown> = {};
      if (command === 'approve') Object.assign(stamps, { approvedBy: actor.id, approvedAt: now });
      if (command === 'activate') stamps.activatedAt = now;
      if (command === 'suspend') stamps.suspendedAt = now;
      if (command === 'deactivate') stamps.deactivatedAt = now;
      const result = await tx.tenant.updateMany({ where: { id, status: from, version: current.version }, data: { status: spec.to, statusReason: reason, version: current.version + 1, ...stamps } });
      if (result.count !== 1) throw conflict('The tenant was modified by someone else. Reload and try again.', 'VERSION_CONFLICT');
      const version = current.version + 1;
      await tx.tenantStatusHistory.create({ data: { id: uuidv7(), tenantId: id, fromStatus: from, toStatus: spec.to, reason, actorId: actor.id, actorName: actor.name } });
      const after = await tx.tenant.findUniqueOrThrow({ where: { id } });
      await enqueueEvent(tx, PRODUCER, { eventType: spec.event, tenantId: id, aggregate: { type: 'tenant', id, version }, actor: { type: actor.id ? 'user' : 'system', id: actor.id, name: actor.name }, correlationId: actor.correlationId, payload: this.lifecyclePayload(after, from, reason, actor.id) });
      await this.audit(tx, actor, { action: `TENANT_${spec.to}`, tenantId: id, summary: `Tenant ${current.code}: ${from} -> ${spec.to}`, oldValue: { status: from }, newValue: { status: spec.to }, reason, version });
      return this.serialize(after);
    });
  }

  async resendOwnerInvite(id: string, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, id);
      if (current.status !== 'ACTIVE') throw conflict('Owner invites can only be resent for active tenants', 'TENANT_INVALID_TRANSITION');
      await enqueueEvent(tx, PRODUCER, { eventType: EVENT_TYPES.TENANT_OWNER_INVITE_REQUESTED, tenantId: id, aggregate: { type: 'tenant', id, version: current.version }, actor: { type: 'user', id: actor.id, name: actor.name }, correlationId: actor.correlationId, payload: this.lifecyclePayload(current, current.status as TenantStatus, 'resend owner invite', actor.id) });
      await this.audit(tx, actor, { action: 'TENANT_OWNER_INVITE_RESENT', tenantId: id, summary: `Owner invite resent to ${current.ownerEmail}`, version: current.version });
      return { requested: true };
    });
  }

  /* ---- reads -------------------------------------------------------------- */

  async get(id: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id }, include: { history: { orderBy: { occurredAt: 'asc' } }, settings: true } });
    if (!t) throw notFound('Tenant not found', 'TENANT_NOT_FOUND');
    return { ...this.serialize(t), history: t.history.map((h) => ({ id: h.id, fromStatus: h.fromStatus, toStatus: h.toStatus, reason: h.reason, actorId: h.actorId, actorName: h.actorName, occurredAt: h.occurredAt })), settings: t.settings };
  }

  async status(id: string): Promise<{ status: string; version: number }> {
    const t = await this.prisma.tenant.findUnique({ where: { id }, select: { status: true, version: true } });
    if (!t) throw notFound('Tenant not found', 'TENANT_NOT_FOUND');
    return t;
  }

  async list(q: { status?: string; q?: string; limit: number; cursor?: string }) {
    const cursor = decodeCursor(q.cursor);
    const where: Record<string, unknown> = {};
    if (q.status) where.status = q.status;
    if (q.q) where.OR = [{ legalName: { contains: q.q, mode: 'insensitive' } }, { displayName: { contains: q.q, mode: 'insensitive' } }, { code: { contains: q.q, mode: 'insensitive' } }, { gstin: { contains: q.q.toUpperCase() } }, { ownerEmail: { contains: q.q, mode: 'insensitive' } }];
    if (cursor && typeof cursor[0] === 'string' && typeof cursor[1] === 'string') {
      where.OR = where.OR ? [{ AND: [{ OR: where.OR }, { OR: [{ createdAt: { lt: new Date(cursor[0]) } }, { createdAt: new Date(cursor[0]), id: { lt: cursor[1] } }] }] }] : [{ createdAt: { lt: new Date(cursor[0]) } }, { createdAt: new Date(cursor[0]), id: { lt: cursor[1] } }];
    }
    const rows = await this.prisma.tenant.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.limit + 1 });
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return { data: page.map((t) => this.serialize(t)), nextCursor: rows.length > q.limit && last ? encodeCursor([last.createdAt.toISOString(), last.id]) : null };
  }

  async dashboard() {
    const grouped = await this.prisma.tenant.groupBy({ by: ['status'], _count: { _all: true } });
    const counts: Record<string, number> = { PENDING: 0, APPROVED: 0, ACTIVE: 0, SUSPENDED: 0, DEACTIVATED: 0, REJECTED: 0 };
    for (const g of grouped) counts[g.status] = g._count._all;
    const pending = await this.prisma.tenant.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 10 });
    const recent = await this.prisma.tenantStatusHistory.findMany({ orderBy: { occurredAt: 'desc' }, take: 20, include: { tenant: { select: { code: true, displayName: true } } } });
    return {
      counts,
      pendingApprovals: pending.map((t) => ({ id: t.id, code: t.code, displayName: t.displayName, createdAt: t.createdAt, ageHours: Math.round((Date.now() - t.createdAt.getTime()) / 36e5) })),
      recentActions: recent.map((h) => ({ tenantId: h.tenantId, code: h.tenant.code, displayName: h.tenant.displayName, fromStatus: h.fromStatus, toStatus: h.toStatus, reason: h.reason, actorName: h.actorName, occurredAt: h.occurredAt })),
    };
  }

  async updateSettings(id: string, input: { timezone?: string; fyStartMonth?: number; baseCurrency?: string; features?: Record<string, unknown>; limits?: Record<string, unknown> }, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, id);
      const data: Prisma.TenantSettingsUncheckedUpdateInput = {};
      if (input.timezone !== undefined) data.timezone = input.timezone;
      if (input.fyStartMonth !== undefined) data.fyStartMonth = input.fyStartMonth;
      if (input.baseCurrency !== undefined) data.baseCurrency = input.baseCurrency;
      if (input.features !== undefined) data.features = input.features as Prisma.InputJsonValue;
      if (input.limits !== undefined) data.limits = input.limits as Prisma.InputJsonValue;
      const settings = await tx.tenantSettings.upsert({ where: { tenantId: id }, update: data, create: { ...(data as Omit<Prisma.TenantSettingsUncheckedCreateInput, 'tenantId'>), tenantId: id } });
      await this.audit(tx, actor, { action: 'TENANT_SETTINGS_UPDATED', tenantId: id, newValue: input, version: current.version });
      return settings;
    });
  }

  /** Legacy migration helper: creates an ACTIVE tenant with the legacy organization's id. */
  async createMigrated(input: CreateTenantInput & { id: string }, actor: Actor) {
    const existing = await this.prisma.tenant.findUnique({ where: { id: input.id } });
    if (existing) return { tenant: this.serialize(existing), created: false };
    const tenant = await this.create(input, 'LEGACY_MIGRATION', actor, { id: input.id, status: 'ACTIVE' });
    return { tenant, created: true };
  }
}

export function assertKnownTransition(command: string): asserts command is keyof typeof TRANSITIONS {
  if (!(command in TRANSITIONS)) throw new HttpError(404, 'NOT_FOUND', 'Unknown command');
}
