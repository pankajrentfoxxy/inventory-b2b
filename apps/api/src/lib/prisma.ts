import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

export const prisma = new PrismaClient({
  // Tests provoke constraint violations on purpose (CHECK / unique races); keep their output clean.
  log: env.isProd ? ['error'] : env.isTest ? [] : ['warn', 'error'],
});

export type PrismaTx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * Options for interactive transactions that take row locks (PO / GRN writes). Under contention
 * many requests queue on the same lock; Prisma's defaults (2 s to start, 5 s to run) would fail
 * them spuriously, so give them room. `maxWait` is the time to obtain a connection.
 */
export const LOCKING_TX_OPTIONS = { maxWait: 15_000, timeout: 30_000 } as const;
