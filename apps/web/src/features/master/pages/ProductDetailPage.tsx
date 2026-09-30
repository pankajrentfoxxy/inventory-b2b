import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Archive, ChevronDown, Lock, Pencil, Power, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, DescriptionList, DetailSkeleton, Dropdown, ErrorState, PageHeader, ReasonDialog, StatusBadge } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatDateTime, formatMoney, formatQty, humanize } from '../../../lib/utils';
import { LaptopSpecsView } from '../../../components/LaptopSpecs';
import { useDeleteProduct, useProduct, useProductTransition, useSimpleMaster } from '../hooks';
import type { ProductDetail } from '../types';
import { EditDetailsModal, EditSpecsModal } from '../components/LaptopEditModals';

type Command = 'activate' | 'deactivate' | 'archive';
const COMMAND_TEXT: Record<Command, { title: string; label: string; message: string; tone: 'danger' | 'primary' }> = {
  activate: { title: 'Activate configuration?', label: 'Activate', message: 'The configuration becomes selectable on purchase orders, receipts and sales documents.', tone: 'primary' },
  deactivate: { title: 'Deactivate configuration?', label: 'Deactivate', message: 'The configuration is hidden from pickers. Existing documents and stock are unaffected; you can activate it again later.', tone: 'danger' },
  archive: { title: 'Archive configuration?', label: 'Archive', message: 'Archived configurations are read-only and cannot be reactivated from the UI. Use this for items you will never trade again.', tone: 'danger' },
};

function LockedHint({ fields }: { fields: string[] }) {
  if (fields.length === 0) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      <Lock className="w-4 h-4 shrink-0 mt-0.5" />
      <span>
        This configuration has stock movements. <strong>{fields.map(humanize).join(', ')}</strong> {fields.length === 1 ? 'is' : 'are'} locked and cannot be edited.
      </span>
    </div>
  );
}

function Overview({ product, canManage, onEditSpecs, onEditDetails }: { product: ProductDetail; canManage: boolean; onEditSpecs: () => void; onEditDetails: () => void }) {
  const warranties = useSimpleMaster('warranty-policies', true);
  const warranty = product.defaultWarrantyId ? warranties.data?.find((w) => w.id === product.defaultWarrantyId)?.name ?? '...' : null;
  const editable = canManage && product.status !== 'ARCHIVED';

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2 space-y-4">
        <Card>
          <CardHeader
            title="Specifications"
            description={product.isLaptop ? 'The eight specifications that identify this configuration.' : undefined}
            actions={
              product.isLaptop && editable && product.status === 'DRAFT' ? (
                <Button size="sm" variant="secondary" icon={Pencil} onClick={onEditSpecs}>
                  Edit specifications
                </Button>
              ) : undefined
            }
          />
          <CardBody className="space-y-3">
            {product.specs ? (
              <LaptopSpecsView specs={product.specs} variant="grid" />
            ) : (
              <p className="text-sm text-slate-500">This is a legacy generic product without laptop specifications. New items are created as laptop configurations.</p>
            )}
            {product.isLaptop && product.status !== 'DRAFT' && (
              <p className="flex items-start gap-2 text-xs text-slate-500">
                <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                Specifications are fixed once active. Create a new configuration for a different variant.
              </p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Pricing and tax"
            actions={
              editable ? (
                <Button size="sm" variant="secondary" icon={Pencil} onClick={onEditDetails}>
                  Edit
                </Button>
              ) : undefined
            }
          />
          <CardBody>
            <DescriptionList
              items={[
                { label: 'Purchase price', value: product.purchasePrice === null ? null : formatMoney(product.purchasePrice), mono: true },
                { label: 'Selling price', value: product.sellingPrice === null ? null : formatMoney(product.sellingPrice), mono: true },
                { label: 'GST rate', value: product.taxRate === null ? null : `${product.taxRate}%` },
                { label: 'HSN code', value: product.hsnCode, mono: true },
                { label: 'Reorder level', value: product.reorderLevel === null ? null : formatQty(product.reorderLevel) },
                { label: 'Default warranty', value: warranty },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Identity and tracking" />
          <CardBody>
            <DescriptionList
              items={[
                { label: 'SKU', value: product.sku, mono: true },
                { label: 'Name', value: product.name },
                { label: 'Unit', value: product.unitCode },
                { label: 'Tracking', value: [product.trackInventory ? 'Stocked' : 'Not tracked', product.isSerialized ? 'Serialized' : null, product.qcRequired ? 'QC on receipt' : null].filter(Boolean).join(', ') },
                { label: 'Serial pattern', value: product.serialPattern, mono: true },
                { label: 'Description', value: product.description, span: 2 },
              ]}
            />
          </CardBody>
        </Card>
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader title="Referenced by" description="Services that hold documents for this configuration. Referenced items cannot be deleted, only archived." />
          <CardBody>
            {product.referencedBy.length === 0 ? (
              <p className="text-sm text-slate-400">Not referenced by any document yet</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {product.referencedBy.map((r) => (
                  <Badge key={r} tone="blue">{r}</Badge>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardBody className="text-xs text-slate-500 space-y-1">
            <p>Version {product.version}</p>
            <p>Created {formatDateTime(product.createdAt)}</p>
            <p>Last modified {formatDateTime(product.updatedAt)}</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export function ProductDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('master.manage');
  const q = useProduct(id);
  const transition = useProductTransition();
  const del = useDeleteProduct();
  const [editOpen, setEditOpen] = useState(false);
  const [specsOpen, setSpecsOpen] = useState(false);
  const [command, setCommand] = useState<Command | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (q.isLoading) return <DetailSkeleton />;
  if (q.isError || !q.data) {
    const err = toApiError(q.error);
    return (
      <>
        <PageHeader title="Laptop configuration" breadcrumbs={[{ label: 'Masters' }, { label: 'Laptop configurations', to: '/masters/products' }]} />
        <Card>
          <ErrorState title={err.status === 404 ? 'Configuration not found' : 'Could not load the configuration'} message={err.status === 404 ? 'It may have been deleted, or it belongs to another organisation.' : err.message} onRetry={err.status === 404 ? undefined : () => void q.refetch()} />
        </Card>
      </>
    );
  }
  const product = q.data;
  const status = product.status;

  const runCommand = async (reason: string) => {
    if (!command) return;
    try {
      const saved = await transition.mutateAsync({ id: product.id, command, reason: reason || undefined });
      toast.success(`${saved.name} is now ${saved.status.toLowerCase()}`);
    } catch (err) {
      toast.error(toApiError(err).message);
    } finally {
      setCommand(null);
    }
  };
  const runDelete = async () => {
    try {
      await del.mutateAsync(product.id);
      toast.success(`${product.name} deleted`);
      navigate('/masters/products', { replace: true });
    } catch (err) {
      const e = toApiError(err);
      toast.error(e.code === 'MASTER_IN_USE' ? `${e.message}${e.details.length ? ` (${e.details.map((d) => d.message).join(', ')})` : ''}` : e.message);
      setConfirmDelete(false);
    }
  };

  const menu = [
    { key: 'activate', label: 'Activate', icon: Power, onSelect: () => setCommand('activate'), hidden: !(status === 'DRAFT' || status === 'INACTIVE') },
    { key: 'deactivate', label: 'Deactivate', icon: Power, onSelect: () => setCommand('deactivate'), hidden: status !== 'ACTIVE' },
    { key: 'archive', label: 'Archive', icon: Archive, onSelect: () => setCommand('archive'), hidden: status === 'ARCHIVED' },
    { key: 'delete', label: 'Delete', icon: Trash2, tone: 'danger' as const, onSelect: () => setConfirmDelete(true), hidden: status !== 'DRAFT' },
  ];

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            <span className="font-mono">{product.sku}</span>
            <StatusBadge status={status} />
          </span>
        }
        subtitle={product.name}
        breadcrumbs={[{ label: 'Masters' }, { label: 'Laptop configurations', to: '/masters/products' }, { label: product.sku }]}
        actions={
          canManage ? (
            <>
              {status === 'DRAFT' || status === 'INACTIVE' ? (
                <Button icon={Power} onClick={() => setCommand('activate')}>
                  Activate
                </Button>
              ) : null}
              <Dropdown trigger={({ toggle }) => <Button variant="secondary" iconRight={ChevronDown} onClick={toggle}>More</Button>} items={menu} />
            </>
          ) : undefined
        }
      >
        <div className="space-y-2">
          {status === 'ARCHIVED' && <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">This configuration is archived and read-only.</div>}
          {status === 'DRAFT' && <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">Draft configurations are not selectable on documents until activated.</div>}
          <LockedHint fields={product.lockedFields} />
        </div>
      </PageHeader>

      <Overview product={product} canManage={canManage} onEditSpecs={() => setSpecsOpen(true)} onEditDetails={() => setEditOpen(true)} />

      <EditDetailsModal open={editOpen} onClose={() => setEditOpen(false)} product={product} onConflict={() => void q.refetch()} />
      {product.isLaptop && <EditSpecsModal open={specsOpen} onClose={() => setSpecsOpen(false)} product={product} onConflict={() => void q.refetch()} />}
      <ReasonDialog
        open={command !== null}
        onClose={() => setCommand(null)}
        onConfirm={({ reason }) => void runCommand(reason)}
        title={command ? COMMAND_TEXT[command].title : ''}
        message={command ? COMMAND_TEXT[command].message : undefined}
        confirmLabel={command ? COMMAND_TEXT[command].label : 'Confirm'}
        tone={command ? COMMAND_TEXT[command].tone : 'primary'}
        reasonRequired={false}
        reasonLabel="Reason (optional, recorded in the audit trail)"
        loading={transition.isPending}
      />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void runDelete()}
        loading={del.isPending}
        title="Delete configuration?"
        confirmLabel="Delete"
        message={<><strong>{product.name}</strong> will be permanently removed. Only never-used drafts can be deleted; anything referenced by a document must be archived instead.</>}
      />
    </>
  );
}
