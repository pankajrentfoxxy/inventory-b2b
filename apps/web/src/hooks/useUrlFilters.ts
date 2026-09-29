import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

type Primitive = string | number;

/**
 * URL-backed list state (search, filters, sort, page) so a view can be shared as a link.
 * Values equal to their default are omitted from the URL to keep it clean.
 */
export function useUrlFilters<T extends Record<string, Primitive>>(defaults: T) {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo(() => {
    const out = { ...defaults };
    (Object.keys(defaults) as (keyof T)[]).forEach((k) => {
      const raw = searchParams.get(k as string);
      if (raw === null) return;
      out[k] = (typeof defaults[k] === 'number' ? Number(raw) || defaults[k] : raw) as T[keyof T];
    });
    return out;
  }, [searchParams, defaults]);

  const setFilters = useCallback(
    (patch: Partial<T>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          Object.entries(patch).forEach(([k, v]) => {
            const isDefault = v === defaults[k] || v === '' || v == null;
            if (isDefault) next.delete(k);
            else next.set(k, String(v));
          });
          // Any change other than paging resets to page 1.
          if (!('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, defaults],
  );

  const reset = useCallback(() => setSearchParams(new URLSearchParams(), { replace: true }), [setSearchParams]);

  return { filters, setFilters, reset };
}
