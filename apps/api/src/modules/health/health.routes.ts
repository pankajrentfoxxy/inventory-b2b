/**
 * Health endpoints (phase-plan/phase-00 step 5): `/health/live` says the process is up,
 * `/health/ready` checks dependencies and returns 503 (retryable) when any is down.
 */
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { errorBody } from '../../lib/errors.js';
import { asyncHandler } from '../../lib/http.js';

export const SERVICE_NAME = 'legacy-api';
const CHECK_TIMEOUT_MS = 2_000;

export type HealthChecks = Record<string, () => Promise<void>>;

export const defaultHealthChecks: HealthChecks = {
  database: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
};

function withTimeout(run: () => Promise<void>, ms: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    run().then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export function createHealthRouter(checks: HealthChecks = defaultHealthChecks) {
  const router = Router();

  router.get('/live', (_req, res) => {
    res.json({ status: 'ok', service: SERVICE_NAME, time: new Date().toISOString() });
  });

  router.get('/ready', asyncHandler(async (req, res) => {
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
      res.json({ status: 'ok', service: SERVICE_NAME, checks: summary, time: new Date().toISOString() });
      return;
    }
    const details = results.filter((r) => !r.ok).map((r) => ({ path: r.name, message: r.message }));
    res.status(503).json({
      ...errorBody('NOT_READY', 'One or more dependencies are unavailable', details, { correlationId: req.correlationId, retryable: true }),
      status: 'down',
      service: SERVICE_NAME,
      checks: summary,
    });
  }));

  return router;
}
