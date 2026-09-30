import { useCallback, useRef } from 'react';

function newKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Non-secure contexts (plain http on a LAN address) lack randomUUID; a v4 built from Math.random is
  // fine here because the key only needs to be unique per submission, not unguessable.
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][Math.floor(Math.random() * 4)];
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

/**
 * Idempotency-Key per form submission (phase-plan/phase-00 step 7). The key is generated the first
 * time a payload is submitted and reused while the payload stays identical, so a retry after a
 * network failure or a 5xx replays the stored server response instead of creating a second record.
 * Call `reset()` after a definitive outcome (success or a 4xx) so the next submission gets a new key.
 */
export function useIdempotencyKey() {
  const current = useRef<{ key: string; fingerprint: string } | null>(null);

  const keyFor = useCallback((payload: unknown) => {
    const fingerprint = JSON.stringify(payload);
    if (!current.current || current.current.fingerprint !== fingerprint) current.current = { key: newKey(), fingerprint };
    return current.current.key;
  }, []);

  const reset = useCallback(() => {
    current.current = null;
  }, []);

  return { keyFor, reset };
}

/** True when the outcome of the request is unknown and the same key should be reused on retry. */
export function shouldRetryWithSameKey(status: number): boolean {
  return status === 0 || status >= 500;
}
