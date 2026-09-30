/**
 * The party form (vendors and customers): the legacy vendor form's fields and save logic on top of
 * svc-party. One payload creates or fully updates a party with its addresses, contact persons, bank
 * accounts and custom fields:
 *  - blank addresses are dropped; one primary address per type, one primary contact / bank account;
 *  - on update, child rows are matched by id (update), rows without id are added, missing rows are
 *    removed; a bank account keeps its stored (encrypted) number when no new number is sent;
 *  - legal name = company name, falling back to the display name;
 *  - vendor-only fields (vendor type, MSME, TDS) are stored for vendors and cleared for customers.
 * GST rules are the service's (GSTIN checksum, GSTIN state vs billing state, PAN inside GSTIN,
 * duplicate GSTIN per party type). Every save bumps the version, emits the snapshot event and an
 * audit row (bank numbers never appear in either).
 */
import { INDIAN_STATES, isBlankPartyAddress, type PartyFormPayload } from '@b2b/shared';
import { businessRuleError, conflict, notFound, uuidv7, type SecretBox } from '@b2b/platform-kit';
import type { Prisma, Tx } from '../db.js';
import type { Actor, PartyService, PartyType } from './party.service.js';

type Address = PartyFormPayload['addresses'][number];
type PartyRow = Prisma.PartyGetPayload<{ include: { addresses: true; contacts: true; bankAccounts: true } }>;
const include = { addresses: true, contacts: true, bankAccounts: true } as const;

const stateCodeFor = (a: Address): string | null => {
  if (a.stateCode && a.stateCode.length === 2) return a.stateCode;
  const byName = a.state ? INDIAN_STATES.find((s) => s.name.toLowerCase() === a.state!.toLowerCase()) : undefined;
  return byName?.code ?? null;
};
const contactName = (c: { firstName: string; lastName?: string | null }) => [c.firstName, c.lastName].filter(Boolean).join(' ');

/** Keeps non-blank addresses and makes exactly one primary per type (the first one if none is). */
function normaliseAddresses(addresses: Address[]): Address[] {
  const kept = addresses.filter((a) => !isBlankPartyAddress(a)).map((a) => ({ ...a }));
  for (const type of ['BILLING', 'SHIPPING'] as const) {
    const ofType = kept.filter((a) => a.type === type);
    if (ofType.length && !ofType.some((a) => a.isPrimary)) ofType[0].isPrimary = true;
    let seen = false;
    for (const a of ofType) {
      if (a.isPrimary && seen) a.isPrimary = false;
      if (a.isPrimary) seen = true;
    }
  }
  return kept;
}

function onePrimary<T extends { isPrimary: boolean }>(rows: T[]): T[] {
  const out = rows.map((r) => ({ ...r }));
  if (out.length && !out.some((r) => r.isPrimary)) out[0].isPrimary = true;
  return out;
}

export class PartyFormService {
  constructor(
    private readonly parties: PartyService,
    private readonly box: SecretBox,
  ) {}

  private partyColumns(partyType: PartyType, v: PartyFormPayload) {
    const vendor = partyType === 'SUPPLIER';
    return {
      salutation: v.salutation ?? null,
      firstName: v.firstName ?? null,
      lastName: v.lastName ?? null,
      legalName: v.companyName || v.displayName,
      displayName: v.displayName,
      email: v.email ?? null,
      workPhoneCountryCode: v.workPhoneCountryCode ?? null,
      phone: v.workPhone ?? null,
      mobileCountryCode: v.mobileCountryCode ?? null,
      mobile: v.mobile ?? null,
      language: v.language,
      website: v.website ?? null,
      gstTreatment: v.gstTreatment,
      sourceOfSupply: v.sourceOfSupply,
      gstin: v.gstin ?? null,
      pan: v.pan ?? (v.gstin ? v.gstin.slice(2, 12) : null),
      paymentTermId: v.paymentTermId ?? null,
      currencyCode: v.currencyCode,
      vendorType: vendor ? v.vendorType ?? null : null,
      msmeRegistered: vendor ? v.msmeRegistered : false,
      msmeNumber: vendor && v.msmeRegistered ? v.msmeNumber ?? null : null,
      tdsApplicable: vendor ? v.tdsApplicable : false,
      tdsSectionCode: vendor && v.tdsApplicable ? v.tdsSectionCode ?? null : null,
      tcsApplicable: v.tcsApplicable,
      openingBalance: v.openingBalance ?? null,
      remarks: v.remarks ?? null,
      customFields: Object.fromEntries(v.customFields.filter((c) => c.value !== null && c.value !== '').map((c) => [c.fieldId, c.value])) as Prisma.InputJsonValue,
    };
  }

  private addressColumns(a: Address) {
    return { kind: a.type, attention: a.attention ?? null, line1: a.addressLine1 ?? null, line2: a.addressLine2 ?? null, city: a.city ?? null, state: a.state ?? null, stateCode: stateCodeFor(a), pincode: a.postalCode ?? null, country: a.countryCode, phone: a.phone ?? null, fax: a.fax ?? null, isDefault: a.isPrimary };
  }

  private contactColumns(c: PartyFormPayload['contacts'][number]) {
    return { name: contactName(c), salutation: c.salutation ?? null, firstName: c.firstName, lastName: c.lastName ?? null, email: c.email ?? null, phone: c.workPhone ?? null, mobile: c.mobile ?? null, designation: c.designation ?? null, department: c.department ?? null, isPrimary: c.isPrimary };
  }

  private checkGst(v: PartyFormPayload, addresses: Address[]) {
    const billing = addresses.find((a) => a.type === 'BILLING' && a.isPrimary) ?? null;
    this.parties.validateGstPublic({ gstTreatment: v.gstTreatment, gstin: v.gstin ?? null, pan: v.pan ?? null }, billing ? { stateCode: stateCodeFor(billing) } : null);
  }

  private async checkDuplicateGstin(tx: Tx, tenantId: string, partyType: PartyType, gstin: string | null | undefined, exceptId?: string) {
    if (!gstin) return;
    const dup = await tx.party.findFirst({ where: { tenantId, partyType, gstin, ...(exceptId ? { id: { not: exceptId } } : {}) } });
    if (dup) throw businessRuleError('PARTY_DUPLICATE_GSTIN', `${dup.displayName} already uses GSTIN ${gstin}`, [{ path: 'gstin', message: 'Already registered' }]);
  }

  async create(tenantId: string, actor: Actor, partyType: PartyType, v: PartyFormPayload) {
    const addresses = normaliseAddresses(v.addresses);
    this.checkGst(v, addresses);
    const contacts = onePrimary(v.contacts);
    const banks = onePrimary(v.bankAccounts);
    return this.parties.tx(tenantId, async (tx) => {
      await this.checkDuplicateGstin(tx, tenantId, partyType, v.gstin);
      const code = await this.parties.uniqueCodePublic(tx, tenantId, partyType, null, v.displayName);
      const id = uuidv7();
      await tx.party.create({
        data: {
          id, tenantId, partyType, code, status: 'ACTIVE', ...this.partyColumns(partyType, v),
          addresses: { create: addresses.map((a) => ({ id: uuidv7(), tenantId, ...this.addressColumns(a) })) },
          contacts: { create: contacts.map((c) => ({ id: uuidv7(), tenantId, ...this.contactColumns(c) })) },
          bankAccounts: { create: banks.map((b) => ({ id: uuidv7(), tenantId, bankName: b.bankName, accountHolder: b.accountHolderName, accountNumberEnc: this.box.encrypt(b.accountNumber ?? ''), accountLast4: (b.accountNumber ?? '').slice(-4), ifsc: b.ifsc ?? '', branch: b.branch ?? null, accountType: b.accountType, isPrimary: b.isPrimary })) },
        },
      });
      const p = await this.parties.emitPublic(tx, tenantId, partyType, 'created', id, actor);
      await this.parties.auditPublic(tx, tenantId, actor, { action: `${partyType}_CREATED`, partyId: id, summary: `${p.code} ${p.displayName}`, newValue: { code: p.code, gstin: p.gstin, gstTreatment: p.gstTreatment }, version: 0 });
      return this.view(p);
    });
  }

  async update(tenantId: string, actor: Actor, partyType: PartyType, id: string, v: PartyFormPayload, expectedVersion: number | null) {
    const addresses = normaliseAddresses(v.addresses);
    this.checkGst(v, addresses);
    const contacts = onePrimary(v.contacts);
    const banks = onePrimary(v.bankAccounts);
    return this.parties.tx(tenantId, async (tx) => {
      const current = await tx.party.findFirst({ where: { id, tenantId, partyType }, include });
      if (!current) throw notFound(`${partyType === 'SUPPLIER' ? 'Vendor' : 'Customer'} not found`);
      if (expectedVersion !== null && expectedVersion !== current.version) throw conflict('The record was modified by someone else', 'VERSION_CONFLICT');
      await this.checkDuplicateGstin(tx, tenantId, partyType, v.gstin, id);

      const unknownChild = (rows: { id?: string | null }[], existing: { id: string }[], path: string) => {
        const idx = rows.findIndex((r) => r.id && !existing.some((e) => e.id === r.id));
        if (idx >= 0) throw businessRuleError('VALIDATION_FAILED', 'A row no longer exists; reload the page', [{ path: `${path}.${idx}.id`, message: 'Unknown row' }]);
      };
      unknownChild(addresses, current.addresses, 'addresses');
      unknownChild(contacts, current.contacts, 'contacts');
      unknownChild(banks, current.bankAccounts, 'bankAccounts');
      const newBankWithoutNumber = banks.findIndex((b) => !b.id && !b.accountNumber);
      if (newBankWithoutNumber >= 0) throw businessRuleError('VALIDATION_FAILED', 'Account number is required', [{ path: `bankAccounts.${newBankWithoutNumber}.accountNumber`, message: 'Account number is required' }]);

      // Children: delete removed rows and clear primary flags first so the partial unique indexes
      // (one default address per kind, one primary contact) never see two at once.
      const keep = (rows: { id?: string | null }[]) => rows.map((r) => r.id).filter((x): x is string => Boolean(x));
      await tx.partyAddress.deleteMany({ where: { partyId: id, id: { notIn: keep(addresses) } } });
      await tx.partyContact.deleteMany({ where: { partyId: id, id: { notIn: keep(contacts) } } });
      await tx.partyBankAccount.deleteMany({ where: { partyId: id, id: { notIn: keep(banks) } } });
      await tx.partyAddress.updateMany({ where: { partyId: id }, data: { isDefault: false } });
      await tx.partyContact.updateMany({ where: { partyId: id }, data: { isPrimary: false } });
      await tx.partyBankAccount.updateMany({ where: { partyId: id }, data: { isPrimary: false } });
      for (const a of addresses) {
        if (a.id) await tx.partyAddress.update({ where: { id: a.id }, data: this.addressColumns(a) });
        else await tx.partyAddress.create({ data: { id: uuidv7(), tenantId, partyId: id, ...this.addressColumns(a) } });
      }
      for (const c of contacts) {
        if (c.id) await tx.partyContact.update({ where: { id: c.id }, data: this.contactColumns(c) });
        else await tx.partyContact.create({ data: { id: uuidv7(), tenantId, partyId: id, ...this.contactColumns(c) } });
      }
      for (const b of banks) {
        const base = { bankName: b.bankName, accountHolder: b.accountHolderName, ifsc: b.ifsc ?? '', branch: b.branch ?? null, accountType: b.accountType, isPrimary: b.isPrimary };
        const number = b.accountNumber ? { accountNumberEnc: this.box.encrypt(b.accountNumber), accountLast4: b.accountNumber.slice(-4) } : {};
        if (b.id) await tx.partyBankAccount.update({ where: { id: b.id }, data: { ...base, ...number } });
        else await tx.partyBankAccount.create({ data: { id: uuidv7(), tenantId, partyId: id, ...base, accountNumberEnc: this.box.encrypt(b.accountNumber!), accountLast4: b.accountNumber!.slice(-4) } });
      }

      const columns = this.partyColumns(partyType, v);
      const done = await tx.party.updateMany({ where: { id, version: current.version }, data: { ...columns, version: current.version + 1 } });
      if (done.count !== 1) throw conflict('The record was modified by someone else', 'VERSION_CONFLICT');
      const p = await this.parties.emitPublic(tx, tenantId, partyType, 'updated', id, actor);
      const changed = (Object.keys(columns) as (keyof typeof columns)[]).filter((k) => JSON.stringify((current as unknown as Record<string, unknown>)[k] ?? null) !== JSON.stringify(columns[k] ?? null) && k !== 'openingBalance');
      await this.parties.auditPublic(tx, tenantId, actor, { action: `${partyType}_UPDATED`, partyId: id, summary: `Updated ${[...changed, 'addresses', 'contacts', 'bank accounts'].slice(0, 8).join(', ')}`, newValue: { fields: changed, addresses: addresses.length, contacts: contacts.length, bankAccounts: banks.length }, version: p.version });
      return this.view(p);
    });
  }

  async get(tenantId: string, partyType: PartyType, id: string) {
    const p = await this.parties.tx(tenantId, (tx) => tx.party.findFirst({ where: { id, tenantId, partyType }, include }));
    if (!p) throw notFound(`${partyType === 'SUPPLIER' ? 'Vendor' : 'Customer'} not found`);
    const refs = await this.parties.tx(tenantId, (tx) => tx.entityReference.findMany({ where: { tenantId, entityType: partyType, entityId: id } }));
    return { ...this.view(p), referencedBy: refs.map((r) => r.referencedBy) };
  }

  /** The legacy vendor detail shape (field names of the vendor form) plus platform fields. */
  view(p: PartyRow) {
    const cf = (p.customFields ?? {}) as Record<string, unknown>;
    return {
      id: p.id, partyType: p.partyType, code: p.code, status: p.status, blockedReason: p.blockedReason, version: p.version, createdAt: p.createdAt, updatedAt: p.updatedAt,
      salutation: p.salutation, firstName: p.firstName, lastName: p.lastName, companyName: p.legalName, displayName: p.displayName, email: p.email,
      workPhoneCountryCode: p.workPhoneCountryCode, workPhone: p.phone, mobileCountryCode: p.mobileCountryCode, mobile: p.mobile, language: p.language, website: p.website,
      gstTreatment: p.gstTreatment, sourceOfSupply: p.sourceOfSupply ?? (p.gstin ? p.gstin.slice(0, 2) : null), gstin: p.gstin, pan: p.pan, paymentTermId: p.paymentTermId, currencyCode: p.currencyCode,
      vendorType: p.vendorType, msmeRegistered: p.msmeRegistered, msmeNumber: p.msmeNumber, tdsApplicable: p.tdsApplicable, tdsSectionCode: p.tdsSectionCode, tcsApplicable: p.tcsApplicable,
      openingBalance: p.openingBalance === null ? null : Number(p.openingBalance), remarks: p.remarks,
      addresses: p.addresses.map((a) => ({ id: a.id, type: a.kind, attention: a.attention, countryCode: a.country, addressLine1: a.line1, addressLine2: a.line2, city: a.city, state: a.state, stateCode: a.stateCode, postalCode: a.pincode, phone: a.phone, fax: a.fax, isPrimary: a.isDefault })),
      contacts: p.contacts.map((c) => ({ id: c.id, salutation: c.salutation, firstName: c.firstName ?? c.name, lastName: c.lastName, email: c.email, workPhone: c.phone, mobile: c.mobile, designation: c.designation, department: c.department, isPrimary: c.isPrimary })),
      bankAccounts: p.bankAccounts.map((b) => ({ id: b.id, bankName: b.bankName, accountHolderName: b.accountHolder, accountNumberMasked: `XXXX${b.accountLast4}`, ifsc: b.ifsc, branch: b.branch, accountType: b.accountType, isPrimary: b.isPrimary })),
      customFields: Object.entries(cf).map(([fieldId, value]) => ({ fieldId, value })),
    };
  }
}
