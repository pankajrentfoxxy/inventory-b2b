import { Link, useNavigate } from 'react-router-dom';
import { Ban, Eye, MoreHorizontal, Pencil, Power, SearchX, ShieldCheck, Trash2, Truck, Users } from 'lucide-react';
import { Badge, Button, DataTable, Dropdown, EmptyState, ErrorState, IconButton, type Column } from '../../../components/ui';
import { useAuth } from '../../../lib/auth';
import { GST_TREATMENT_LABELS, PARTY_META, type PartyListItem, type PartyType } from '../types';

export interface PartyTableProps {
  type: PartyType;
  rows: PartyListItem[];
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
  hasFilters: boolean;
  onClearFilters: () => void;
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  onToggleStatus: (row: PartyListItem) => void;
  onBlock: (row: PartyListItem) => void;
  onDelete: (row: PartyListItem) => void;
}

export function PartyTable({ type, rows, loading, error, onRetry, hasFilters, onClearFilters, selected, onSelectedChange, onToggleStatus, onBlock, onDelete }: PartyTableProps) {
  const meta = PARTY_META[type];
  const base = `/parties/${meta.route}`;
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canManage = hasPermission(meta.manage);

  const columns: Column<PartyListItem>[] = [
    {
      key: 'displayName',
      header: 'Name',
      render: (p) => (
        <div className="min-w-0 flex items-start gap-2">
          <div className="min-w-0">
            <Link to={`${base}/${p.id}`} className="font-medium text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
              {p.displayName}
            </Link>
            <p className="text-xs text-slate-500 truncate md:hidden">{p.legalName ?? p.email ?? ''}</p>
          </div>
          {p.status === 'INACTIVE' && (
            <Badge tone="gray" className="shrink-0">
              Inactive
            </Badge>
          )}
          {p.status === 'BLOCKED' && (
            <span className="shrink-0" title={p.blockedReason ?? undefined}>
              <Badge tone="red">Blocked</Badge>
            </span>
          )}
        </div>
      ),
    },
    { key: 'companyName', header: 'Company Name', hideBelow: 'md', render: (p) => <span className="text-slate-800">{p.legalName ?? ''}</span> },
    { key: 'email', header: 'Email', hideBelow: 'lg', render: (p) => (p.email ? <a href={`mailto:${p.email}`} className="text-slate-800 hover:text-brand-700" onClick={(e) => e.stopPropagation()}>{p.email}</a> : '') },
    { key: 'phone', header: 'Work Phone', hideBelow: 'xl', className: 'whitespace-nowrap', render: (p) => <span className="tabular text-slate-800">{p.phone ?? ''}</span> },
    { key: 'gstTreatment', header: 'GST Treatment', hideBelow: 'lg', render: (p) => <span className="text-slate-800">{GST_TREATMENT_LABELS[p.gstTreatment] ?? p.gstTreatment}</span> },
    { key: 'gstin', header: 'GSTIN', className: 'whitespace-nowrap', render: (p) => (p.gstin ? <span className="font-mono text-[13px] text-slate-900">{p.gstin}</span> : <span className="text-slate-300">-</span>) },
  ];

  const empty = hasFilters ? (
    <EmptyState icon={SearchX} title={`No ${meta.plural.toLowerCase()} match your search`} hint="Try a different name, code, email or GSTIN, or clear the filters." action={<Button variant="secondary" size="sm" onClick={onClearFilters}>Clear filters</Button>} />
  ) : (
    <EmptyState
      icon={type === 'SUPPLIER' ? Truck : Users}
      title={`No ${meta.plural.toLowerCase()} yet`}
      hint={type === 'SUPPLIER' ? 'Vendors are the suppliers you buy from. Add your first vendor to start raising purchase orders and bills.' : 'Customers are the businesses and consumers you sell to. Add your first customer to start raising sales orders and invoices.'}
      action={canManage ? <Button onClick={() => navigate(`${base}/new`)}>New {meta.singular}</Button> : undefined}
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
      onRowClick={(r) => navigate(`${base}/${r.id}`)}
      selectable={canManage}
      selected={selected}
      onSelectedChange={onSelectedChange}
      rowActions={(p) => (
        <Dropdown
          trigger={({ toggle }) => <IconButton icon={MoreHorizontal} label={`${meta.singular} actions`} size="sm" onClick={toggle} />}
          items={[
            { key: 'view', label: 'View', icon: Eye, onSelect: () => navigate(`${base}/${p.id}`) },
            { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => navigate(`${base}/${p.id}/edit`), hidden: !canManage },
            { key: 'status', label: p.status === 'ACTIVE' ? 'Mark as Inactive' : 'Mark as Active', icon: Power, onSelect: () => onToggleStatus(p), hidden: !canManage || p.status === 'BLOCKED' },
            { key: 'block', label: p.status === 'BLOCKED' ? 'Unblock' : 'Block', icon: p.status === 'BLOCKED' ? ShieldCheck : Ban, onSelect: () => onBlock(p), hidden: !canManage },
            { key: 'delete', label: 'Delete', icon: Trash2, tone: 'danger', onSelect: () => onDelete(p), hidden: !canManage },
          ]}
        />
      )}
    />
  );
}
