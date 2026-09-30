import { useRef } from 'react';
import toast from 'react-hot-toast';
import { FileText, Paperclip, Upload } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Skeleton } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatBytes, formatDateTime } from '../../../lib/utils';
import { useAttachments, useUploadAttachment } from '../hooks';
import type { AttachmentEntity } from '../types';

/**
 * Attachment list + presign upload. When the presign returns a real URL the file is PUT there;
 * with the local storage source (uploadUrl "local://...") only the metadata is recorded.
 */
export function AttachmentsCard({ entityType, entityId, uploadPermission }: { entityType: AttachmentEntity; entityId: string; uploadPermission: string | readonly string[] }) {
  const { hasPermission } = useAuth();
  const canUpload = hasPermission(uploadPermission);
  const list = useAttachments(entityType, entityId);
  const upload = useUploadAttachment();
  const fileInput = useRef<HTMLInputElement>(null);

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      try {
        const result = await upload.mutateAsync({ entityType, entityId, file });
        toast.success(result.uploaded ? `${file.name} uploaded` : `${file.name} recorded (stored locally, no remote upload configured)`);
      } catch (err) {
        toast.error(toApiError(err).message);
      }
    }
    if (fileInput.current) fileInput.current.value = '';
  };

  return (
    <Card>
      <CardHeader
        title="Attachments"
        description="Vendor invoices, delivery notes, photos (max 25 MB each)."
        actions={
          canUpload ? (
            <>
              <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => void onPick(e.target.files)} aria-label="Choose files" />
              <Button size="sm" variant="secondary" icon={Upload} loading={upload.isPending} onClick={() => fileInput.current?.click()}>
                Upload
              </Button>
            </>
          ) : undefined
        }
      />
      <CardBody className="p-0">
        {list.isLoading ? (
          <div className="p-5 space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState message={toApiError(list.error).message} onRetry={() => void list.refetch()} />
        ) : (list.data ?? []).length === 0 ? (
          <EmptyState icon={Paperclip} title="No attachments" hint={canUpload ? 'Upload the vendor invoice or delivery note.' : undefined} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.data!.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-900 truncate">{a.fileName}</p>
                  <p className="text-xs text-slate-500">
                    {a.contentType} - {formatBytes(a.sizeBytes)} - {formatDateTime(a.uploadedAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
