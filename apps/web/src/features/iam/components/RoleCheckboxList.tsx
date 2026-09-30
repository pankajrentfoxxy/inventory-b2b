import { Badge, Checkbox, Skeleton } from '../../../components/ui';
import type { Role } from '../types';

/** Checkbox list of roles shared by the invite and change-roles modals. */
export function RoleCheckboxList({ roles, loading, value, onChange, disabled }: { roles: Role[]; loading?: boolean; value: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }
  if (roles.length === 0) return <p className="text-sm text-slate-500">No roles available.</p>;
  const toggle = (id: string) => (value.includes(id) ? onChange(value.filter((v) => v !== id)) : onChange([...value, id]));
  return (
    <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
      {roles.map((r) => (
        <div key={r.id} className="px-3 py-2 flex items-start justify-between gap-3">
          <Checkbox
            label={
              <span className="flex items-center gap-2">
                {r.name}
                {r.isSystem && <Badge tone="blue">System</Badge>}
                <span className="text-xs text-slate-400 tabular">rank {r.rank}</span>
              </span>
            }
            description={r.description ?? undefined}
            checked={value.includes(r.id)}
            onChange={() => toggle(r.id)}
            disabled={disabled}
          />
        </div>
      ))}
    </div>
  );
}
