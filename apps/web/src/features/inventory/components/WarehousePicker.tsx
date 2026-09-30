import { Select } from '../../../components/ui';
import { useScopedWarehouses } from '../hooks';

/**
 * Warehouse select limited to the member's warehouse scope (useAuth().warehouseIds). Pass
 * `allowAll` for list filters where an empty value means "every scoped warehouse".
 */
export function WarehousePicker({ id, value, onChange, allowAll, disabled, error, className, activeOnly = true }: { id?: string; value: string; onChange: (id: string) => void; allowAll?: boolean; disabled?: boolean; error?: boolean; className?: string; activeOnly?: boolean }) {
  const { warehouses, isLoading } = useScopedWarehouses({ activeOnly });
  const options = warehouses.map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` }));
  return <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} options={options} placeholder={isLoading ? 'Loading warehouses...' : allowAll ? 'All warehouses' : 'Select a warehouse'} disabled={disabled || isLoading} error={error} className={className} />;
}
