import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { notFound } from '../../lib/errors.js';
import type { RequestContext } from '../../middleware/auth.js';
import { findLiveVendorOrThrow } from './vendor.repository.js';
import { recordActivity } from './vendor.audit.js';

type Ctx = Pick<RequestContext, 'userId' | 'userName' | 'organizationId'>;

function safeName(name: string) {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'file';
}

export async function listDocuments(organizationId: string, vendorId: string) {
  await findLiveVendorOrThrow(prisma, organizationId, vendorId);
  const docs = await prisma.vendorDocument.findMany({ where: { vendorId, organizationId }, orderBy: { createdAt: 'desc' } });
  const userIds = [...new Set(docs.map((d) => d.uploadedById).filter((id): id is string => Boolean(id)))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  return docs.map((d) => ({
    id: d.id,
    fileName: d.fileName,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    uploadedByName: d.uploadedById ? (names.get(d.uploadedById) ?? null) : null,
    createdAt: d.createdAt,
  }));
}

export async function uploadDocument(ctx: Ctx, vendorId: string, file: Express.Multer.File) {
  await findLiveVendorOrThrow(prisma, ctx.organizationId, vendorId);
  const relDir = path.join(ctx.organizationId, vendorId);
  const storageKey = path.join(relDir, `${crypto.randomUUID()}-${safeName(file.originalname)}`);
  const absDir = path.join(env.uploadDir, relDir);
  await fs.mkdir(absDir, { recursive: true });
  await fs.writeFile(path.join(env.uploadDir, storageKey), file.buffer);

  try {
    return await prisma.$transaction(async (tx) => {
      const doc = await tx.vendorDocument.create({
        data: {
          vendorId,
          organizationId: ctx.organizationId,
          fileName: file.originalname.slice(0, 255),
          mimeType: file.mimetype,
          sizeBytes: file.size,
          storageKey,
          uploadedById: ctx.userId,
        },
      });
      await recordActivity(tx, ctx, vendorId, {
        action: 'DOCUMENT_UPLOADED',
        entityType: 'DOCUMENT',
        entityId: doc.id,
        summary: `Uploaded document ${doc.fileName}`,
        newValue: { fileName: doc.fileName, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes },
      });
      return { id: doc.id, fileName: doc.fileName, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes, uploadedByName: ctx.userName, createdAt: doc.createdAt };
    });
  } catch (err) {
    await fs.rm(path.join(env.uploadDir, storageKey), { force: true });
    throw err;
  }
}

export async function getDocumentFile(organizationId: string, vendorId: string, documentId: string) {
  const doc = await prisma.vendorDocument.findFirst({ where: { id: documentId, vendorId, organizationId } });
  if (!doc) throw notFound('Document not found');
  const absPath = path.join(env.uploadDir, doc.storageKey);
  // Belt and braces: storage keys are generated server-side, but never serve outside the upload root.
  if (!absPath.startsWith(env.uploadDir)) throw notFound('Document not found');
  return { doc, absPath };
}

export async function removeDocument(ctx: Ctx, vendorId: string, documentId: string) {
  const { doc, absPath } = await getDocumentFile(ctx.organizationId, vendorId, documentId);
  await prisma.$transaction(async (tx) => {
    await tx.vendorDocument.delete({ where: { id: doc.id } });
    await recordActivity(tx, ctx, vendorId, {
      action: 'DOCUMENT_REMOVED',
      entityType: 'DOCUMENT',
      entityId: doc.id,
      summary: `Removed document ${doc.fileName}`,
      oldValue: { fileName: doc.fileName, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes },
    });
  });
  await fs.rm(absPath, { force: true });
  return { id: doc.id, deleted: true };
}
