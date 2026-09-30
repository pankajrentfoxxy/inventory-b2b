import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Boxes, Building2, Check, ChevronDown, ChevronRight, ClipboardList, LogOut, Menu, Package, PackageCheck, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings, ShieldCheck, SlidersHorizontal, Truck, Users, Warehouse, X } from 'lucide-react';
import { SEARCH_MAX_LENGTH, normalizeSearch } from '@b2b/shared';
import { useAuth } from '../lib/auth';
import { toApiError } from '../lib/api';
import { cn, initials } from '../lib/utils';
import { Dropdown, type MenuItem } from '../components/ui';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { NAVIGATION, PLATFORM_NAVIGATION, PLATFORM_SEARCH_SCOPES, SEARCH_SCOPES, type NavModule, type SearchScope } from './navigation';

const SIDEBAR_KEY = 'b2b.sidebar';
export type LayoutVariant = 'tenant' | 'platform';

/* ---- sidebar ------------------------------------------------------------- */

function ModuleItem({ module, collapsed, onNavigate }: { module: NavModule; collapsed: boolean; onNavigate: () => void }) {
  const location = useLocation();
  const { hasPermission } = useAuth();
  const children = (module.children ?? []).filter((c) => !c.permission || hasPermission(c.permission));
  const isActive = module.to ? (module.to === '/' || module.to === '/admin' ? location.pathname === module.to : location.pathname === module.to || location.pathname.startsWith(`${module.to}/`)) : children.some((c) => location.pathname.startsWith(c.to));
  const [open, setOpen] = useState(isActive || Boolean(module.defaultOpen));
  useEffect(() => {
    if (isActive) setOpen(true);
  }, [isActive]);

  const base = 'w-full flex items-center gap-3 rounded-lg text-sm transition-colors';
  const soon = <span className="ml-auto shrink-0 text-[9px] font-semibold uppercase tracking-wide text-navy-300/80 bg-navy-700 rounded px-1.5 py-0.5">Soon</span>;

  if (!module.available) {
    return (
      <div title={`${module.label} is coming soon`} className={cn(base, 'px-3 py-2 text-navy-300/70 cursor-default', collapsed && 'justify-center px-0')}>
        <module.icon className="w-[18px] h-[18px] shrink-0" />
        {!collapsed && (
          <>
            <span className="flex-1 text-left">{module.label}</span>
            {soon}
          </>
        )}
      </div>
    );
  }

  if (module.children && module.children.length > 0) {
    if (children.length === 0) return null;
    const firstLive = children.find((c) => c.available);
    return (
      <div>
        <button
          type="button"
          onClick={() => (collapsed && firstLive ? (onNavigate(), undefined) : setOpen((o) => !o))}
          className={cn(base, 'px-3 py-2 text-navy-200 hover:bg-navy-800 hover:text-white', isActive && 'text-white', collapsed && 'justify-center px-0')}
          aria-expanded={open}
        >
          {collapsed ? (
            <NavLink to={firstLive?.to ?? '#'} className="flex items-center justify-center w-full" title={module.label}>
              <module.icon className="w-[18px] h-[18px]" />
            </NavLink>
          ) : (
            <>
              <module.icon className="w-[18px] h-[18px] shrink-0" />
              <span className="flex-1 text-left font-medium">{module.label}</span>
              <ChevronRight className={cn('w-4 h-4 text-navy-300 transition-transform', open && 'rotate-90')} />
            </>
          )}
        </button>
        {open && !collapsed && (
          <ul className="mt-0.5 mb-1 space-y-0.5">
            {children.map((c) =>
              c.available ? (
                <li key={c.to}>
                  <NavLink to={c.to} onClick={onNavigate} end={c.to.split('?')[0] === location.pathname && c.to.includes('?')} className={({ isActive: a }) => cn('flex items-center gap-2 rounded-lg pl-[38px] pr-3 py-2 text-sm transition-colors', a ? 'bg-brand-600 text-white font-medium shadow-sm' : 'text-navy-200 hover:bg-navy-800 hover:text-white')}>
                    <span className="flex-1 truncate whitespace-nowrap">{c.label}</span>
                  </NavLink>
                </li>
              ) : (
                <li key={c.to} title={`${c.label} is coming soon`} className="flex items-center gap-2 rounded-lg pl-[38px] pr-3 py-2 text-sm text-navy-300/70 cursor-default">
                  <span className="flex-1 truncate whitespace-nowrap">{c.label}</span>
                  {soon}
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    );
  }

  return (
    <NavLink to={module.to ?? '#'} end={module.to === '/' || module.to === '/admin'} onClick={onNavigate} className={({ isActive: a }) => cn(base, 'px-3 py-2', a ? 'bg-brand-600 text-white' : 'text-navy-200 hover:bg-navy-800 hover:text-white', collapsed && 'justify-center px-0')} title={module.label}>
      <module.icon className="w-[18px] h-[18px] shrink-0" />
      {!collapsed && <span className="flex-1 text-left font-medium">{module.label}</span>}
    </NavLink>
  );
}

function Sidebar({ modules, variant, collapsed, onToggle, onNavigate, onClose }: { modules: NavModule[]; variant: LayoutVariant; collapsed: boolean; onToggle?: () => void; onNavigate: () => void; onClose?: () => void }) {
  const { hasPermission } = useAuth();
  const visible = modules.filter((m) => !m.permission || hasPermission(m.permission));
  return (
    <div className="flex flex-col h-full bg-navy-900 text-navy-200">
      <div className={cn('h-14 flex items-center gap-2.5 px-4 border-b border-navy-800', collapsed && 'justify-center px-0')}>
        <span className={cn('w-8 h-8 rounded-lg text-white flex items-center justify-center shrink-0', variant === 'platform' ? 'bg-violet-600' : 'bg-brand-600')}>
          {variant === 'platform' ? <ShieldCheck className="w-4 h-4" /> : <Boxes className="w-4 h-4" />}
        </span>
        {!collapsed && <span className="font-semibold text-white text-[15px] tracking-tight">{variant === 'platform' ? 'Platform Console' : 'Inventory'}</span>}
        {onClose && (
          <button type="button" className="ml-auto text-navy-300 hover:text-white" onClick={onClose} aria-label="Close menu">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>
      <nav className={cn('flex-1 overflow-y-auto py-3 space-y-0.5', collapsed ? 'px-2' : 'px-3')}>
        {visible.map((m) => (
          <ModuleItem key={m.key} module={m} collapsed={collapsed} onNavigate={onNavigate} />
        ))}
      </nav>
      {onToggle && (
        <div className="border-t border-navy-800 p-2">
          <button type="button" onClick={onToggle} className={cn('w-full flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-navy-300 hover:bg-navy-800 hover:text-white', collapsed && 'justify-center px-0')} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            {!collapsed && 'Collapse'}
          </button>
        </div>
      )}
    </div>
  );
}

/* ---- top bar --------------------------------------------------------------- */

function GlobalSearch({ scopes }: { scopes: SearchScope[] }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const scope = scopes.find((s) => location.pathname.startsWith(s.prefix)) ?? scopes[0];
  const param = scope.param ?? 'search';
  const onList = location.pathname === scope.to;
  const urlSearch = params.get(param) ?? '';
  const [value, setValue] = useState(urlSearch);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(onList ? urlSearch : '');
  }, [onList, urlSearch, scope.to]);

  const debounced = useDebouncedValue(normalizeSearch(value), 320);
  useEffect(() => {
    if (!onList || debounced === urlSearch) return;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (debounced) next.set(param, debounced);
        else next.delete(param);
        next.delete('page');
        next.delete('cursor');
        return next;
      },
      { replace: true },
    );
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="relative flex-1 max-w-md">
      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, SEARCH_MAX_LENGTH))}
        maxLength={SEARCH_MAX_LENGTH}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !onList && normalizeSearch(value)) navigate(`${scope.to}?${param}=${encodeURIComponent(normalizeSearch(value))}`);
        }}
        placeholder={`Search in ${scope.label} ( / )`}
        aria-label={`Search ${scope.label.toLowerCase()}`}
        className="w-full h-9 pl-9 pr-8 rounded-lg border border-slate-200 bg-slate-100/80 text-sm placeholder:text-slate-400 hover:bg-slate-100 focus:bg-white focus:border-brand-500 outline-none transition-colors"
      />
      {value && (
        <button type="button" onClick={() => setValue('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function TopBar({ onMenu, variant }: { onMenu: () => void; variant: LayoutVariant }) {
  const { user, tenants, session, switchOrganization, logout, hasPermission, warehouseIds } = useAuth();
  const navigate = useNavigate();
  const [switching, setSwitching] = useState(false);

  const quickCreate: MenuItem[] = variant === 'platform'
    ? [{ key: 'tenant', label: 'Tenant', icon: Building2, onSelect: () => navigate('/admin/tenants/new'), hidden: !hasPermission('platform.tenant.create') }]
    : [
        { key: 'po', label: 'Purchase Order', icon: ClipboardList, onSelect: () => navigate('/purchases/orders/new'), hidden: !hasPermission('purchase.create') },
        { key: 'grn', label: 'Goods Receipt', icon: PackageCheck, onSelect: () => navigate('/purchases/receipts/new'), hidden: !hasPermission('grn.create') },
        { key: 'product', label: 'Laptop configuration', icon: Package, onSelect: () => navigate('/masters/products?new=1'), hidden: !hasPermission('master.manage') },
        { key: 'supplier', label: 'Vendor', icon: Truck, onSelect: () => navigate('/parties/vendors/new'), hidden: !hasPermission('supplier.manage') },
        { key: 'customer', label: 'Customer', icon: Users, onSelect: () => navigate('/parties/customers/new'), hidden: !hasPermission('customer.manage') },
        { key: 'adjustment', label: 'Stock Adjustment', icon: SlidersHorizontal, onSelect: () => navigate('/inventory/adjustments/new'), hidden: !hasPermission('inventory.adjust') },
      ];

  const settingsItems: MenuItem[] = variant === 'platform'
    ? []
    : [
        { key: 'members', label: 'Members', icon: Users, onSelect: () => navigate('/settings/members'), hidden: !hasPermission('iam.member.view') },
        { key: 'roles', label: 'Roles & Permissions', icon: ShieldCheck, onSelect: () => navigate('/settings/roles'), hidden: !hasPermission('iam.role.view') },
        { key: 'numbering', label: 'Document Numbering', icon: ClipboardList, onSelect: () => navigate('/masters/numbering'), hidden: !hasPermission('settings.manage') },
        { key: 'procurement', label: 'Procurement Settings', icon: PackageCheck, onSelect: () => navigate('/settings/procurement'), hidden: !hasPermission(['settings.manage', 'purchase.view']) },
        { key: 'inventory', label: 'Inventory Settings', icon: Warehouse, onSelect: () => navigate('/settings/inventory'), hidden: !hasPermission(['inventory.adjust.approve', 'inventory.view']) },
      ];

  const switchTo = async (id: string) => {
    if (id === session?.tenant?.id) return;
    setSwitching(true);
    try {
      await switchOrganization(id);
      navigate('/');
    } catch (err) {
      toast.error(toApiError(err).message);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <header className="h-14 sticky top-0 z-30 bg-white border-b border-slate-200 flex items-center gap-3 px-3 sm:px-4">
      <button type="button" onClick={onMenu} aria-label="Open menu" className="lg:hidden text-slate-600 p-1">
        <Menu className="w-5 h-5" />
      </button>
      <GlobalSearch scopes={variant === 'platform' ? PLATFORM_SEARCH_SCOPES : SEARCH_SCOPES} />
      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        {variant === 'tenant' && (
          <Dropdown
            trigger={({ toggle }) => (
              <button type="button" onClick={toggle} className={cn('hidden sm:flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100', switching && 'animate-pulse')}>
                <Building2 className="w-4 h-4 text-slate-400" />
                <span className="max-w-[160px] truncate">{session?.tenant?.name || 'Organisation'}</span>
                {warehouseIds && <span className="text-[10px] text-amber-700 bg-amber-50 rounded px-1">scoped</span>}
                <ChevronDown className="w-4 h-4 text-slate-400" />
              </button>
            )}
            items={(tenants.length ? tenants : session?.tenant ? [{ id: session.tenant.id, name: session.tenant.name, roleKeys: [] }] : []).map((t) => ({
              key: t.id,
              label: (
                <span className="flex items-center justify-between gap-3 w-full">
                  <span>
                    {t.name}
                    {t.roleKeys.length > 0 && <span className="block text-[11px] text-slate-400">{t.roleKeys.join(', ')}</span>}
                  </span>
                  {t.id === session?.tenant?.id && <Check className="w-4 h-4 text-brand-600" />}
                </span>
              ),
              onSelect: () => void switchTo(t.id),
            }))}
          />
        )}

        {quickCreate.some((i) => !i.hidden) && (
          <Dropdown
            trigger={({ toggle }) => (
              <button type="button" onClick={toggle} aria-label="Quick create" title="Quick create" className="h-9 w-9 rounded-lg bg-brand-600 text-white hover:bg-brand-700 flex items-center justify-center shadow-sm">
                <Plus className="w-5 h-5" />
              </button>
            )}
            items={quickCreate}
          />
        )}

        {settingsItems.some((i) => !i.hidden) && (
          <Dropdown
            trigger={({ toggle }) => (
              <button type="button" onClick={toggle} aria-label="Settings" title="Settings" className="h-9 w-9 rounded-lg flex items-center justify-center hover:bg-slate-100 text-slate-500">
                <Settings className="w-5 h-5" />
              </button>
            )}
            items={settingsItems}
          />
        )}

        <Dropdown
          trigger={({ toggle }) => (
            <button type="button" onClick={toggle} aria-label="Account" className={cn('h-9 w-9 rounded-full text-white text-xs font-semibold flex items-center justify-center hover:ring-2 hover:ring-brand-200', variant === 'platform' ? 'bg-violet-700' : 'bg-navy-800')}>
              {user ? initials(user.name) : '?'}
            </button>
          )}
          items={[
            {
              key: 'me',
              label: (
                <span>
                  <span className="block font-medium text-slate-800">{user?.name}</span>
                  <span className="block text-[11px] text-slate-400">{user?.email}</span>
                </span>
              ),
              onSelect: () => undefined,
              disabled: true,
            },
            { key: 'logout', label: 'Sign out', icon: LogOut, onSelect: () => void logout() },
          ]}
        />
      </div>
    </header>
  );
}

/* ---- layout ---------------------------------------------------------------- */

export function AppLayout({ children, variant = 'tenant' }: { children: ReactNode; variant?: LayoutVariant }) {
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === 'collapsed';
    } catch {
      return false;
    }
  });
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, c ? 'expanded' : 'collapsed');
      } catch {
        /* private mode */
      }
      return !c;
    });
  }, []);
  const closeDrawer = useCallback(() => setDrawer(false), []);
  const modules = variant === 'platform' ? PLATFORM_NAVIGATION : NAVIGATION;

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      <aside className={cn('hidden lg:block shrink-0 sticky top-0 h-screen transition-[width] duration-200', collapsed ? 'w-16' : 'w-60')}>
        <Sidebar modules={modules} variant={variant} collapsed={collapsed} onToggle={toggle} onNavigate={closeDrawer} />
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-navy-950/60" onClick={closeDrawer} />
          <aside className="absolute inset-y-0 left-0 w-72 shadow-xl">
            <Sidebar modules={modules} variant={variant} collapsed={false} onNavigate={closeDrawer} onClose={closeDrawer} />
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar onMenu={() => setDrawer(true)} variant={variant} />
        <main className="flex-1 px-4 sm:px-6 py-5 max-w-[1500px] w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
