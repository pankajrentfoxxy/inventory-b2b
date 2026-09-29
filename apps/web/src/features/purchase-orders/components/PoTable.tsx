import { Link, useNavigate } from 'react-router-dom';
import { ClipboardList, Eye, MoreHorizontal, PackageCheck, Pencil, SearchX, Send, Trash2, XCircle } from 'lucide-react';
import { PURCHASE_ORDER_EDITABLE_STATUSES, PURCHASE_ORDER_RECEIVABLE_STATUSES } from '@b2b/shared';
import { Button, DataTable, Dropdown, EmptyState, ErrorState, IconButton, type Column } from '../../../components/ui';
import { usePermission } from '../../../lib/auth';
import { formatDate, formatMoney } from '../../../lib/utils';
import type { PoListItem } from '../types';
import { PoStatusBadge, ReceiveStateText } from './PoStatusBadge';

export interface PoTableProps {
  rows: PoListItem[];
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
  onAction: (row: PoListItem, action: 'issue' | 'cancel' | 'delete') => void;
}

export function PoTable({ rows, loading, error, onRetry, hasFilters, onClearFilters, sortBy, sortOrder, onSort, selected, onSelectedChange, onAction }: PoTableProps) {
  const navigate = useNavigate();
  const perms = usePermission();

  const columns: Column<PoListItem>[] = [
    { key: 'orderDate', header: 'Date', sortable: true, className: 'whitespace-nowrap', render: (p) => <span className="text-slate-800 tabular">{formatDate(p.orderDate)}</span> },
    {
      key: 'purchaseOrderNumber',
      header: 'Purchase Order#',
      sortable: true,
      render: (p) => (
        <div className="min-w-0">
          <Link to={`/purchases/purchase-orders/${p.id}`} className="font-medium text-brand-700 hover:underline font-mono text-[13px]" onClick={(e) => e.stopPropagation()}>
            {p.purchaseOrderNumber}
          </Link>
          <p className="text-xs text-slate-500 truncate md:hidden">{p.vendor.displayName}</p>
        </div>
      ),
    },
    { key: 'referenceNumber', header: 'Reference#', hideBelow: 'xl', render: (p) => <span className="text-slate-700">{p.referenceNumber ?? ''}</span> },
    { key: 'vendor', header: 'Vendor Name', hideBelow: 'md', render: (p) => <Link to={`/purchases/vendors/${p.vendor.id}`} className="text-slate-800 hover:text-brand-700" onClick={(e) => e.stopPropagation()}>{p.vendor.displayName}</Link> },
    { key: 'status', header: 'Status', sortable: true, render: (p) => <PoStatusBadge status={p.status} /> },
    { key: 'received', header: 'Received', hideBelow: 'lg', render: (p) => <span className="text-xs"><ReceiveStateText state={p.receiveState} /></span> },
    { key: 'expectedDeliveryDate', header: 'Expected Delivery', sortable: true, hideBelow: 'lg', className: 'whitespace-nowrap', render: (p) => <span className="text-slate-700 tabular">{p.expectedDeliveryDate ? formatDate(p.expectedDeliveryDate) : ''}</span> },
    { key: 'total', header: 'Amount', sortable: true, align: 'right', className: 'whitespace-nowrap', render: (p) => <span className="tabular font-medium text-slate-900">{formatMoney(p.total, p.currencyCode)}</span> },
  ];

  const empty = hasFilters ? (
    <EmptyState icon={SearchX} title="No purchase orders match" hint="Try another number, reference or vendor, or clear the filters." action={<Button variant="secondary" size="sm" onClick={onClearFilters}>Clear filters</Button>} />
  ) : (
    <EmptyState icon={ClipboardList} title="No purchase orders yet" hint="Raise a purchase order to a vendor, issue it, and receive the goods against it." action={perms.canCreatePurchaseOrder ? <Button onClick={() => navigate('/purchases/purchase-orders/new')}>New Purchase Order</Button> : undefined} />
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
      onRowClick={(r) => navigate(`/purchases/purchase-orders/${r.id}`)}
      selectable={perms.canIssuePurchaseOrder}
      selected={selected}
      onSelectedChange={onSelectedChange}
      rowActions={(p) => (
        <Dropdown
          trigger={({ toggle }) => <IconButton icon={MoreHorizontal} label="Purchase order actions" size="sm" onClick={toggle} />}
          items={[
            { key: 'view', label: 'View', icon: Eye, onSelect: () => navigate(`/purchases/purchase-orders/${p.id}`) },
            { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => navigate(`/purchases/purchase-orders/${p.id}/edit`), hidden: !perms.canEditPurchaseOrder || !PURCHASE_ORDER_EDITABLE_STATUSES.includes(p.status) },
            { key: 'issue', label: 'Mark as Issued', icon: Send, onSelect: () => onAction(p, 'issue'), hidden: !perms.canIssuePurchaseOrder || p.status !== 'DRAFT' },
            { key: 'receive', label: 'Receive Goods', icon: PackageCheck, onSelect: () => navigate(`/purchases/purchase-receives/new?po=${p.id}`), hidden: !perms.canCreateReceive || !PURCHASE_ORDER_RECEIVABLE_STATUSES.includes(p.status) },
            { key: 'cancel', label: 'Cancel', icon: XCircle, tone: 'danger', onSelect: () => onAction(p, 'cancel'), hidden: !perms.canCancelPurchaseOrder || !['DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED', 'CLOSED'].includes(p.status) || p.receiveCount > 0 },
            { key: 'delete', label: 'Delete', icon: Trash2, tone: 'danger', onSelect: () => onAction(p, 'delete'), hidden: !perms.canDeletePurchaseOrder || !['DRAFT', 'CANCELLED'].includes(p.status) },
          ]}
        />
      )}
    />
  );
}
