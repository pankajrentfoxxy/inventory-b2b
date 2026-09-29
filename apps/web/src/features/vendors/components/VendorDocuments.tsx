import { useRef } from 'react';
import toast from 'react-hot-toast';
import { Download, FileText, Trash2, Upload } from 'lucide-react';
import { UPLOAD_ACCEPT, UPLOAD_ALLOWED_LABEL, UPLOAD_MAX_MB, validateUploadFile } from '@b2b/shared';
import { Button, EmptyState, ErrorState, IconButton, Skeleton } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { usePermission } from '../../../lib/auth';
import { formatBytes, formatDateTime } from '../../../lib/utils';
import { vendorApi } from '../api';
import { useVendorChildMutation, useVendorDocuments } from '../hooks';

export function VendorDocuments({ vendorId }: { vendorId: string }) {
  const docs = useVendorDocuments(vendorId);
  const { canEditVendor } = usePermission();
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useVendorChildMutation(vendorId, (file: File) => vendorApi.uploadDocument(vendorId, file));
  const remove = useVendorChildMutation(vendorId, (docId: string) => vendorApi.removeDocument(vendorId, docId));

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const problem = validateUploadFile({ name: file.name, size: file.size, mimeType: file.type });
    if (problem) {
      toast.error(`${file.name}: ${problem}`);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    try {
      await upload.mutateAsync(file);
      toast.success(`${file.name} uploaded`);
    } catch (err) {
      toast.error(toApiError(err).message);
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4">
      {canEditVendor && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-slate-500">{UPLOAD_ALLOWED_LABEL} up to {UPLOAD_MAX_MB} MB. GST certificate, MSME certificate, cancelled cheque, agreements.</p>
          <input ref={inputRef} type="file" className="hidden" accept={UPLOAD_ACCEPT} onChange={(e) => void onFile(e.target.files?.[0])} />
          <Button size="sm" variant="secondary" icon={Upload} loading={upload.isPending} onClick={() => inputRef.current?.click()}>
            Upload Document
          </Button>
        </div>
      )}
      {docs.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : docs.isError ? (
        <ErrorState message={toApiError(docs.error).message} onRetry={() => void docs.refetch()} />
      ) : docs.data!.length === 0 ? (
        <EmptyState icon={FileText} title="No documents" hint="Upload compliance documents to keep everything about this vendor in one place." className="py-8" />
      ) : (
        <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
          {docs.data!.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="w-9 h-9 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{d.fileName}</p>
                <p className="text-xs text-slate-500">
                  {formatBytes(d.sizeBytes)} &middot; {d.uploadedByName ?? 'Unknown'} &middot; {formatDateTime(d.createdAt)}
                </p>
              </div>
              <IconButton icon={Download} label="Download" size="sm" onClick={() => vendorApi.downloadDocument(vendorId, d).catch((err) => toast.error(toApiError(err).message))} />
              {canEditVendor && (
                <IconButton
                  icon={Trash2}
                  label="Delete document"
                  size="sm"
                  onClick={() => {
                    if (window.confirm(`Delete ${d.fileName}?`)) remove.mutateAsync(d.id).catch((err) => toast.error(toApiError(err).message));
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
