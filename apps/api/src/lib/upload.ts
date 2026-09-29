/**
 * Single multer configuration for every document upload. The allowed types and size come from
 * the shared upload rules so the browser file picker and the API agree; the API re-validates
 * the received file because the frontend filter is only a convenience.
 */
import type { Request } from 'express';
import multer from 'multer';
import { MESSAGES, UPLOAD_MAX_BYTES, validateUploadFile } from '@b2b/shared';
import { env } from '../config/env.js';
import { validationError } from './errors.js';

export const uploadMaxBytes = Math.min(env.MAX_UPLOAD_MB * 1024 * 1024, UPLOAD_MAX_BYTES);

/** Memory storage: nothing touches disk until the owning record has been verified. */
export const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: uploadMaxBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    const problem = validateUploadFile({ name: file.originalname, mimeType: file.mimetype }, uploadMaxBytes);
    if (problem) {
      cb(validationError([{ path: 'file', message: problem }]));
      return;
    }
    cb(null, true);
  },
});

/** Returns the uploaded file or throws a field-level validation error. Re-checks name, type and size. */
export function requireUploadedFile(req: Request): Express.Multer.File {
  const file = req.file;
  if (!file) throw validationError([{ path: 'file', message: MESSAGES.fileRequired }]);
  const problem = validateUploadFile({ name: file.originalname, mimeType: file.mimetype, size: file.size }, uploadMaxBytes);
  if (problem) throw validationError([{ path: 'file', message: problem }]);
  return file;
}
