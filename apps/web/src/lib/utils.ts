import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return '-';
  // Date-only strings (YYYY-MM-DD) must not shift by timezone.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return dateFmt.format(new Date(`${value}T00:00:00`));
  return dateFmt.format(new Date(value));
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return '-';
  return dateTimeFmt.format(new Date(value));
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const moneyCache = new Map<string, Intl.NumberFormat>();
export function formatMoney(value: number | null | undefined, currency = 'INR', opts: { compact?: boolean } = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const key = `${currency}:${opts.compact ? 1 : 0}`;
  let fmt = moneyCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2, ...(opts.compact ? { notation: 'compact' } : {}) });
    moneyCache.set(key, fmt);
  }
  return fmt.format(value);
}

const qtyFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
export function formatQty(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return qtyFmt.format(value);
}

export function todayISO() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function humanize(code: string) {
  return code
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
