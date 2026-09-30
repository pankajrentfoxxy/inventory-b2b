import { useMemo } from 'react';
import { Badge, PageHeader } from '../../../components/ui';
import { formatDate, todayISO } from '../../../lib/utils';
import { useSimpleMaster } from '../hooks';
import { GST_SLABS, type HsnCode, type TaxRate } from '../types';
import { SimpleMasterCard } from '../components/SimpleMasterCard';
import type { FieldSpec } from '../components/SimpleFormModal';

const TAX_FIELDS: FieldSpec[] = [
  { name: 'name', label: 'Name', type: 'text', sanitize: 'singleLine', maxLength: 50, required: true, span: 2 },
  { name: 'gstRate', label: 'GST rate', type: 'select', required: true, numeric: true, placeholder: 'Select a slab', options: GST_SLABS.map((s) => ({ value: String(s), label: `${s}%` })), hint: 'Only the notified slabs are accepted' },
  { name: 'cessRate', label: 'Cess rate', type: 'number', defaultValue: '0', suffix: '%' },
  { name: 'effectiveFrom', label: 'Effective from', type: 'date', required: true, defaultValue: todayISO() },
  { name: 'effectiveTo', label: 'Effective to', type: 'date', hint: 'Leave empty for an open-ended rate' },
];

export function TaxPage() {
  const taxRates = useSimpleMaster('tax-rates', false);
  const hsnFields = useMemo<FieldSpec[]>(
    () => [
      { name: 'code', label: 'Code', type: 'text', sanitize: 'hsn', required: true, mono: true, hint: '4, 6 or 8 digits' },
      { name: 'kind', label: 'Kind', type: 'select', required: true, defaultValue: 'HSN', options: [{ value: 'HSN', label: 'HSN (goods)' }, { value: 'SAC', label: 'SAC (services)' }] },
      { name: 'description', label: 'Description', type: 'text', sanitize: 'singleLine', maxLength: 300, span: 2 },
      { name: 'defaultTaxRateId', label: 'Default tax rate', type: 'select', nullable: true, placeholder: 'None', options: (taxRates.data ?? []).map((t) => ({ value: t.id, label: `${t.name} (${Number(t.gstRate)}%)` })), span: 2, hint: 'Pre-selected on products that use this code' },
    ],
    [taxRates.data],
  );
  const taxName = (id: string | null) => (id ? taxRates.data?.find((t) => t.id === id)?.name ?? '...' : null);

  return (
    <>
      <PageHeader title="Tax & HSN" breadcrumbs={[{ label: 'Masters' }, { label: 'Tax & HSN' }]} subtitle="Verify the GST slabs with your CA before go-live." />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <SimpleMasterCard<'tax-rates'>
          kind="tax-rates"
          title="Tax rates"
          noun="Tax rate"
          description="GST slabs (plus cess) applied on laptop lines."
          className="xl:col-span-2"
          columns={[
            { key: 'name', header: 'Name', render: (t: TaxRate) => <span className="font-medium text-slate-900">{t.name}</span> },
            { key: 'gstRate', header: 'GST', align: 'right', width: '80px', render: (t: TaxRate) => <span className="tabular">{Number(t.gstRate)}%</span> },
            { key: 'cessRate', header: 'Cess', align: 'right', width: '80px', hideBelow: 'md', render: (t: TaxRate) => <span className="tabular">{Number(t.cessRate) > 0 ? `${Number(t.cessRate)}%` : <span className="text-slate-300">-</span>}</span> },
            { key: 'effective', header: 'Effective', hideBelow: 'lg', render: (t: TaxRate) => <span className="text-xs text-slate-600">{formatDate(t.effectiveFrom)}{t.effectiveTo ? ` to ${formatDate(t.effectiveTo)}` : ''}</span> },
          ]}
          fields={TAX_FIELDS}
          rowLabel={(t) => t.name}
        />
        <SimpleMasterCard<'hsn-codes'>
          kind="hsn-codes"
          title="HSN / SAC codes"
          noun="HSN code"
          description="Harmonised codes for goods (HSN) and services (SAC)."
          className="xl:col-span-2"
          columns={[
            { key: 'code', header: 'Code', width: '110px', render: (h: HsnCode) => <span className="font-mono text-[13px] tabular">{h.code}</span> },
            { key: 'kind', header: 'Kind', width: '80px', render: (h: HsnCode) => <Badge tone={h.kind === 'SAC' ? 'purple' : 'blue'}>{h.kind}</Badge> },
            { key: 'description', header: 'Description', render: (h: HsnCode) => <span className="text-slate-800">{h.description ?? <span className="text-slate-300">-</span>}</span> },
            { key: 'tax', header: 'Default tax', hideBelow: 'md', render: (h: HsnCode) => <span className="text-slate-800">{taxName(h.defaultTaxRateId) ?? <span className="text-slate-300">-</span>}</span> },
          ]}
          fields={hsnFields}
          rowLabel={(h) => h.code}
        />
      </div>
    </>
  );
}
