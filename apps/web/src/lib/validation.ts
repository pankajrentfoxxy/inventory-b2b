/**
 * Web-side glue for the shared validation system.
 *
 * - Schemas and rules live in @b2b/shared; this file only maps errors onto react-hook-form and
 *   exposes typing-time sanitizers for controlled inputs.
 * - Use applyServerErrors after a failed mutation so API field errors land on the same inputs the
 *   zod resolver highlights. Use applyZodIssues when a form runs safeParse manually.
 */
import type { ChangeEvent } from 'react';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import type { ZodError } from 'zod';
import { MESSAGES, sanitizeInput, type InputSanitizer } from '@b2b/shared';
import type { ApiError } from './api';

export interface ServerErrorMapping {
  /** Rename an API path to a form path (e.g. "options" -> "optionsText"). Return null to drop it. */
  mapPath?: (path: string) => string | null;
}

/**
 * Pushes API validation details onto form fields. Returns messages that had no path (or were
 * dropped by mapPath) so the caller can toast them.
 */
export function applyServerErrors<T extends FieldValues>(setError: UseFormSetError<T>, error: ApiError, opts: ServerErrorMapping = {}): string[] {
  const unmapped: string[] = [];
  for (const d of error.details) {
    const path = d.path ? (opts.mapPath ? opts.mapPath(d.path) : d.path) : null;
    if (!path) {
      unmapped.push(d.message);
      continue;
    }
    setError(path as Path<T>, { type: 'server', message: d.message });
  }
  if (error.details.length === 0 && error.message) unmapped.push(error.message);
  return unmapped;
}

/** Same as applyServerErrors but for a zod safeParse failure run in the component. */
export function applyZodIssues<T extends FieldValues>(setError: UseFormSetError<T>, error: ZodError, opts: ServerErrorMapping = {}): string[] {
  const unmapped: string[] = [];
  const seen = new Set<string>();
  for (const issue of error.issues) {
    const raw = issue.path.join('.');
    const path = raw ? (opts.mapPath ? opts.mapPath(raw) : raw) : null;
    if (!path) {
      unmapped.push(issue.message);
      continue;
    }
    if (seen.has(path)) continue;
    seen.add(path);
    setError(path as Path<T>, { type: 'validate', message: issue.message });
  }
  return unmapped;
}

/** First toast-worthy message for a failed submit. */
export function summarizeErrors(unmapped: string[], fallback: string = MESSAGES.fixHighlighted): string {
  return unmapped[0] ?? fallback;
}

/**
 * Wraps a change handler so the input value is sanitized before anything (react-hook-form, local
 * state) reads it. Works for both registered and controlled inputs because the DOM value is
 * rewritten on the event target.
 */
export function sanitizeChange<E extends HTMLInputElement | HTMLTextAreaElement>(kind: InputSanitizer, onChange?: (e: ChangeEvent<E>) => void) {
  return (e: ChangeEvent<E>) => {
    const clean = sanitizeInput(kind, e.target.value);
    if (clean !== e.target.value) e.target.value = clean;
    onChange?.(e);
  };
}
