import type { ReactNode } from 'react';

export interface FilterChip {
  label: ReactNode;
  onClear: () => void;
}

/** Drops the falsy entries of a conditional chip list for ListToolbar. */
export function compactChips(chips: (FilterChip | null | false | undefined)[]): FilterChip[] {
  return chips.filter((c): c is FilterChip => Boolean(c));
}
