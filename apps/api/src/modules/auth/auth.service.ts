import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import { conflict, unauthorized } from '../../lib/errors.js';
import { signToken } from '../../middleware/auth.js';
import { createOrganizationWithOwner, syncPermissionCatalogue } from '../organizations/organization.service.js';

async function membershipsFor(userId: string) {
  const memberships = await prisma.organizationMember.findMany({
    where: { userId, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    include: {
      organization: { select: { id: true, name: true, slug: true, baseCurrency: true, countryCode: true } },
      role: { select: { id: true, code: true, name: true } },
    },
  });
  return memberships.map((m) => ({
    id: m.organization.id,
    name: m.organization.name,
    slug: m.organization.slug,
    baseCurrency: m.organization.baseCurrency,
    countryCode: m.organization.countryCode,
    role: m.role,
    isOwner: m.isOwner,
  }));
}

function publicUser(u: { id: string; name: string; email: string }) {
  return { id: u.id, name: u.name, email: u.email };
}

export async function register(input: { name: string; email: string; password: string; organizationName: string }) {
  const exists = await prisma.user.findUnique({ where: { email: input.email } });
  if (exists) throw conflict('An account with this email already exists', 'EMAIL_TAKEN');

  const passwordHash = await bcrypt.hash(input.password, 10);
  const user = await prisma.$transaction(async (tx) => {
    await syncPermissionCatalogue(tx);
    const created = await tx.user.create({ data: { name: input.name, email: input.email, passwordHash } });
    await createOrganizationWithOwner(tx, { name: input.organizationName, ownerUserId: created.id });
    return created;
  }, { timeout: 30_000 });

  return {
    token: signToken({ userId: user.id, email: user.email }),
    user: publicUser(user),
    organizations: await membershipsFor(user.id),
  };
}

export async function login(input: { email: string; password: string }) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const ok = user && user.isActive && (await bcrypt.compare(input.password, user.passwordHash));
  if (!ok) throw unauthorized('Incorrect email or password', 'INVALID_CREDENTIALS');
  return {
    token: signToken({ userId: user.id, email: user.email }),
    user: publicUser(user),
    organizations: await membershipsFor(user.id),
  };
}

export async function me(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) throw unauthorized('Account is not active', 'ACCOUNT_INACTIVE');
  return { user: publicUser(user), organizations: await membershipsFor(user.id) };
}
