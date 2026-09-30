import { Star } from 'lucide-react';
import { Badge, PageHeader } from '../../../components/ui';
import { humanize } from '../../../lib/utils';
import { CUSTOM_FIELD_DATA_TYPES, CUSTOM_FIELD_ENTITIES, type ConditionGrade, type CustomFieldDef, type PaymentTerm, type WarrantyPolicy } from '../types';
import { SimpleMasterCard } from '../components/SimpleMasterCard';
import type { FieldSpec } from '../components/SimpleFormModal';

const PAYMENT_TERM_FIELDS: FieldSpec[] = [
  { name: 'name', label: 'Name', type: 'text', sanitize: 'singleLine', maxLength: 60, required: true, hint: 'e.g. Net 30' },
  { name: 'days', label: 'Days', type: 'number', integer: true, min: 0, required: true, hint: '0 = due on receipt' },
  { name: 'isDefault', label: 'Default term', type: 'checkbox', description: 'Pre-selected on new vendors and customers', span: 2 },
];
const GRADE_FIELDS: FieldSpec[] = [
  { name: 'code', label: 'Code', type: 'text', sanitize: 'upper', maxLength: 10, required: true, mono: true, hint: 'e.g. NEW, A+, B, SCRAP' },
  { name: 'name', label: 'Name', type: 'text', sanitize: 'singleLine', maxLength: 50, required: true },
  { name: 'sortOrder', label: 'Sort order', type: 'number', integer: true, min: 0, defaultValue: '0', hint: 'Lower sorts first' },
  { name: 'sellable', label: 'Sellable', type: 'checkbox', defaultValue: true, description: 'Stock in this grade can be sold' },
];
const WARRANTY_FIELDS: FieldSpec[] = [
  { name: 'name', label: 'Name', type: 'text', sanitize: 'singleLine', maxLength: 100, required: true, span: 2 },
  { name: 'durationMonths', label: 'Duration (months)', type: 'number', integer: true, min: 0, required: true },
  { name: 'startsOn', label: 'Starts on', type: 'select', required: true, defaultValue: 'INVOICE_DATE', options: [{ value: 'INVOICE_DATE', label: 'Invoice date' }, { value: 'DELIVERY_DATE', label: 'Delivery date' }] },
  { name: 'terms', label: 'Terms', type: 'textarea', maxLength: 5000, rows: 4 },
];
const CUSTOM_FIELD_FIELDS: FieldSpec[] = [
  { name: 'entity', label: 'Entity', type: 'select', required: true, placeholder: 'Select an entity', options: CUSTOM_FIELD_ENTITIES.map((e) => ({ value: e, label: humanize(e) })) },
  { name: 'dataType', label: 'Data type', type: 'select', required: true, placeholder: 'Select a type', options: CUSTOM_FIELD_DATA_TYPES.map((t) => ({ value: t, label: humanize(t) })) },
  { name: 'key', label: 'Key', type: 'text', sanitize: 'singleLine', maxLength: 40, required: true, mono: true, hint: 'Stable identifier stored with each record, e.g. warranty_card_no' },
  { name: 'label', label: 'Label', type: 'text', sanitize: 'singleLine', maxLength: 100, required: true },
  { name: 'options', label: 'Options', type: 'lines', hint: 'For SELECT fields: one option per line' },
  { name: 'required', label: 'Required', type: 'checkbox', description: 'Records cannot be saved without a value', span: 2 },
];

export function OtherMastersPage() {
  return (
    <>
      <PageHeader title="Terms, Grades & Fields" breadcrumbs={[{ label: 'Masters' }, { label: 'Terms, Grades & Fields' }]} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <SimpleMasterCard<'payment-terms'>
          kind="payment-terms"
          title="Payment terms"
          noun="Payment term"
          description="Credit periods offered to customers and agreed with vendors."
          columns={[
            { key: 'name', header: 'Name', render: (p: PaymentTerm) => <span className="inline-flex items-center gap-2 font-medium text-slate-900">{p.name}{p.isDefault && <Badge tone="amber"><Star className="w-3 h-3" /> Default</Badge>}</span> },
            { key: 'days', header: 'Days', align: 'right', width: '80px', render: (p: PaymentTerm) => <span className="tabular">{p.days}</span> },
          ]}
          fields={PAYMENT_TERM_FIELDS}
          rowLabel={(p) => p.name}
        />
        <SimpleMasterCard<'condition-grades'>
          kind="condition-grades"
          title="Condition grades"
          noun="Condition grade"
          description="Quality grades assigned during QC; stock is tracked per grade."
          columns={[
            { key: 'code', header: 'Code', width: '90px', render: (g: ConditionGrade) => <span className="font-mono text-[13px]">{g.code}</span> },
            { key: 'name', header: 'Name', render: (g: ConditionGrade) => <span className="font-medium text-slate-900">{g.name}</span> },
            { key: 'sellable', header: 'Sellable', width: '90px', render: (g: ConditionGrade) => (g.sellable ? <Badge tone="green">Yes</Badge> : <Badge tone="gray">No</Badge>) },
            { key: 'sortOrder', header: 'Order', align: 'right', width: '70px', hideBelow: 'md', render: (g: ConditionGrade) => <span className="tabular">{g.sortOrder}</span> },
          ]}
          fields={GRADE_FIELDS}
          rowLabel={(g) => `${g.code} ${g.name}`}
        />
        <SimpleMasterCard<'warranty-policies'>
          kind="warranty-policies"
          title="Warranty policies"
          noun="Warranty policy"
          description="Default warranty attached to products and carried onto invoices."
          columns={[
            { key: 'name', header: 'Name', render: (w: WarrantyPolicy) => <span className="font-medium text-slate-900">{w.name}</span> },
            { key: 'duration', header: 'Duration', align: 'right', width: '100px', render: (w: WarrantyPolicy) => <span className="tabular">{w.durationMonths} mo</span> },
            { key: 'startsOn', header: 'Starts on', hideBelow: 'md', render: (w: WarrantyPolicy) => <span className="text-slate-700">{humanize(w.startsOn)}</span> },
          ]}
          fields={WARRANTY_FIELDS}
          rowLabel={(w) => w.name}
        />
        <SimpleMasterCard<'custom-fields'>
          kind="custom-fields"
          title="Custom fields"
          noun="Custom field"
          description="Extra attributes captured on products, parties and documents."
          columns={[
            { key: 'entity', header: 'Entity', width: '130px', render: (c: CustomFieldDef) => <Badge tone="blue">{humanize(c.entity)}</Badge> },
            { key: 'label', header: 'Label', render: (c: CustomFieldDef) => <div className="min-w-0"><p className="font-medium text-slate-900">{c.label}</p><p className="text-xs text-slate-500 font-mono">{c.key}</p></div> },
            { key: 'dataType', header: 'Type', width: '90px', render: (c: CustomFieldDef) => <span className="text-slate-700">{humanize(c.dataType)}{c.dataType === 'SELECT' && c.options?.length ? ` (${c.options.length})` : ''}</span> },
            { key: 'required', header: 'Required', width: '90px', hideBelow: 'md', render: (c: CustomFieldDef) => (c.required ? <Badge tone="amber">Required</Badge> : <span className="text-slate-400 text-xs">Optional</span>) },
          ]}
          fields={CUSTOM_FIELD_FIELDS}
          rowLabel={(c) => c.label}
        />
      </div>
    </>
  );
}
