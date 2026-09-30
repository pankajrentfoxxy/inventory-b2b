import { useEffect, useMemo, useState } from 'react';
import { Button, Field, Input, PageHeader } from '../../../components/ui';
import { useUrlFilters } from '../../../hooks/useUrlFilters';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import type { AuditQuery } from '../../iam/types';
import { AuditTrailView } from '../../iam/components/AuditTrailView';
import { usePlatformAudit } from '../hooks';

const DEFAULTS = { tenantId: '', entityType: '', action: '' };

function Filters({ filters, onChange, onReset }: { filters: typeof DEFAULTS; onChange: (patch: Partial<typeof DEFAULTS>) => void; onReset: () => void }) {
  const [local, setLocal] = useState(filters);
  const debounced = useDebouncedValue(local, 400);
  useEffect(() => {
    if (debounced.tenantId !== filters.tenantId || debounced.entityType !== filters.entityType || debounced.action !== filters.action) onChange(debounced);
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasAny = Boolean(filters.tenantId || filters.entityType || filters.action);
  return (
    <>
      <Field label="Tenant id" htmlFor="paudit-tenant" className="w-72">
        <Input id="paudit-tenant" placeholder="UUID (blank = all tenants)" className="font-mono" value={local.tenantId} onChange={(e) => setLocal((l) => ({ ...l, tenantId: e.target.value.trim() }))} />
      </Field>
      <Field label="Entity type" htmlFor="paudit-entity" className="w-44">
        <Input id="paudit-entity" sanitize="upper" placeholder="e.g. TENANT" value={local.entityType} onChange={(e) => setLocal((l) => ({ ...l, entityType: e.target.value }))} />
      </Field>
      <Field label="Action" htmlFor="paudit-action" className="w-52">
        <Input id="paudit-action" sanitize="upper" placeholder="e.g. TENANT_APPROVED" value={local.action} onChange={(e) => setLocal((l) => ({ ...l, action: e.target.value }))} />
      </Field>
      {hasAny && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setLocal(DEFAULTS);
            onReset();
          }}
        >
          Clear
        </Button>
      )}
    </>
  );
}

/** GET /v1/platform/audit (svc-tenant proxies svc-audit with a service token). */
export function PlatformAuditPage() {
  const { filters, setFilters, reset } = useUrlFilters(DEFAULTS);
  const q = useMemo<AuditQuery>(() => ({ limit: 50, ...(filters.tenantId ? { tenantId: filters.tenantId } : {}), ...(filters.entityType ? { entityType: filters.entityType } : {}), ...(filters.action ? { action: filters.action } : {}) }), [filters]);
  const query = usePlatformAudit(q);
  return (
    <>
      <PageHeader title="Platform Audit Trail" subtitle="Audit events across every tenant and the platform itself, newest first." breadcrumbs={[{ label: 'Platform', to: '/admin' }, { label: 'Audit Trail' }]} />
      <AuditTrailView query={query} filters={<Filters filters={filters} onChange={setFilters} onReset={reset} />} />
    </>
  );
}
