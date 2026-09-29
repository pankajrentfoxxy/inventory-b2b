import { useEffect, useState } from 'react';

/** Debounce a value; used for search boxes so the API is not hit on every keystroke. */
export function useDebouncedValue<T>(value: T, delay = 320): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
