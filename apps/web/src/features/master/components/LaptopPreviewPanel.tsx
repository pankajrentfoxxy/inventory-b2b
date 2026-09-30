import { Link } from 'react-router-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { StatusBadge } from '../../../components/ui';
import type { useSpecPreview } from './LaptopSpecSelects';

type Preview = ReturnType<typeof useSpecPreview>;

/** True when the previewed configuration already exists as another product. */
export function isDuplicate(preview: Preview, selfId?: string): boolean {
  const dup = preview.data?.duplicateOf;
  return Boolean(dup && dup.id !== selfId);
}

/** Generated SKU / name for the selected specs and the "already exists" banner. */
export function LaptopPreviewPanel({ preview, selfId, showSku = true }: { preview: Preview; selfId?: string; showSku?: boolean }) {
  if (!preview.allChosen) {
    return <p className="text-sm text-slate-500">Pick all eight specifications to see the generated SKU and check for duplicates.</p>;
  }
  if (preview.loading && !preview.data) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Checking the configuration...
      </p>
    );
  }
  if (preview.error) {
    const fieldLevel = preview.error.details.some((d) => d.path);
    return (
      <p className="text-sm text-red-600">
        {fieldLevel ? 'Fix the highlighted specifications.' : preview.error.message}{' '}
        {!fieldLevel && (
          <button type="button" className="underline" onClick={preview.refetch}>
            Retry
          </button>
        )}
      </p>
    );
  }
  const data = preview.data;
  if (!data) return null;
  const dup = data.duplicateOf && data.duplicateOf.id !== selfId ? data.duplicateOf : null;
  return (
    <div className="space-y-3">
      {dup && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="alert">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            This configuration already exists as{' '}
            <Link to={`/masters/products/${dup.id}`} className="font-mono font-semibold underline">
              {dup.sku}
            </Link>{' '}
            ({dup.name}) <StatusBadge status={dup.status} />
          </span>
        </div>
      )}
      {!dup && (
        <dl className="grid grid-cols-1 gap-2 text-sm">
          {showSku && (
            <div>
              <dt className="text-xs text-slate-500">Generated SKU</dt>
              <dd className="font-mono text-[13px] text-slate-900">{data.sku}</dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-slate-500">Name</dt>
            <dd className="text-slate-900">{data.name}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
