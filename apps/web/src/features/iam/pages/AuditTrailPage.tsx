import { useEffect, useMemo, useState } from 'react';
import { Button, Field, Input, PageHeader } from '../../../components/ui';
import { useUrlFilters } from '../../../hooks/useUrlFilters';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useTenantAudit } from '../hooks';
import type { AuditQuery } from '../types';
import { AuditTrailView } from '../components/AuditTrailView';

const DEFAULTS = { entityType: '', action: '', entityId: '' };

/** Free-text filters: the audit service matches `action` / `entityType` exactly, so the values are upper-cased codes. */
function AuditFilters({ filters, onChange, onReset }: { filters: typeof DEFAULTS; onChange: (patch: Partial<typeof DEFAULTS>) => void; onReset: () => void }) {
  const [local, setLocal] = useState(filters);
  const debounced = useDebouncedValue(local, 400);
  useEffect(() => {
    if (debounced.entityType !== filters.entityType || debounced.action !== filters.action || debounced.entityId !== filters.entityId) onChange(debounced);
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasAny = Boolean(filters.entityType || filters.action || filters.entityId);
  return (
    <>
      <Field label="Entity type" htmlFor="audit-entity" className="w-44">
        <Input id="audit-entity" sanitize="upper" placeholder="e.g. MEMBERSHIP" value={local.entityType} onChange={(e) => setLocal((l) => ({ ...l, entityType: e.target.value }))} />
      </Field>
      <Field label="Action" htmlFor="audit-action" className="w-52">
        <Input id="audit-action" sanitize="upper" placeholder="e.g. ROLE_CREATED" value={local.action} onChange={(e) => setLocal((l) => ({ ...l, action: e.target.value }))} />
      </Field>
      <Field label="Entity id" htmlFor="audit-entity-id" className="w-72">
        <Input id="audit-entity-id" placeholder="UUID" className="font-mono" value={local.entityId} onChange={(e) => setLocal((l) => ({ ...l, entityId: e.target.value.trim() }))} />
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

export function AuditTrailPage() {
  const { filters, setFilters, reset } = useUrlFilters(DEFAULTS);
  const q = useMemo<AuditQuery>(() => ({ limit: 50, ...(filters.entityType ? { entityType: filters.entityType } : {}), ...(filters.action ? { action: filters.action } : {}), ...(filters.entityId ? { entityId: filters.entityId } : {}) }), [filters]);
  const query = useTenantAudit(q);
  return (
    <>
      <PageHeader title="Audit Trail" subtitle="Every recorded change in your organisation, newest first. Entries are append-only." breadcrumbs={[{ label: 'Settings', to: '/settings/members' }, { label: 'Audit Trail' }]} />
      <AuditTrailView query={query} filters={<AuditFilters filters={filters} onChange={setFilters} onReset={reset} />} />
    </>
  );
}
