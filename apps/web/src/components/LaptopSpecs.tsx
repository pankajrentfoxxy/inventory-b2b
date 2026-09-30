import { LAPTOP_SPEC_FIELDS, type LaptopSpecs } from '@b2b/contracts';
import { DescriptionList } from './ui';
import { cn } from '../lib/utils';

export type { LaptopSpecs };
export { LAPTOP_SPEC_FIELDS };

/** Reads `specs` off any item snapshot (PO / GRN line item, QC lot item, stock row); null when absent. */
export function specsOf(item: unknown): LaptopSpecs | null {
  const specs = (item as { specs?: LaptopSpecs | null } | null | undefined)?.specs;
  return specs && typeof specs === 'object' ? specs : null;
}

/** One-line summary: "13th Gen - Intel Core i5-1345U - 16 GB - 512 GB - Intel Iris Xe - 14"". */
export function specsSummary(specs: LaptopSpecs | null | undefined): string {
  if (!specs) return '';
  return [specs.generation, specs.processor, specs.ram, specs.ssd, specs.gpu, specs.screenSize].filter(Boolean).join(' - ');
}

/**
 * The eight laptop specifications of a configuration, read-only. Use everywhere a laptop is shown
 * (masters, PO, GRN, QC, inventory) so the specs always look the same.
 *  - grid:    labelled 2/4-column grid (detail pages, QC expected specs)
 *  - inline:  a single muted line under an item name (tables, pickers)
 */
export function LaptopSpecsView({ specs, variant = 'grid', className }: { specs: LaptopSpecs | null | undefined; variant?: 'grid' | 'inline'; className?: string }) {
  if (!specs) return null;
  if (variant === 'inline') {
    return <span className={cn('block text-xs text-slate-500 truncate', className)} title={specsSummary(specs)}>{specsSummary(specs)}</span>;
  }
  return (
    <div className={className}>
      <DescriptionList columns={3} items={LAPTOP_SPEC_FIELDS.map((f) => ({ label: f.label, value: specs[f.key] }))} />
    </div>
  );
}
