import { ShieldAlert } from 'lucide-react';
import { Badge, Checkbox, Skeleton } from '../../../components/ui';
import { humanize } from '../../../lib/utils';
import type { PermissionGroup } from '../types';

/**
 * Permission catalogue grouped by module with one checkbox per code. `held` marks codes the caller
 * holds: the API refuses to grant anything else (IAM_ESCALATION_DENIED), so those are disabled with
 * a hint rather than failing on save.
 */
export function PermissionMatrix({ groups, loading, value, onChange, readOnly, held }: { groups: PermissionGroup[]; loading?: boolean; value: Set<string>; onChange?: (next: Set<string>) => void; readOnly?: boolean; held?: Set<string> }) {
  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-5/6" />
          </div>
        ))}
      </div>
    );
  }
  const toggle = (code: string) => {
    if (!onChange || readOnly) return;
    const next = new Set(value);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange(next);
  };
  const toggleModule = (codes: string[], on: boolean) => {
    if (!onChange || readOnly) return;
    const next = new Set(value);
    codes.forEach((c) => (on ? next.add(c) : next.delete(c)));
    onChange(next);
  };
  return (
    <div className="divide-y divide-slate-100">
      {groups.map((g) => {
        const grantable = g.permissions.filter((p) => !held || held.has(p.code)).map((p) => p.code);
        const checked = g.permissions.filter((p) => value.has(p.code)).length;
        const allOn = grantable.length > 0 && grantable.every((c) => value.has(c));
        return (
          <section key={g.module} className="py-4 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between gap-3 mb-2">
              <h4 className="text-sm font-semibold text-slate-900">
                {humanize(g.module)} <span className="text-xs font-normal text-slate-400 tabular">{checked}/{g.permissions.length}</span>
              </h4>
              {!readOnly && onChange && grantable.length > 0 && (
                <button type="button" onClick={() => toggleModule(grantable, !allOn)} className="text-xs text-brand-700 hover:underline">
                  {allOn ? 'Clear module' : 'Select module'}
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
              {g.permissions.map((p) => {
                const notHeld = Boolean(held && !held.has(p.code));
                return (
                  <Checkbox
                    key={p.code}
                    checked={value.has(p.code)}
                    onChange={() => toggle(p.code)}
                    disabled={readOnly || notHeld}
                    label={
                      <span className="flex items-center gap-2 flex-wrap">
                        <code className="text-[12px] text-slate-700">{p.code}</code>
                        {p.sensitive && (
                          <Badge tone="amber">
                            <ShieldAlert className="w-3 h-3" /> Sensitive
                          </Badge>
                        )}
                        {notHeld && !readOnly && <span className="text-[11px] text-slate-400">not held by you</span>}
                      </span>
                    }
                    description={p.description}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
