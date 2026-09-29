import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDownAZ, ArrowUpAZ, Check, ChevronDown, MoreHorizontal, Plus, RefreshCw, Settings2, SlidersHorizontal, X } from 'lucide-react';
import { Button, Dropdown, IconButton, Select, type MenuItem } from '../../../components/ui';
import { PermissionGate } from '../../../components/PermissionGate';
import { usePermission } from '../../../lib/auth';
import { cn } from '../../../lib/utils';
import type { VendorFormOptions } from '../types';

export interface VendorFilterState {
  search: string;
  status: string;
  sortBy: string;
  sortOrder: string;
  gstTreatmentId: string;
  sourceOfSupplyId: string;
  vendorType: string;
  tagOptionId: string;
}

const VIEWS = [
  { value: '', label: 'All Vendors', countKey: 'ALL' as const },
  { value: 'ACTIVE', label: 'Active Vendors', countKey: 'ACTIVE' as const },
  { value: 'INACTIVE', label: 'Inactive Vendors', countKey: 'INACTIVE' as const },
];

export const SORT_OPTIONS = [
  { value: 'displayName', label: 'Name' },
  { value: 'companyName', label: 'Company Name' },
  { value: 'email', label: 'Email' },
  { value: 'gstin', label: 'GSTIN' },
  { value: 'status', label: 'Status' },
  { value: 'createdAt', label: 'Created Time' },
  { value: 'updatedAt', label: 'Last Modified Time' },
];

/** Zoho-style list toolbar: view switcher on the left, actions on the right, filters below. */
export function VendorToolbar({ filters, counts, options, onChange, onReset, onRefresh, refreshing }: { filters: VendorFilterState; counts?: { ALL: number; ACTIVE: number; INACTIVE: number }; options?: VendorFormOptions; onChange: (patch: Partial<VendorFilterState>) => void; onReset: () => void; onRefresh: () => void; refreshing?: boolean }) {
  const navigate = useNavigate();
  const { canManageSettings } = usePermission();
  const advancedCount = [filters.gstTreatmentId, filters.sourceOfSupplyId, filters.vendorType, filters.tagOptionId].filter(Boolean).length;
  const [advancedOpen, setAdvancedOpen] = useState(advancedCount > 0);
  const view = VIEWS.find((v) => v.value === (filters.status || '')) ?? VIEWS[0];
  const anyFilter = Boolean(filters.search || filters.status || advancedCount);

  const moreItems: MenuItem[] = [
    ...SORT_OPTIONS.map((o) => ({
      key: `sort-${o.value}`,
      label: (
        <span className="flex items-center justify-between w-full gap-3">
          <span className="text-slate-500 text-xs">Sort by</span>
          <span className="flex-1">{o.label}</span>
          {filters.sortBy === o.value && <Check className="w-4 h-4 text-brand-600" />}
        </span>
      ),
      onSelect: () => onChange(filters.sortBy === o.value ? { sortOrder: filters.sortOrder === 'asc' ? 'desc' : 'asc' } : { sortBy: o.value, sortOrder: 'asc' }),
    })),
    { key: 'order', label: filters.sortOrder === 'asc' ? 'Ascending order' : 'Descending order', icon: filters.sortOrder === 'asc' ? ArrowDownAZ : ArrowUpAZ, onSelect: () => onChange({ sortOrder: filters.sortOrder === 'asc' ? 'desc' : 'asc' }) },
    { key: 'refresh', label: 'Refresh List', icon: RefreshCw, onSelect: onRefresh },
    { key: 'settings', label: 'Vendor Fields & Tags', icon: Settings2, onSelect: () => navigate('/settings/vendor-fields'), hidden: !canManageSettings },
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
          items={VIEWS.map((v) => ({
            key: v.value || 'all',
            label: (
              <span className="flex items-center justify-between w-full gap-4">
                <span>{v.label}</span>
                <span className="flex items-center gap-2">
                  {counts && <span className="text-xs text-slate-400 tabular">{counts[v.countKey]}</span>}
                  {v.value === (filters.status || '') && <Check className="w-4 h-4 text-brand-600" />}
                </span>
              </span>
            ),
            onSelect: () => onChange({ status: v.value }),
          }))}
        />

        <div className="flex items-center gap-2">
          <Button variant={advancedOpen || advancedCount ? 'subtle' : 'secondary'} size="md" icon={SlidersHorizontal} onClick={() => setAdvancedOpen((o) => !o)}>
            Filters{advancedCount ? ` (${advancedCount})` : ''}
          </Button>
          <PermissionGate permission="vendor.create">
            <Button icon={Plus} onClick={() => navigate('/purchases/vendors/new')}>
              New
            </Button>
          </PermissionGate>
          <Dropdown trigger={({ toggle }) => <IconButton icon={MoreHorizontal} label="More actions" onClick={toggle} className={cn('border border-slate-300 bg-white', refreshing && 'animate-pulse')} />} items={moreItems} />
        </div>
      </div>

      {advancedOpen && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-3 rounded-lg border border-slate-200 bg-white">
          <Select aria-label="GST treatment" value={filters.gstTreatmentId} onChange={(e) => onChange({ gstTreatmentId: e.target.value })} placeholder="All GST treatments" options={(options?.gstTreatments ?? []).map((g) => ({ value: g.id, label: g.name }))} className="h-8 text-xs" />
          <Select aria-label="Source of supply" value={filters.sourceOfSupplyId} onChange={(e) => onChange({ sourceOfSupplyId: e.target.value })} placeholder="All sources of supply" options={(options?.sourcesOfSupply ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))} className="h-8 text-xs" />
          <Select aria-label="Vendor type" value={filters.vendorType} onChange={(e) => onChange({ vendorType: e.target.value })} placeholder="All vendor types" options={options?.vendorTypes ?? []} className="h-8 text-xs" />
          <Select aria-label="Reporting tag" value={filters.tagOptionId} onChange={(e) => onChange({ tagOptionId: e.target.value })} placeholder="Any reporting tag" options={(options?.reportingTags ?? []).flatMap((t) => t.options.map((o) => ({ value: o.id, label: `${t.name}: ${o.name}` })))} className="h-8 text-xs" />
        </div>
      )}

      {anyFilter && (
        <div className="flex items-center gap-2 flex-wrap text-xs text-slate-600">
          {filters.search && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 text-brand-700 px-2.5 py-1">
              Search: <strong>{filters.search}</strong>
              <button type="button" onClick={() => onChange({ search: '' })} aria-label="Clear search" className="hover:text-brand-900">
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
