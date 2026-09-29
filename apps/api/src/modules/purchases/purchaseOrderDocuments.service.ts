import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { conflict, notFound } from '../../lib/errors.js';
import type { RequestContext } from '../../middleware/auth.js';
import { findLivePoOrThrow } from './purchaseOrder.repository.js';
import { recordPoActivity } from './purchaseOrder.audit.js';

type Ctx = Pick<RequestContext, 'userId' | 'userName' | 'organizationId'>;
export const MAX_PO_DOCUMENTS = 10;

function safeName(name: string) {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'file';
}

export async function listDocuments(organizationId: string, purchaseOrderId: string) {
  await findLivePoOrThrow(prisma, organizationId, purchaseOrderId);
  const docs = await prisma.purchaseOrderDocument.findMany({ where: { purchaseOrderId, organizationId }, orderBy: { createdAt: 'desc' } });
  const userIds = [...new Set(docs.map((d) => d.uploadedById).filter((id): id is string => Boolean(id)))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  return docs.map((d) => ({ id: d.id, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, uploadedByName: d.uploadedById ? (names.get(d.uploadedById) ?? null) : null, createdAt: d.createdAt }));
}

export async function uploadDocument(ctx: Ctx, purchaseOrderId: string, file: Express.Multer.File) {
  await findLivePoOrThrow(prisma, ctx.organizationId, purchaseOrderId);
  const count = await prisma.purchaseOrderDocument.count({ where: { purchaseOrderId } });
  if (count >= MAX_PO_DOCUMENTS) throw conflict(`A purchase order can hold at most ${MAX_PO_DOCUMENTS} files`, 'DOCUMENT_LIMIT');

  const relDir = path.join(ctx.organizationId, 'purchase-orders', purchaseOrderId);
  const storageKey = path.join(relDir, `${crypto.randomUUID()}-${safeName(file.originalname)}`);
  await fs.mkdir(path.join(env.uploadDir, relDir), { recursive: true });
  await fs.writeFile(path.join(env.uploadDir, storageKey), file.buffer);
  try {
    return await prisma.$transaction(async (tx) => {
      const doc = await tx.purchaseOrderDocument.create({
        data: { purchaseOrderId, organizationId: ctx.organizationId, fileName: file.originalname.slice(0, 255), mimeType: file.mimetype, sizeBytes: file.size, storageKey, uploadedById: ctx.userId },
      });
      await recordPoActivity(tx, ctx, purchaseOrderId, { action: 'DOCUMENT_UPLOADED', entityType: 'DOCUMENT', entityId: doc.id, summary: `Attached ${doc.fileName}`, newValue: { fileName: doc.fileName, sizeBytes: doc.sizeBytes } });
      return { id: doc.id, fileName: doc.fileName, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes, uploadedByName: ctx.userName, createdAt: doc.createdAt };
    });
  } catch (err) {
    await fs.rm(path.join(env.uploadDir, storageKey), { force: true });
    throw err;
  }
}

export async function getDocumentFile(organizationId: string, purchaseOrderId: string, documentId: string) {
  const doc = await prisma.purchaseOrderDocument.findFirst({ where: { id: documentId, purchaseOrderId, organizationId } });
  if (!doc) throw notFound('Document not found');
  const absPath = path.join(env.uploadDir, doc.storageKey);
  if (!absPath.startsWith(env.uploadDir)) throw notFound('Document not found');
  return { doc, absPath };
}

export async function removeDocument(ctx: Ctx, purchaseOrderId: string, documentId: string) {
  const { doc, absPath } = await getDocumentFile(ctx.organizationId, purchaseOrderId, documentId);
  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrderDocument.delete({ where: { id: doc.id } });
    await recordPoActivity(tx, ctx, purchaseOrderId, { action: 'DOCUMENT_REMOVED', entityType: 'DOCUMENT', entityId: doc.id, summary: `Removed ${doc.fileName}`, oldValue: { fileName: doc.fileName } });
  });
  await fs.rm(absPath, { force: true });
  return { id: doc.id, deleted: true };
}
