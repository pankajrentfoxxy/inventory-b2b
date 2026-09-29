import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

export const prisma = new PrismaClient({
  log: env.isProd ? ['error'] : ['warn', 'error'],
});

export type PrismaTx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
