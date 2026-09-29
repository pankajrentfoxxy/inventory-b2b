/**
 * Development seed: permission catalogue + two organizations with users in different roles.
 * It creates NO vendors; vendor data is entered through the UI / API.
 *
 *   Organization "Rentfoxxy Demo"            Organization "Second Tenant" (cross-tenant tests)
 *     owner@demo.local     / Password123!       owner2@demo.local / Password123!
 *     purchase@demo.local  / Password123!  (Purchase Manager)
 *     executive@demo.local / Password123!  (Purchase Executive)
 *     viewer@demo.local    / Password123!  (Viewer)
 */
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma.js';
import {
  createOrganizationWithOwner,
  provisionOrganizationDefaults,
  syncPermissionCatalogue,
} from '../src/modules/organizations/organization.service.js';

const PASSWORD = 'Password123!';

async function ensureUser(email: string, name: string) {
  return prisma.user.upsert({
    where: { email },
    update: { name },
    create: { email, name, passwordHash: await bcrypt.hash(PASSWORD, 10) },
  });
}

async function ensureMember(organizationId: string, userId: string, roleCode: string) {
  const role = await prisma.role.findUniqueOrThrow({ where: { organizationId_code: { organizationId, code: roleCode } } });
  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId, userId } },
    update: { roleId: role.id },
    create: { organizationId, userId, roleId: role.id },
  });
}

async function main() {
  await syncPermissionCatalogue(prisma);

  const owner = await ensureUser('owner@demo.local', 'Demo Owner');
  let org = await prisma.organization.findUnique({ where: { slug: 'rentfoxxy-demo' } });
  if (!org) {
    org = await prisma.$transaction(
      (tx) => createOrganizationWithOwner(tx, { name: 'Rentfoxxy Demo', ownerUserId: owner.id }),
      { timeout: 30_000 },
    );
    await prisma.organization.update({ where: { id: org.id }, data: { slug: 'rentfoxxy-demo' } });
  }

  const purchase = await ensureUser('purchase@demo.local', 'Priya Purchase');
  const executive = await ensureUser('executive@demo.local', 'Eshan Executive');
  const viewer = await ensureUser('viewer@demo.local', 'Vikram Viewer');
  await ensureMember(org.id, purchase.id, 'PURCHASE_MANAGER');
  await ensureMember(org.id, executive.id, 'PURCHASE_EXECUTIVE');
  await ensureMember(org.id, viewer.id, 'VIEWER');

  const owner2 = await ensureUser('owner2@demo.local', 'Second Owner');
  let org2 = await prisma.organization.findUnique({ where: { slug: 'second-tenant' } });
  if (!org2) {
    org2 = await prisma.$transaction(
      (tx) => createOrganizationWithOwner(tx, { name: 'Second Tenant', ownerUserId: owner2.id }),
      { timeout: 30_000 },
    );
    await prisma.organization.update({ where: { id: org2.id }, data: { slug: 'second-tenant' } });
  }

  // Idempotent: brings existing organizations up to date with new roles / permissions / masters.
  for (const o of [org, org2]) await provisionOrganizationDefaults(prisma, o.id);

  console.log('Seed complete.');
  console.log(`  ${org.name}: owner@demo.local, purchase@demo.local, executive@demo.local, viewer@demo.local`);
  console.log(`  ${org2.name}: owner2@demo.local`);
  console.log(`  Password for all: ${PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
