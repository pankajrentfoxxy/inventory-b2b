import { PageHeader } from '../../../components/ui';
import { SPEC_ID_FIELDS } from '../types';
import { LaptopSpecCard } from '../components/LaptopSpecCard';

/** The eight laptop specification masters a configuration is built from. */
export function LaptopSpecsPage() {
  return (
    <>
      <PageHeader
        title="Laptop specifications"
        subtitle="Brand, model, generation, processor, RAM, SSD, graphics and screen size. A laptop configuration picks one value of each; the codes build its SKU."
        breadcrumbs={[{ label: 'Masters' }, { label: 'Laptop specifications' }]}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
        {SPEC_ID_FIELDS.map((f) => (
          <LaptopSpecCard key={f.kind} kind={f.kind} label={f.label} />
        ))}
      </div>
    </>
  );
}
