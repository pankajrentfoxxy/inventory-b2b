import { Badge, Checkbox, Skeleton } from '../../../components/ui';
import type { PlatformRole } from '../types';

/** Checkbox list keyed by role key (platform staff APIs take `roleKeys`, not ids). */
export function PlatformRoleCheckboxList({ roles, loading, value, onChange }: { roles: PlatformRole[]; loading?: boolean; value: string[]; onChange: (keys: string[]) => void }) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }
  if (roles.length === 0) return <p className="text-sm text-slate-500">No platform roles are seeded yet.</p>;
  const toggle = (k: string) => (value.includes(k) ? onChange(value.filter((v) => v !== k)) : onChange([...value, k]));
  return (
    <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
      {roles.map((r) => (
        <div key={r.key} className="px-3 py-2">
          <Checkbox
            label={
              <span className="flex items-center gap-2">
                {r.name}
                <Badge tone="gray">
                  <span className="font-mono">{r.key}</span>
                </Badge>
                <span className="text-xs text-slate-400 tabular">rank {r.rank}</span>
              </span>
            }
            description={r.description ?? `${r.permissionCodes.length} permissions`}
            checked={value.includes(r.key)}
            onChange={() => toggle(r.key)}
          />
        </div>
      ))}
    </div>
  );
}
