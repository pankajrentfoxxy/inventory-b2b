/**
 * Upload rules shared by the web file pickers and the API multer filter. The backend re-checks
 * name, extension, MIME type and size even though the browser already filtered.
 */
import { MESSAGES } from './messages.js';

export const UPLOAD_MAX_MB = 10;
export const UPLOAD_MAX_BYTES = UPLOAD_MAX_MB * 1024 * 1024;
export const UPLOAD_MAX_NAME_LENGTH = 255;

export const UPLOAD_ALLOWED_TYPES: Record<string, string[]> = {
  '.pdf': ['application/pdf'],
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.webp': ['image/webp'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xls': ['application/vnd.ms-excel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.csv': ['text/csv', 'application/vnd.ms-excel', 'text/plain'],
  '.txt': ['text/plain'],
};

export const UPLOAD_ALLOWED_EXTENSIONS = Object.keys(UPLOAD_ALLOWED_TYPES);
export const UPLOAD_ALLOWED_MIME_TYPES = Array.from(new Set(Object.values(UPLOAD_ALLOWED_TYPES).flat()));
/** Value for <input type="file" accept="...">. */
export const UPLOAD_ACCEPT = UPLOAD_ALLOWED_EXTENSIONS.join(',');
export const UPLOAD_ALLOWED_LABEL = 'PDF, PNG, JPG, WEBP, Word, Excel, CSV or TXT';

export interface UploadCandidate {
  name: string;
  /** Bytes. Omit when unknown (multer fileFilter runs before the stream is read). */
  size?: number;
  mimeType?: string;
}

export function fileExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx).toLowerCase() : '';
}

/** Returns an error message or null. Checks extension, MIME type (when provided) and size. */
export function validateUploadFile(file: UploadCandidate, maxBytes = UPLOAD_MAX_BYTES): string | null {
  if (!file.name || file.name.trim() === '') return MESSAGES.fileRequired;
  if (file.name.length > UPLOAD_MAX_NAME_LENGTH) return MESSAGES.fileNameTooLong;
  const ext = fileExtension(file.name);
  const allowedMimes = UPLOAD_ALLOWED_TYPES[ext];
  if (!allowedMimes) return MESSAGES.fileType(UPLOAD_ALLOWED_LABEL);
  // Browsers sometimes send an empty or generic type; only reject a MIME that positively mismatches.
  if (file.mimeType && file.mimeType !== 'application/octet-stream' && !allowedMimes.includes(file.mimeType)) {
    return MESSAGES.fileType(UPLOAD_ALLOWED_LABEL);
  }
  if (file.size !== undefined && file.size > maxBytes) return MESSAGES.fileSize(Math.round(maxBytes / (1024 * 1024)));
  if (file.size !== undefined && file.size <= 0) return MESSAGES.fileRequired;
  return null;
}
