import { Link, useNavigate } from 'react-router-dom';
import { Eye, MoreHorizontal, Pencil, Power, Trash2, Truck, SearchX } from 'lucide-react';
import { Badge, Button, DataTable, Dropdown, EmptyState, ErrorState, IconButton, type Column } from '../../../components/ui';
import { usePermission } from '../../../lib/auth';
import type { VendorListItem } from '../types';

export interface VendorTableProps {
  rows: VendorListItem[];
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
  hasFilters: boolean;
  onClearFilters: () => void;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  onSort: (key: string) => void;
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  onToggleStatus: (row: VendorListItem) => void;
  onDelete: (row: VendorListItem) => void;
}

function money(value: number | null, currency: string) {
  if (value === null) return <span className="text-slate-300">-</span>;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: 2 }).format(value);
}

export function VendorTable({ rows, loading, error, onRetry, hasFilters, onClearFilters, sortBy, sortOrder, onSort, selected, onSelectedChange, onToggleStatus, onDelete }: VendorTableProps) {
  const navigate = useNavigate();
  const perms = usePermission();

  const columns: Column<VendorListItem>[] = [
    {
      key: 'displayName',
      header: 'Name',
      sortable: true,
      render: (v) => (
        <div className="min-w-0 flex items-start gap-2">
          <div className="min-w-0">
            <Link to={`/purchases/vendors/${v.id}`} className="font-medium text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
              {v.displayName}
            </Link>
            <p className="text-xs text-slate-500 truncate md:hidden">{v.companyName ?? v.email ?? ''}</p>
          </div>
          {v.status === 'INACTIVE' && (
            <Badge tone="gray" className="shrink-0">
              Inactive
            </Badge>
          )}
        </div>
      ),
    },
    { key: 'companyName', header: 'Company Name', sortable: true, hideBelow: 'md', render: (v) => <span className="text-slate-800">{v.companyName ?? ''}</span> },
    { key: 'email', header: 'Email', sortable: true, hideBelow: 'lg', render: (v) => (v.email ? <a href={`mailto:${v.email}`} className="text-slate-800 hover:text-brand-700" onClick={(e) => e.stopPropagation()}>{v.email}</a> : '') },
    { key: 'phone', header: 'Work Phone', hideBelow: 'xl', className: 'whitespace-nowrap', render: (v) => <span className="tabular text-slate-800">{v.workPhone ?? v.mobile ?? ''}</span> },
    { key: 'gstTreatment', header: 'GST Treatment', hideBelow: 'lg', render: (v) => <span className="text-slate-800">{v.gstTreatment?.name ?? ''}</span> },
    { key: 'payables', header: 'Payables', align: 'right', className: 'whitespace-nowrap', render: (v) => <span className="tabular text-slate-900">{money(v.openingBalance, v.currencyCode)}</span> },
  ];

  const empty = hasFilters ? (
    <EmptyState icon={SearchX} title="No vendors match your search" hint="Try a different name, email, phone or GSTIN, or clear the filters." action={<Button variant="secondary" size="sm" onClick={onClearFilters}>Clear filters</Button>} />
  ) : (
    <EmptyState
      icon={Truck}
      title="No vendors yet"
      hint="Vendors are the suppliers you buy from. Add your first vendor to start raising purchase orders and bills."
      action={perms.canCreateVendor ? <Button onClick={() => navigate('/purchases/vendors/new')}>New Vendor</Button> : undefined}
    />
  );

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      loading={loading}
      error={error ? <ErrorState message={error} onRetry={onRetry} /> : undefined}
      empty={empty}
      sortBy={sortBy}
      sortOrder={sortOrder}
      onSort={onSort}
      onRowClick={(r) => navigate(`/purchases/vendors/${r.id}`)}
      selectable={perms.canChangeVendorStatus}
      selected={selected}
      onSelectedChange={onSelectedChange}
      rowActions={(v) => (
        <Dropdown
          trigger={({ toggle }) => <IconButton icon={MoreHorizontal} label="Vendor actions" size="sm" onClick={toggle} />}
          items={[
            { key: 'view', label: 'View', icon: Eye, onSelect: () => navigate(`/purchases/vendors/${v.id}`) },
            { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => navigate(`/purchases/vendors/${v.id}/edit`), hidden: !perms.canEditVendor },
            { key: 'status', label: v.status === 'ACTIVE' ? 'Mark as Inactive' : 'Mark as Active', icon: Power, onSelect: () => onToggleStatus(v), hidden: !perms.canChangeVendorStatus },
            { key: 'delete', label: 'Delete', icon: Trash2, tone: 'danger', onSelect: () => onDelete(v), hidden: !perms.canDeleteVendor },
          ]}
        />
      )}
    />
  );
}
