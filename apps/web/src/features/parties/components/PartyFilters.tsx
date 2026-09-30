import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronDown, MoreHorizontal, Plus, RefreshCw, Settings2, SlidersHorizontal, X } from 'lucide-react';
import { Button, Dropdown, IconButton, Select, type MenuItem } from '../../../components/ui';
import { useAuth } from '../../../lib/auth';
import { cn } from '../../../lib/utils';
import { GST_TREATMENT_LABELS, GST_TREATMENTS, PARTY_META, type PartyType } from '../types';

export interface PartyFilterState {
  q: string;
  status: string;
  gstTreatment: string;
}

/**
 * Zoho-style list toolbar: view switcher on the left, actions on the right, filters below.
 * The platform list is cursor-paged without server sort or counts, so the legacy sort menu and
 * per-view counts are not offered.
 */
export function PartyToolbar({ type, filters, onChange, onReset, onRefresh, refreshing }: { type: PartyType; filters: PartyFilterState; onChange: (patch: Partial<PartyFilterState>) => void; onReset: () => void; onRefresh: () => void; refreshing?: boolean }) {
  const meta = PARTY_META[type];
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const views = [
    { value: '', label: `All ${meta.plural}` },
    { value: 'ACTIVE', label: `Active ${meta.plural}` },
    { value: 'INACTIVE', label: `Inactive ${meta.plural}` },
    { value: 'BLOCKED', label: `Blocked ${meta.plural}` },
  ];
  const advancedCount = [filters.gstTreatment].filter(Boolean).length;
  const [advancedOpen, setAdvancedOpen] = useState(advancedCount > 0);
  const view = views.find((v) => v.value === (filters.status || '')) ?? views[0];
  const anyFilter = Boolean(filters.q || filters.status || advancedCount);

  const moreItems: MenuItem[] = [
    { key: 'refresh', label: 'Refresh List', icon: RefreshCw, onSelect: onRefresh },
    { key: 'settings', label: `${meta.singular} Custom Fields`, icon: Settings2, onSelect: () => navigate('/masters/other'), hidden: !hasPermission('master.manage') },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Dropdown
          align="left"
          trigger={({ toggle }) => (
            <button type="button" onClick={toggle} className="inline-flex items-center gap-1.5 text-xl font-semibold text-slate-900 hover:text-brand-700">
              {view.label}
              <ChevronDown className="w-5 h-5 text-brand-600" />
            </button>
          )}
          items={views.map((v) => ({
            key: v.value || 'all',
            label: (
              <span className="flex items-center justify-between w-full gap-4">
                <span>{v.label}</span>
                {v.value === (filters.status || '') && <Check className="w-4 h-4 text-brand-600" />}
              </span>
            ),
            onSelect: () => onChange({ status: v.value }),
          }))}
        />

        <div className="flex items-center gap-2">
          <Button variant={advancedOpen || advancedCount ? 'subtle' : 'secondary'} size="md" icon={SlidersHorizontal} onClick={() => setAdvancedOpen((o) => !o)}>
            Filters{advancedCount ? ` (${advancedCount})` : ''}
          </Button>
          {hasPermission(meta.manage) && (
            <Button icon={Plus} onClick={() => navigate(`/parties/${meta.route}/new`)}>
              New
            </Button>
          )}
          <Dropdown trigger={({ toggle }) => <IconButton icon={MoreHorizontal} label="More actions" onClick={toggle} className={cn('border border-slate-300 bg-white', refreshing && 'animate-pulse')} />} items={moreItems} />
        </div>
      </div>

      {advancedOpen && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-3 rounded-lg border border-slate-200 bg-white">
          <Select aria-label="GST treatment" value={filters.gstTreatment} onChange={(e) => onChange({ gstTreatment: e.target.value })} placeholder="All GST treatments" options={GST_TREATMENTS.map((g) => ({ value: g, label: GST_TREATMENT_LABELS[g] }))} className="h-8 text-xs" />
        </div>
      )}

      {anyFilter && (
        <div className="flex items-center gap-2 flex-wrap text-xs text-slate-600">
          {filters.q && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 text-brand-700 px-2.5 py-1">
              Search: <strong>{filters.q}</strong>
              <button type="button" onClick={() => onChange({ q: '' })} aria-label="Clear search" className="hover:text-brand-900">
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {filters.gstTreatment && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 text-brand-700 px-2.5 py-1">
              GST: <strong>{GST_TREATMENT_LABELS[filters.gstTreatment as keyof typeof GST_TREATMENT_LABELS] ?? filters.gstTreatment}</strong>
              <button type="button" onClick={() => onChange({ gstTreatment: '' })} aria-label="Clear GST treatment" className="hover:text-brand-900">
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          <button type="button" onClick={onReset} className="text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline">
            Clear all filters
          </button>
        </div>
      )}
    </div>
  );
}
