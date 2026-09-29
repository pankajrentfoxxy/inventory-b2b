import { useRef } from 'react';
import toast from 'react-hot-toast';
import { Download, FileText, Trash2, Upload, X } from 'lucide-react';
import { UPLOAD_ACCEPT, UPLOAD_ALLOWED_LABEL, UPLOAD_MAX_MB, validateUploadFile } from '@b2b/shared';
import { Button, ErrorState, IconButton, Skeleton } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { formatBytes, formatDateTime } from '../../../lib/utils';
import { poApi } from '../api';
import { usePoDocumentMutation, usePurchaseOrderDocuments } from '../hooks';

export const MAX_FILES = 10;
export const MAX_FILE_MB = UPLOAD_MAX_MB;
const ACCEPT = UPLOAD_ACCEPT;

/**
 * Attachments for a purchase order. Before the PO exists, files are held locally and uploaded
 * after the first save; once it exists they upload immediately.
 */
export function PoAttachments({ poId, pending, onPendingChange, canEdit }: { poId?: string; pending: File[]; onPendingChange: (files: File[]) => void; canEdit: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const docs = usePurchaseOrderDocuments(poId ?? '', Boolean(poId));
  const upload = usePoDocumentMutation(poId ?? '', (file: File) => poApi.uploadDocument(poId!, file));
  const remove = usePoDocumentMutation(poId ?? '', (docId: string) => poApi.removeDocument(poId!, docId));
  const existingCount = docs.data?.length ?? 0;

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const files = Array.from(list);
    // Same rules as the API (extension, MIME type, size); the server re-validates anyway.
    const ok: File[] = [];
    for (const f of files) {
      const problem = validateUploadFile({ name: f.name, size: f.size, mimeType: f.type });
      if (problem) toast.error(`${f.name}: ${problem}`);
      else ok.push(f);
    }
    if (ok.length === 0) {
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    if (existingCount + pending.length + ok.length > MAX_FILES) {
      toast.error(`You can attach at most ${MAX_FILES} files`);
      return;
    }
    if (poId) {
      for (const f of ok) {
        try {
          await upload.mutateAsync(f);
        } catch (err) {
          toast.error(`${f.name}: ${toApiError(err).message}`);
        }
      }
    } else {
      onPendingChange([...pending, ...ok]);
    }
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="space-y-3">
      {canEdit && (
        <div>
          <input ref={inputRef} type="file" multiple className="hidden" accept={ACCEPT} onChange={(e) => void addFiles(e.target.files)} />
          <Button variant="secondary" icon={Upload} loading={upload.isPending} onClick={() => inputRef.current?.click()}>
            Upload File
          </Button>
          <p className="text-xs text-slate-500 mt-1.5">You can upload a maximum of {MAX_FILES} files, {MAX_FILE_MB}MB each. {UPLOAD_ALLOWED_LABEL}.</p>
        </div>
      )}

      {pending.length > 0 && (
        <ul className="divide-y divide-slate-100 border border-dashed border-brand-200 rounded-lg bg-brand-50/30">
          {pending.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-3 px-3 py-2">
              <FileText className="w-4 h-4 text-brand-600 shrink-0" />
              <span className="flex-1 min-w-0 text-sm text-slate-800 truncate">{f.name}</span>
              <span className="text-xs text-slate-500">{formatBytes(f.size)}</span>
              <span className="text-[11px] text-brand-700">uploads on save</span>
              <IconButton icon={X} label="Remove" size="xs" onClick={() => onPendingChange(pending.filter((_, j) => j !== i))} />
            </li>
          ))}
        </ul>
      )}

      {poId &&
        (docs.isLoading ? (
          <Skeleton className="h-10" />
        ) : docs.isError ? (
          <ErrorState message={toApiError(docs.error).message} onRetry={() => void docs.refetch()} />
        ) : docs.data!.length === 0 && pending.length === 0 ? (
          <p className="text-sm text-slate-400">No files attached.</p>
        ) : (
          <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
            {docs.data!.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-3 py-2">
                <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{d.fileName}</p>
                  <p className="text-xs text-slate-500">
                    {formatBytes(d.sizeBytes)} &middot; {d.uploadedByName ?? 'Unknown'} &middot; {formatDateTime(d.createdAt)}
                  </p>
                </div>
                <IconButton icon={Download} label="Download" size="sm" onClick={() => poApi.downloadDocument(poId, d).catch((err) => toast.error(toApiError(err).message))} />
                {canEdit && (
                  <IconButton
                    icon={Trash2}
                    label="Remove file"
                    size="sm"
                    onClick={() => {
                      if (window.confirm(`Remove ${d.fileName}?`)) remove.mutateAsync(d.id).catch((err) => toast.error(toApiError(err).message));
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
