import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Archive, ChevronDown, ChevronRight, FolderTree, MoreHorizontal, Plus, Power } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, Checkbox, Dropdown, EmptyState, ErrorState, IconButton, PageHeader, Skeleton, StatusBadge } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { cn } from '../../../lib/utils';
import { useSimpleCreate, useSimpleMaster, useSimpleStatus } from '../hooks';
import type { Brand, Category, MasterStatus } from '../types';
import { SimpleFormModal, type FieldSpec } from '../components/SimpleFormModal';
import { SimpleMasterCard } from '../components/SimpleMasterCard';

interface CategoryNode extends Category {
  children: CategoryNode[];
}

function buildTree(rows: Category[]): CategoryNode[] {
  const byId = new Map<string, CategoryNode>();
  rows.forEach((r) => byId.set(r.id, { ...r, children: [] }));
  const roots: CategoryNode[] = [];
  byId.forEach((node) => {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  const sort = (nodes: CategoryNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

const CATEGORY_FIELDS: FieldSpec[] = [{ name: 'name', label: 'Name', type: 'text', sanitize: 'singleLine', maxLength: 100, required: true, span: 2 }];

function CategoryRow({ node, depth, canManage, onAddChild, onStatus }: { node: CategoryNode; depth: number; canManage: boolean; onAddChild: (n: CategoryNode) => void; onStatus: (n: CategoryNode, s: MasterStatus) => void }) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;
  return (
    <li>
      <div className={cn('flex items-center gap-2 py-1.5 rounded-md hover:bg-slate-50 pr-1', node.status !== 'ACTIVE' && 'text-slate-500')} style={{ paddingLeft: depth * 20 }}>
        <button type="button" onClick={() => setOpen((o) => !o)} className={cn('w-5 h-5 inline-flex items-center justify-center text-slate-400', !hasChildren && 'invisible')} aria-label={open ? 'Collapse' : 'Expand'}>
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <span className="text-sm font-medium text-slate-900 min-w-0 truncate">{node.name}</span>
        {hasChildren && <span className="text-xs text-slate-400 tabular">{node.children.length}</span>}
        {node.status !== 'ACTIVE' && <StatusBadge status={node.status} dot={false} />}
        {canManage && (
          <span className="ml-auto">
            <Dropdown
              trigger={({ toggle }) => <IconButton icon={MoreHorizontal} label="Category actions" size="xs" onClick={toggle} />}
              items={[
                { key: 'child', label: 'Add sub-category', icon: Plus, onSelect: () => onAddChild(node), hidden: node.status !== 'ACTIVE' },
                { key: 'activate', label: 'Activate', icon: Power, onSelect: () => onStatus(node, 'ACTIVE'), hidden: node.status === 'ACTIVE' },
                { key: 'deactivate', label: 'Deactivate', icon: Power, onSelect: () => onStatus(node, 'INACTIVE'), hidden: node.status !== 'ACTIVE' },
                { key: 'archive', label: 'Archive', icon: Archive, tone: 'danger', onSelect: () => onStatus(node, 'ARCHIVED'), hidden: node.status === 'ARCHIVED' },
              ]}
            />
          </span>
        )}
      </div>
      {open && hasChildren && (
        <ul>
          {node.children.map((c) => (
            <CategoryRow key={c.id} node={c} depth={depth + 1} canManage={canManage} onAddChild={onAddChild} onStatus={onStatus} />
          ))}
        </ul>
      )}
    </li>
  );
}

function CategoriesCard() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('master.manage');
  const [includeInactive, setIncludeInactive] = useState(false);
  const query = useSimpleMaster('categories', includeInactive);
  const create = useSimpleCreate('categories');
  const setStatus = useSimpleStatus('categories');
  const [addFor, setAddFor] = useState<{ open: boolean; parent: CategoryNode | null }>({ open: false, parent: null });
  const tree = useMemo(() => buildTree(query.data ?? []), [query.data]);

  const changeStatus = async (node: CategoryNode, status: MasterStatus) => {
    try {
      await setStatus.mutateAsync({ id: node.id, status });
      toast.success(`${node.name} is now ${status.toLowerCase()}`);
    } catch (err) {
      toast.error(toApiError(err).message);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Categories"
        description="Hierarchy used to group products for filters and reports."
        actions={
          <>
            <Checkbox label={<span className="text-xs text-slate-600">Show inactive</span>} checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
            {canManage && (
              <Button size="sm" icon={Plus} onClick={() => setAddFor({ open: true, parent: null })}>
                Add
              </Button>
            )}
          </>
        }
      />
      <CardBody className="py-2">
        {query.isLoading ? (
          <div className="space-y-2 py-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-5 w-64 ml-5" />
            <Skeleton className="h-5 w-40" />
          </div>
        ) : query.isError ? (
          <ErrorState message={toApiError(query.error).message} onRetry={() => void query.refetch()} className="py-6" />
        ) : tree.length === 0 ? (
          <EmptyState icon={FolderTree} title="No categories yet" hint="Categories can be nested, e.g. Mobiles > Smartphones > 5G." className="py-8" action={canManage ? <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAddFor({ open: true, parent: null })}>Add category</Button> : undefined} />
        ) : (
          <ul>
            {tree.map((n) => (
              <CategoryRow key={n.id} node={n} depth={0} canManage={canManage} onAddChild={(parent) => setAddFor({ open: true, parent })} onStatus={(n, s) => void changeStatus(n, s)} />
            ))}
          </ul>
        )}
      </CardBody>
      <SimpleFormModal
        open={addFor.open}
        onClose={() => setAddFor({ open: false, parent: null })}
        title={addFor.parent ? `New sub-category of ${addFor.parent.name}` : 'New category'}
        fields={CATEGORY_FIELDS}
        pending={create.isPending}
        onSubmit={(payload) => create.mutateAsync({ ...payload, parentId: addFor.parent?.id ?? null })}
        successMessage={(r) => `${(r as Category).name} created`}
        size="sm"
      />
    </Card>
  );
}

export function CatalogPage() {
  return (
    <>
      <PageHeader title="Categories & Brands" breadcrumbs={[{ label: 'Masters' }, { label: 'Categories & Brands' }]} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <CategoriesCard />
        <SimpleMasterCard<'brands'>
          kind="brands"
          title="Brands"
          noun="Brand"
          description="Manufacturer / brand labels shown on products."
          columns={[{ key: 'name', header: 'Name', render: (b: Brand) => <span className="font-medium text-slate-900">{b.name}</span> }]}
          fields={[{ name: 'name', label: 'Name', type: 'text', sanitize: 'singleLine', maxLength: 100, required: true, span: 2 }]}
          rowLabel={(b) => b.name}
          emptyHint="Add the brands you trade so products can be filtered by brand."
        />
      </div>
    </>
  );
}
