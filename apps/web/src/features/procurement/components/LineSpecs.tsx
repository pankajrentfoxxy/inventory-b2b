import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { LaptopSpecsView, type LaptopSpecs } from '../../../components/LaptopSpecs';

/**
 * Read-only laptop specs for a document line: the one-line summary, with a toggle that expands the
 * full 8-spec grid. Renders nothing for legacy (non-laptop) items.
 */
export function LineSpecs({ specs, defaultOpen = false, className }: { specs: LaptopSpecs | null | undefined; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!specs) return null;
  return (
    <div className={className}>
      <div className="flex items-start gap-1 min-w-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          aria-expanded={open}
          aria-label={open ? 'Hide specifications' : 'Show all specifications'}
          title={open ? 'Hide specifications' : 'Show all specifications'}
          className="shrink-0 mt-px text-slate-400 hover:text-slate-700"
        >
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <LaptopSpecsView specs={specs} variant="inline" className="min-w-0" />
      </div>
      {open && <LaptopSpecsView specs={specs} variant="grid" className="mt-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3" />}
    </div>
  );
}
