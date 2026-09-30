import type { ReactNode } from 'react';

/** A feature module exports its pages as route definitions; App.tsx mounts them inside the shell. */
export interface RouteDef {
  path: string;
  element: ReactNode;
  /** One of these permissions is required (legacy codes are accepted). */
  permission?: string | readonly string[];
}
