import { Select } from '../../../components/ui';
import { binsOf, useWarehouses } from '../hooks';

/** Bins of the chosen warehouse (location / bin). Empty value = unbinned. */
export function BinSelect({ id, warehouseId, value, onChange, disabled, error, placeholder = 'Unbinned', className }: { id?: string; warehouseId: string; value: string; onChange: (binId: string) => void; disabled?: boolean; error?: boolean; placeholder?: string; className?: string }) {
  const warehouses = useWarehouses();
  const options = binsOf(warehouses.data?.find((w) => w.id === warehouseId));
  return <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} options={options} placeholder={placeholder} disabled={disabled || !warehouseId || options.length === 0} error={error} className={className} />;
}
