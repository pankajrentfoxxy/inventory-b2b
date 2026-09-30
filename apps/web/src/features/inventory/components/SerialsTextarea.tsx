import { Textarea } from '../../../components/ui';
import { cn } from '../../../lib/utils';

/** One serial per line (commas, semicolons and tabs also separate). Trimmed, empties dropped. */
export function parseSerials(text: string): string[] {
  return text
    .split('\n')
    .flatMap((line) => line.split(','))
    .flatMap((part) => part.split(';'))
    .flatMap((part) => part.split('\t'))
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Serial capture for serialized items: a textarea plus a live "n of qty" counter. The API is the
 * validator (SERIAL_COUNT_MISMATCH, SERIAL_DUPLICATE, ...); the counter is only a typing aid.
 */
export function SerialsTextarea({ value, onChange, expected, error, disabled, rows = 3, id, placeholder = 'One serial number per line' }: { value: string; onChange: (text: string) => void; expected: number; error?: string; disabled?: boolean; rows?: number; id?: string; placeholder?: string }) {
  const count = parseSerials(value).length;
  const matches = expected > 0 && count === expected;
  return (
    <div>
      <Textarea id={id} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} error={Boolean(error)} className="font-mono text-xs" />
      <div className="flex items-center justify-between mt-1 text-xs">
        <span className={cn(matches ? 'text-emerald-700' : count === 0 ? 'text-slate-500' : 'text-amber-700')}>
          {count} of {expected > 0 ? expected : '-'} serial{expected === 1 ? '' : 's'}
        </span>
        {error && (
          <span className="text-red-600" role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
