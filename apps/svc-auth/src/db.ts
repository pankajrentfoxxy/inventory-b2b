import { PrismaClient } from '../prisma/generated/client/index.js';

export { PrismaClient };
export type Prisma = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

export function createPrisma(databaseUrl: string, log: boolean): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: log ? ['warn', 'error'] : [] });
}
