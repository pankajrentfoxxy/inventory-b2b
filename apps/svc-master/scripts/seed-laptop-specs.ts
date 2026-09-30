/**
 * Adds the default laptop specification values (brands, generations, RAM, SSD, screen sizes) to
 * every tenant that already has master data. New tenants get them on activation; this script covers
 * tenants activated before laptop configurations existed. Idempotent: existing values are kept.
 *
 *   npm run seed:laptop-specs -w @b2b/svc-master
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '@b2b/platform-kit';
import { masterEnvSchema } from '../src/config.js';
import { PrismaClient } from '../prisma/generated/client/index.js';
import { MasterService, noMovements } from '../src/modules/master.service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = loadEnv(masterEnvSchema, { dir: path.resolve(here, '..') });
const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
const service = new MasterService(prisma as never, noMovements);

async function main() {
  // Tenants are discovered from their seeded warehouses (every activated tenant has one).
  const tenants = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.platform', 'true', true)`;
    return tx.$queryRaw<{ tenant_id: string }[]>`SELECT DISTINCT tenant_id FROM warehouses`;
  });
  let total = 0;
  for (const { tenant_id: tenantId } of tenants) {
    const added = await service.tx(tenantId, (tx) => service.seedLaptopSpecs(tx, tenantId));
    total += added;
    console.log(`${tenantId}: ${added} value(s) added`);
  }
  console.log(`Done: ${tenants.length} tenant(s), ${total} value(s) added.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
