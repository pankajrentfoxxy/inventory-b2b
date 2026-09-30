import { Router } from 'express';
import { errorBody } from './errors.js';
import { asyncHandler } from './http.js';

const CHECK_TIMEOUT_MS = 2_000;
export type HealthChecks = Record<string, () => Promise<void>>;

function withTimeout(run: () => Promise<void>, ms: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    run().then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/** `/live` says the process is up; `/ready` checks dependencies and answers 503 (retryable) when any is down. */
export function createHealthRouter(service: string, checks: HealthChecks) {
  const router = Router();
  router.get('/live', (_req, res) => res.json({ status: 'ok', service, time: new Date().toISOString() }));
  router.get(
    '/ready',
    asyncHandler(async (req, res) => {
      const results = await Promise.all(
        Object.entries(checks).map(async ([name, run]) => {
          try {
            await withTimeout(run, CHECK_TIMEOUT_MS);
            return { name, ok: true as const, message: 'ok' };
          } catch (err) {
            return { name, ok: false as const, message: err instanceof Error ? err.message : String(err) };
          }
        }),
      );
      const summary = Object.fromEntries(results.map((r) => [r.name, r.ok ? 'ok' : 'down']));
      if (results.every((r) => r.ok)) {
        res.json({ status: 'ok', service, checks: summary, time: new Date().toISOString() });
        return;
      }
      res.status(503).json({
        ...errorBody('NOT_READY', 'One or more dependencies are unavailable', results.filter((r) => !r.ok).map((r) => ({ path: r.name, message: r.message })), {
          correlationId: req.correlationId,
          retryable: true,
        }),
        status: 'down',
        service,
        checks: summary,
      });
    }),
  );
  return router;
}
