import { useEffect, useRef, useState } from 'react';
import { Controller, useFormContext, type FieldErrors } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { AlertTriangle, CircleDollarSign, MapPin, Pencil, Plus, Settings } from 'lucide-react';
import { Field, IconButton, Input, SearchSelect, Select } from '../../../components/ui';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { usePermission } from '../../../lib/auth';
import { cn } from '../../../lib/utils';
import { useVendor, useVendors } from '../../vendors/hooks';
import type { VendorAddress } from '../../vendors/types';
import { usePurchaseOrders } from '../hooks';
import type { PoFormOptions } from '../types';
import { formatAddress, type DeliveryAddressFormValues, type PoFormValues } from './poForm.model';
import { PoNumberSettingsModal } from './PoNumberSettingsModal';

const stateLabel = (s: { short: string; name: string }) => `[${s.short}] - ${s.name}`;

function VendorAddressColumn({ title, address, editTo, canEdit }: { title: string; address: VendorAddress | undefined; editTo: string; canEdit: boolean }) {
  const lines = formatAddress(address);
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">{title}</p>
      {lines.length === 0 ? (
        canEdit ? (
          <Link to={editTo} className="text-sm text-brand-700 hover:underline">
            New Address
          </Link>
        ) : (
          <p className="text-sm text-slate-400">No address</p>
        )
      ) : (
        <div className="text-sm text-slate-700 leading-relaxed">
          {lines.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
          {canEdit && (
            <Link to={editTo} className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline mt-1">
              <Pencil className="w-3 h-3" /> Edit
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/** Vendor block shown once a vendor is picked: Zoho's addresses, GST treatment, GSTIN and open-PO warning. */
function VendorSummary({ vendorId, editingPoId }: { vendorId: string; editingPoId?: string }) {
  const { canEditVendor } = usePermission();
  const vendor = useVendor(vendorId);
  const openPos = usePurchaseOrders({ page: 1, limit: 1, status: 'OPEN', vendorId, sortBy: 'createdAt', sortOrder: 'desc' });
  if (!vendor.data) return null;
  const v = vendor.data;
  const billing = v.addresses.find((a) => a.type === 'BILLING' && a.isPrimary) ?? v.addresses.find((a) => a.type === 'BILLING');
  const shipping = v.addresses.find((a) => a.type === 'SHIPPING' && a.isPrimary) ?? v.addresses.find((a) => a.type === 'SHIPPING');
  const editTo = `/purchases/vendors/${v.id}/edit`;
  const openCount = (openPos.data?.pagination.total ?? 0) - (editingPoId && openPos.data?.data.some((p) => p.id === editingPoId) ? 1 : 0);

  return (
    <div className="space-y-4 pt-1">
      {openCount > 0 && (
        <Link to={`/purchases/purchase-orders?status=OPEN&vendorId=${v.id}`} className="inline-flex items-center gap-1.5 text-sm text-slate-800 hover:text-brand-700">
          <span className="w-4 h-4 rounded-sm bg-amber-500 text-white flex items-center justify-center">
            <AlertTriangle className="w-3 h-3" />
          </span>
          Open Purchase Orders <span className="text-slate-500">({openCount})</span>
        </Link>
      )}
      {v.status === 'INACTIVE' && <p className="text-sm text-amber-700">This vendor is inactive.</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <VendorAddressColumn title="Billing Address" address={billing} editTo={editTo} canEdit={canEditVendor} />
        <VendorAddressColumn title="Shipping Address" address={shipping} editTo={editTo} canEdit={canEditVendor} />
      </div>
      <div className="text-sm space-y-1">
        <p>
          <span className="text-slate-500">GST Treatment:</span> <span className="text-slate-900">{v.gstTreatment?.name ?? 'Not set'}</span>
          {canEditVendor && (
            <Link to={editTo} className="inline-flex align-middle ml-1.5 text-brand-600" aria-label="Edit GST treatment">
              <Pencil className="w-3.5 h-3.5" />
            </Link>
          )}
        </p>
        <p>
          <span className="text-slate-500">GSTIN:</span>{' '}
          {v.gstin ? <span className="font-mono text-slate-900">{v.gstin}</span> : <span className="text-slate-400">Not provided</span>}
          {canEditVendor && (
            <Link to={editTo} className="inline-flex align-middle ml-1.5 text-brand-600" aria-label="Edit GSTIN">
              <Pencil className="w-3.5 h-3.5" />
            </Link>
          )}
        </p>
      </div>
    </div>
  );
}

export function PoHeaderFields({ options, editing, locked, poId }: { options: PoFormOptions; editing: boolean; locked: { vendor: boolean }; poId?: string }) {
  const { register, control, watch, setValue, getValues, formState: { errors } } = useFormContext<PoFormValues>();
  const { canCreateVendor } = usePermission();
  const [vendorTerm, setVendorTerm] = useState('');
  const debounced = useDebouncedValue(vendorTerm, 250);
  const vendors = useVendors({ page: 1, limit: 15, search: debounced, status: 'ACTIVE', sortBy: 'displayName', sortOrder: 'asc', gstTreatmentId: '', sourceOfSupplyId: '', vendorType: '', tagOptionId: '' });
  const vendorId = watch('vendorId');
  const vendor = useVendor(vendorId || undefined);
  const [numberModal, setNumberModal] = useState(false);

  // When the vendor changes: adopt its payment term (if none set) and its state as Source of Supply.
  const lastVendorRef = useRef<string | null>(editing ? vendorId : null);
  useEffect(() => {
    if (!vendor.data) return;
    if (vendor.data.paymentTermId && !getValues('paymentTermId')) setValue('paymentTermId', vendor.data.paymentTermId, { shouldDirty: true });
    const changed = lastVendorRef.current !== vendor.data.id;
    lastVendorRef.current = vendor.data.id;
    if (changed || !getValues('sourceOfSupplyCode')) {
      setValue('sourceOfSupplyCode', vendor.data.sourceOfSupply?.code ?? '', { shouldDirty: true, shouldValidate: true });
    }
  }, [vendor.data, getValues, setValue]);

  const deliveryType = watch('deliveryType');
  const deliveryLocationId = watch('deliveryLocationId');
  const customState = watch('deliveryAddress.stateCode');
  const deliveryLocation = options.locations.find((l) => l.id === deliveryLocationId);

  // Destination of Supply follows the delivery address whenever it changes.
  const deliveryState = deliveryType === 'LOCATION' ? (deliveryLocation?.stateCode ?? '') : customState;
  const lastDeliveryStateRef = useRef<string | null>(editing ? deliveryState : null);
  useEffect(() => {
    if (lastDeliveryStateRef.current === deliveryState) return;
    lastDeliveryStateRef.current = deliveryState;
    if (deliveryState) setValue('destinationOfSupplyCode', deliveryState, { shouldDirty: true });
  }, [deliveryState, setValue]);

  const poNumber = watch('purchaseOrderNumber');
  const addrErr = (errors.deliveryAddress ?? {}) as FieldErrors<DeliveryAddressFormValues>;

  const switchToCustom = () => {
    const l = deliveryLocation;
    setValue('deliveryType', 'CUSTOM', { shouldDirty: true });
    setValue('deliveryAddress', {
      attention: l?.attention ?? l?.name ?? '',
      addressLine1: l?.addressLine1 ?? '',
      addressLine2: l?.addressLine2 ?? '',
      city: l?.city ?? '',
      state: l?.state ?? '',
      stateCode: l?.stateCode ?? '',
      postalCode: l?.postalCode ?? '',
      countryCode: l?.countryCode ?? 'IN',
      phone: l?.phone ?? '',
    });
  };

  const stateOptions = options.indianStates.map((s) => ({ value: s.code, label: stateLabel(s) }));
  const inline = 'md:grid-cols-[180px_minmax(0,560px)]';

  return (
    <div className="space-y-5">
      {/* Zoho's grey band: vendor, supply states, location */}
      <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-4 space-y-4">
        <Field label="Vendor Name" required inline error={errors.vendorId?.message} className={inline}>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Controller
                control={control}
                name="vendorId"
                render={({ field }) => (
                  <SearchSelect
                    id="vendorId"
                    className="flex-1"
                    value={field.value}
                    selectedLabel={watch('vendorName')}
                    disabled={locked.vendor}
                    allowClear={!locked.vendor}
                    onChange={(v, o) => {
                      field.onChange(v);
                      setValue('vendorName', o?.label ?? '');
                      setValue('paymentTermId', '', { shouldDirty: true });
                      if (!v) setValue('sourceOfSupplyCode', '', { shouldDirty: true });
                    }}
                    onSearch={setVendorTerm}
                    loading={vendors.isFetching}
                    placeholder="Select a Vendor"
                    error={Boolean(errors.vendorId)}
                    options={(vendors.data?.data ?? []).map((v) => ({ value: v.id, label: v.displayName, description: [v.companyName, v.gstin].filter(Boolean).join(' - ') || undefined }))}
                    footer={
                      canCreateVendor
                        ? () => (
                            <Link to="/purchases/vendors/new" className="flex items-center gap-1.5 px-2 py-1.5 text-sm text-brand-700 hover:underline">
                              <Plus className="w-4 h-4" /> New Vendor
                            </Link>
                          )
                        : undefined
                    }
                  />
                )}
              />
              {vendor.data && (
                <span className="inline-flex items-center gap-1 h-9 px-3 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 shrink-0" title="Vendor currency">
                  <CircleDollarSign className="w-4 h-4 text-emerald-600" /> {vendor.data.currencyCode}
                </span>
              )}
            </div>
            {locked.vendor && <p className="text-xs text-slate-500">The vendor cannot be changed after goods have been received against this order.</p>}
            {vendorId && <VendorSummary vendorId={vendorId} editingPoId={poId} />}
          </div>
        </Field>

        <Field label="Source of Supply" required inline htmlFor="sourceOfSupplyCode" error={errors.sourceOfSupplyCode?.message} hint="State the goods are supplied from. Defaults to the vendor's source of supply." className={inline}>
          <div className="sm:max-w-md"><Select id="sourceOfSupplyCode" placeholder="Select a state" options={stateOptions} error={Boolean(errors.sourceOfSupplyCode)} {...register('sourceOfSupplyCode')} /></div>
        </Field>
        <Field label="Destination of Supply" required inline htmlFor="destinationOfSupplyCode" error={errors.destinationOfSupplyCode?.message} hint="State the goods are delivered to. Defaults to the delivery address. Same state as the source means CGST + SGST, otherwise IGST." className={inline}>
          <div className="sm:max-w-md"><Select id="destinationOfSupplyCode" placeholder="Select a state" options={stateOptions} error={Boolean(errors.destinationOfSupplyCode)} {...register('destinationOfSupplyCode')} /></div>
        </Field>
        <Field label="Location" inline htmlFor="locationId" error={errors.locationId?.message} hint="Warehouse or office this purchase is for." className={inline}>
          <div className="sm:max-w-md"><Select id="locationId" placeholder="Select a location" options={options.locations.map((l) => ({ value: l.id, label: l.name }))} {...register('locationId')} /></div>
        </Field>
      </div>

      <Field label="Delivery Address" required inline error={errors.deliveryLocationId?.message} className={inline}>
        <div className="space-y-3">
          <div className="flex items-center gap-5 text-sm">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="radio" className="h-4 w-4 text-brand-600" checked={deliveryType === 'LOCATION'} onChange={() => setValue('deliveryType', 'LOCATION', { shouldDirty: true })} />
              Locations
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="radio" className="h-4 w-4 text-brand-600" checked={deliveryType === 'CUSTOM'} onChange={switchToCustom} />
              Other address
            </label>
          </div>

          {deliveryType === 'LOCATION' ? (
            <>
              <Select aria-label="Delivery location" placeholder="Select a location" error={Boolean(errors.deliveryLocationId)} options={options.locations.map((l) => ({ value: l.id, label: `${l.name}${l.type === 'WAREHOUSE' ? ' (Warehouse)' : ''}` }))} {...register('deliveryLocationId')} />
              {deliveryLocation && (
                <div className="text-sm text-slate-700">
                  <p className="font-medium text-slate-900 flex items-center gap-2">
                    {deliveryLocation.attention ?? deliveryLocation.name}
                    <IconButton icon={Pencil} label="Change destination to deliver" size="xs" onClick={switchToCustom} className="text-brand-600" />
                  </p>
                  {formatAddress({ ...deliveryLocation, attention: null }).length === 0 ? (
                    <p className="text-xs text-amber-700 mt-1">This location has no address yet. Add one under Settings, or use another address.</p>
                  ) : (
                    formatAddress({ ...deliveryLocation, attention: null }).map((l, i) => (
                      <p key={i} className="text-slate-600">
                        {l}
                      </p>
                    ))
                  )}
                  <button type="button" onClick={switchToCustom} className="mt-1 text-xs text-brand-700 hover:underline">
                    Change destination to deliver
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-lg border border-slate-200 p-3 space-y-2">
              <Input placeholder="Attention" aria-label="Attention" error={Boolean(addrErr.attention)} {...register('deliveryAddress.attention')} />
              <Input placeholder="Street 1" aria-label="Address line 1" error={Boolean(addrErr.addressLine1)} {...register('deliveryAddress.addressLine1')} />
              {addrErr.addressLine1?.message && <p className="text-xs text-red-600">{addrErr.addressLine1.message}</p>}
              <Input placeholder="Street 2" aria-label="Address line 2" {...register('deliveryAddress.addressLine2')} />
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="City" aria-label="City" {...register('deliveryAddress.city')} />
                <Select
                  aria-label="State"
                  placeholder="State"
                  value={watch('deliveryAddress.stateCode')}
                  onChange={(e) => {
                    const st = options.indianStates.find((s) => s.code === e.target.value);
                    setValue('deliveryAddress.stateCode', st?.code ?? '', { shouldDirty: true });
                    setValue('deliveryAddress.state', st?.name ?? '', { shouldDirty: true });
                  }}
                  options={options.indianStates.map((s) => ({ value: s.code, label: s.name }))}
                />
                <Input placeholder="PIN Code" aria-label="PIN code" sanitize="pincode" error={Boolean(addrErr.postalCode)} {...register('deliveryAddress.postalCode')} />
                <Input placeholder="Phone" aria-label="Phone" sanitize="phone" maxLength={20} error={Boolean(addrErr.phone)} {...register('deliveryAddress.phone')} />
              </div>
              {addrErr.postalCode?.message && <p className="text-xs text-red-600">{addrErr.postalCode.message}</p>}
              <button type="button" onClick={() => setValue('deliveryType', 'LOCATION', { shouldDirty: true })} className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline">
                <MapPin className="w-3.5 h-3.5" /> Use a saved location instead
              </button>
            </div>
          )}
        </div>
      </Field>

      <Field label="Purchase Order#" required inline error={errors.purchaseOrderNumber?.message} className="md:grid-cols-[180px_minmax(0,420px)]">
        <div className="flex items-center gap-2">
          <Input value={poNumber || (editing ? '' : `${options.nextNumber.preview}`)} readOnly aria-label="Purchase order number" className={cn('font-mono', !poNumber && 'text-slate-500')} />
          <IconButton icon={Settings} label="Configure purchase order number" onClick={() => setNumberModal(true)} className="border border-slate-300 bg-white text-brand-600" />
        </div>
        {!poNumber && !editing && <p className="text-xs text-slate-500 mt-1">Auto-generated when you save.</p>}
      </Field>

      <Field label="Reference#" inline htmlFor="referenceNumber" error={errors.referenceNumber?.message} className="md:grid-cols-[180px_minmax(0,420px)]">
        <Input id="referenceNumber" sanitize="singleLine" maxLength={60} error={Boolean(errors.referenceNumber)} {...register('referenceNumber')} />
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-[180px_minmax(0,560px)] gap-1 md:gap-4">
        <div />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Date" required htmlFor="orderDate" error={errors.orderDate?.message}>
            <Input id="orderDate" type="date" error={Boolean(errors.orderDate)} {...register('orderDate')} />
          </Field>
          <Field label="Expected Delivery Date" htmlFor="expectedDeliveryDate" error={errors.expectedDeliveryDate?.message}>
            <Input id="expectedDeliveryDate" type="date" error={Boolean(errors.expectedDeliveryDate)} {...register('expectedDeliveryDate')} />
          </Field>
          <Field label="Payment Terms" htmlFor="paymentTermId" error={errors.paymentTermId?.message}>
            <Select id="paymentTermId" placeholder="Select terms" options={options.paymentTerms.map((p) => ({ value: p.id, label: p.name }))} {...register('paymentTermId')} />
          </Field>
          <Field label="Shipment Preference" htmlFor="shipmentPreference" error={errors.shipmentPreference?.message}>
            <Input id="shipmentPreference" placeholder="e.g. Road, Courier, Vendor delivery" sanitize="singleLine" maxLength={100} {...register('shipmentPreference')} />
          </Field>
        </div>
      </div>

      <PoNumberSettingsModal open={numberModal} onClose={() => setNumberModal(false)} sequence={options.nextNumber} manualValue={poNumber} onApply={(v) => setValue('purchaseOrderNumber', v, { shouldDirty: true })} />
    </div>
  );
}
