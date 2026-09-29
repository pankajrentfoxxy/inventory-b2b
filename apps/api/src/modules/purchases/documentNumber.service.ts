/**
 * Per-organization document numbering (PO-00001, GRN-00001). The sequence row is locked
 * FOR UPDATE inside the caller's transaction so concurrent creates never share a number.
 */
import type { DocumentType } from '@prisma/client';
import { DEFAULT_DOCUMENT_SEQUENCES, formatDocumentNumber, type DocumentSequencePayload } from '@b2b/shared';
import { prisma, type PrismaTx } from '../../lib/prisma.js';
import { conflict, notFound } from '../../lib/errors.js';

type Db = PrismaTx | typeof prisma;

function defaultsFor(docType: DocumentType) {
  return DEFAULT_DOCUMENT_SEQUENCES.find((d) => d.docType === docType) ?? { docType, prefix: '', padding: 5 };
}

export async function ensureSequence(db: Db, organizationId: string, docType: DocumentType) {
  const d = defaultsFor(docType);
  return db.documentSequence.upsert({
    where: { organizationId_docType: { organizationId, docType } },
    update: {},
    create: { organizationId, docType, prefix: d.prefix, padding: d.padding, nextNumber: 1 },
  });
}

export async function getSequence(organizationId: string, docType: DocumentType) {
  const seq = await ensureSequence(prisma, organizationId, docType);
  return { docType, prefix: seq.prefix, nextNumber: seq.nextNumber, padding: seq.padding, preview: formatDocumentNumber(seq.prefix, seq.nextNumber, seq.padding) };
}

export async function updateSequence(organizationId: string, docType: DocumentType, input: DocumentSequencePayload) {
  await ensureSequence(prisma, organizationId, docType);
  const seq = await prisma.documentSequence.update({
    where: { organizationId_docType: { organizationId, docType } },
    data: { prefix: input.prefix, nextNumber: input.nextNumber, padding: input.padding },
  });
  return { docType, prefix: seq.prefix, nextNumber: seq.nextNumber, padding: seq.padding, preview: formatDocumentNumber(seq.prefix, seq.nextNumber, seq.padding) };
}

/** True when a live document already uses this number (case-insensitive). */
async function numberInUse(tx: PrismaTx, organizationId: string, docType: DocumentType, number: string, excludeId?: string) {
  if (docType === 'PURCHASE_ORDER') {
    const hit = await tx.purchaseOrder.findFirst({
      where: { organizationId, deletedAt: null, purchaseOrderNumber: { equals: number, mode: 'insensitive' }, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    return Boolean(hit);
  }
  const hit = await tx.purchaseReceive.findFirst({
    where: { organizationId, receiveNumber: { equals: number, mode: 'insensitive' }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  return Boolean(hit);
}

/** Allocates the next free number, skipping any that were typed in manually. Must run inside a transaction. */
export async function allocateDocumentNumber(tx: PrismaTx, organizationId: string, docType: DocumentType): Promise<string> {
  await ensureSequence(tx, organizationId, docType);
  const rows = await tx.$queryRaw<{ id: string; prefix: string; next_number: number; padding: number }[]>`
    SELECT "id", "prefix", "next_number", "padding" FROM "document_sequences"
    WHERE "organization_id" = ${organizationId}::uuid AND "doc_type" = ${docType}::"DocumentType"
    FOR UPDATE`;
  const seq = rows[0];
  if (!seq) throw notFound('Document sequence not found');

  let n = seq.next_number;
  let number = formatDocumentNumber(seq.prefix, n, seq.padding);
  let guard = 0;
  while (await numberInUse(tx, organizationId, docType, number)) {
    n += 1;
    number = formatDocumentNumber(seq.prefix, n, seq.padding);
    guard += 1;
    if (guard > 1000) throw conflict('Could not allocate a free document number; adjust the sequence in Settings', 'SEQUENCE_EXHAUSTED');
  }
  await tx.documentSequence.update({ where: { id: seq.id }, data: { nextNumber: n + 1 } });
  return number;
}

/** Validates a manually typed number and, when it matches the sequence pattern, moves the sequence past it. */
export async function claimManualDocumentNumber(tx: PrismaTx, organizationId: string, docType: DocumentType, number: string, excludeId?: string) {
  if (await numberInUse(tx, organizationId, docType, number, excludeId)) {
    const label = docType === 'PURCHASE_ORDER' ? 'purchase order' : 'purchase receive';
    throw conflict(`${number} is already used by another ${label}`, 'DUPLICATE_DOCUMENT_NUMBER', [
      { path: docType === 'PURCHASE_ORDER' ? 'purchaseOrderNumber' : 'receiveNumber', message: 'This number is already in use' },
    ]);
  }
  const seq = await ensureSequence(tx, organizationId, docType);
  if (seq.prefix && number.toUpperCase().startsWith(seq.prefix.toUpperCase())) {
    const tail = number.slice(seq.prefix.length);
    if (/^\d+$/.test(tail) && Number(tail) >= seq.nextNumber) {
      await tx.documentSequence.update({ where: { id: seq.id }, data: { nextNumber: Number(tail) + 1 } });
    }
  }
  return number;
}
