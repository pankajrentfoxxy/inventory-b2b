import { useState } from 'react';
import toast from 'react-hot-toast';
import { StickyNote, Trash2 } from 'lucide-react';
import { Button, EmptyState, ErrorState, IconButton, Skeleton, Textarea } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { usePermission } from '../../../lib/auth';
import { formatDateTime } from '../../../lib/utils';
import { vendorApi } from '../api';
import { useVendorChildMutation, useVendorNotes } from '../hooks';

export function VendorNotes({ vendorId }: { vendorId: string }) {
  const notes = useVendorNotes(vendorId);
  const { canEditVendor } = usePermission();
  const [body, setBody] = useState('');
  const add = useVendorChildMutation(vendorId, (text: string) => vendorApi.addNote(vendorId, text));
  const remove = useVendorChildMutation(vendorId, (noteId: string) => vendorApi.removeNote(vendorId, noteId));

  const submit = async () => {
    if (!body.trim()) return;
    try {
      await add.mutateAsync(body.trim());
      setBody('');
      toast.success('Note added');
    } catch (err) {
      toast.error(toApiError(err).message);
    }
  };

  return (
    <div className="space-y-4">
      {canEditVendor && (
        <div className="space-y-2">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={5000} placeholder="Add an internal note about this vendor" />
          <div className="flex justify-end">
            <Button size="sm" onClick={() => void submit()} loading={add.isPending} disabled={!body.trim()}>
              Add Note
            </Button>
          </div>
        </div>
      )}
      {notes.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : notes.isError ? (
        <ErrorState message={toApiError(notes.error).message} onRetry={() => void notes.refetch()} />
      ) : notes.data!.length === 0 ? (
        <EmptyState icon={StickyNote} title="No notes yet" hint="Notes are internal and never shared with the vendor." className="py-8" />
      ) : (
        <ul className="divide-y divide-slate-100">
          {notes.data!.map((n) => (
            <li key={n.id} className="py-3 flex gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{n.body}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {n.createdByName ?? 'Unknown'} on {formatDateTime(n.createdAt)}
                </p>
              </div>
              {canEditVendor && (
                <IconButton
                  icon={Trash2}
                  label="Delete note"
                  size="sm"
                  onClick={() => {
                    if (window.confirm('Delete this note?')) remove.mutateAsync(n.id).catch((err) => toast.error(toApiError(err).message));
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
