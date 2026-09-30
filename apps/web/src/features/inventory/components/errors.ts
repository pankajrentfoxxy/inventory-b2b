import type { ApiError } from '../../../lib/api';
import { formatQty } from '../../../lib/utils';

/**
 * Turns the inventory service's business-rule errors into a sentence for the toast / banner.
 * The raw `error.message` is still shown when nothing specific applies.
 */
export function describeInventoryError(error: ApiError): string {
  const d = error.details[0] as (Record<string, unknown> & { message?: string }) | undefined;
  switch (error.code) {
    case 'INSUFFICIENT_STOCK': {
      const available = typeof d?.available === 'number' ? formatQty(d.available) : null;
      const requested = typeof d?.requested === 'number' ? formatQty(d.requested) : null;
      const bucket = typeof d?.bucket === 'string' ? d.bucket.replace('_', ' ').toLowerCase() : 'stock';
      return available !== null && requested !== null ? `Not enough ${bucket}: ${available} available, ${requested} requested.` : error.message;
    }
    case 'INV_OPENING_NOT_ALLOWED':
      return 'This item already has stock movements in that warehouse, so opening stock cannot be recorded for it. Record an adjustment instead.';
    case 'SERIAL_DUPLICATE': {
      const dups = Array.isArray(d?.duplicates) ? (d.duplicates as string[]) : [];
      return dups.length ? `Serial${dups.length === 1 ? '' : 's'} already in stock: ${dups.join(', ')}` : error.message;
    }
    case 'SERIAL_COUNT_MISMATCH':
      return `Serial count does not match the quantity. ${error.message}`;
    case 'SERIAL_PATTERN_MISMATCH':
      return `A serial number does not match the item's pattern. ${error.message}`;
    case 'SERIAL_NOT_IN_EXPECTED_STATE': {
      const current = typeof d?.current === 'string' ? d.current : null;
      const expected = typeof d?.expected === 'string' ? d.expected : null;
      return current && expected ? `${error.message} (currently ${current}, expected ${expected}).` : error.message;
    }
    case 'INV_ADJUSTMENT_SELF_APPROVAL':
      return 'You raised this adjustment, so someone else must approve it.';
    case 'WAREHOUSE_SCOPE':
      return 'This warehouse is outside your scope. Ask an administrator to extend your warehouse access.';
    default:
      return error.message;
  }
}

/** Index of the document line an API detail path (`lines.3.qty`) points at, or null. */
export function lineIndexOf(path: string | undefined): number | null {
  if (!path) return null;
  const parts = path.split('.');
  if (parts[0] !== 'lines' || parts.length < 2) return null;
  const idx = Number(parts[1]);
  return Number.isInteger(idx) && idx >= 0 ? idx : null;
}
