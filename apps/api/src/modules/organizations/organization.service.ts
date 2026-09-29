import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  DEFAULT_CURRENCIES,
  DEFAULT_DOCUMENT_SEQUENCES,
  DEFAULT_GST_TREATMENTS,
  DEFAULT_LOCATION_NAME,
  DEFAULT_PAYMENT_TERMS,
  DEFAULT_REPORTING_TAGS,
  DEFAULT_ROLES,
  DEFAULT_TAXES,
  INDIAN_STATES,
  PERMISSIONS,
} from '@b2b/shared';
import { prisma, type PrismaTx } from '../../lib/prisma.js';
import { conflict, notFound, badRequest } from '../../lib/errors.js';

type Db = PrismaTx | typeof prisma;

/* ---- permission catalogue -------------------------------------------- */

/** Upserts the permission catalogue and keeps full-access roles (OWNER/ADMIN) in sync with it. */
export async function syncPermissionCatalogue(db: Db) {
  for (const p of PERMISSIONS) {
    await db.permission.upsert({
      where: { code: p.code },
      update: { module: p.module, description: p.description },
      create: { code: p.code, module: p.module, description: p.description },
    });
  }
  const all = await db.permission.findMany({ select: { id: true } });
  const fullAccessRoles = await db.role.findMany({ where: { code: { in: ['OWNER', 'ADMIN'] } }, select: { id: true } });
  for (const role of fullAccessRoles) {
    await db.rolePermission.createMany({
      data: all.map((perm) => ({ roleId: role.id, permissionId: perm.id })),
      skipDuplicates: true,
    });
  }
}

/* ---- per-organization defaults --------------------------------------- */

export async function provisionOrganizationDefaults(db: Db, organizationId: string) {
  await db.currency.createMany({
    data: DEFAULT_CURRENCIES.map((c) => ({ code: c.code, name: c.name, symbol: c.symbol })),
    skipDuplicates: true,
  });

  const permissions = await db.permission.findMany({ select: { id: true, code: true } });
  const permByCode = new Map(permissions.map((p) => [p.code, p.id]));

  for (const roleDef of DEFAULT_ROLES) {
    const role = await db.role.upsert({
      where: { organizationId_code: { organizationId, code: roleDef.code } },
      update: { name: roleDef.name, description: roleDef.description, isSystem: true },
      create: {
        organizationId,
        code: roleDef.code,
        name: roleDef.name,
        description: roleDef.description,
        isSystem: true,
      },
    });
    const codes = roleDef.permissions === '*' ? [...permByCode.keys()] : roleDef.permissions;
    const data = codes
      .map((code) => permByCode.get(code))
      .filter((id): id is string => Boolean(id))
      .map((permissionId) => ({ roleId: role.id, permissionId }));
    if (data.length) await db.rolePermission.createMany({ data, skipDuplicates: true });
  }

  await db.gstTreatment.createMany({
    data: DEFAULT_GST_TREATMENTS.map((g) => ({
      organizationId,
      code: g.code,
      name: g.name,
      description: g.description,
      requiresGstin: g.requiresGstin,
      sortOrder: g.sortOrder,
    })),
    skipDuplicates: true,
  });

  await db.sourceOfSupply.createMany({
    data: INDIAN_STATES.map((s, i) => ({
      organizationId,
      code: s.code,
      shortCode: s.short,
      name: s.name,
      countryCode: 'IN',
      sortOrder: i,
    })),
    skipDuplicates: true,
  });

  await db.paymentTerm.createMany({
    data: DEFAULT_PAYMENT_TERMS.map((p) => ({ organizationId, name: p.name, days: p.days, isDefault: p.isDefault })),
    skipDuplicates: true,
  });

  for (const [i, tag] of DEFAULT_REPORTING_TAGS.entries()) {
    const created = await db.reportingTag.upsert({
      where: { organizationId_name: { organizationId, name: tag.name } },
      update: {},
      create: { organizationId, name: tag.name, sortOrder: i },
    });
    await db.reportingTagOption.createMany({
      data: tag.options.map((name, j) => ({ tagId: created.id, name, sortOrder: j })),
      skipDuplicates: true,
    });
  }

  // Purchasing masters
  const hasDefaultTax = await db.tax.findFirst({ where: { organizationId, isDefault: true }, select: { id: true } });
  await db.tax.createMany({
    data: DEFAULT_TAXES.map((t) => ({ organizationId, name: t.name, rate: t.rate, isDefault: hasDefaultTax ? false : t.isDefault })),
    skipDuplicates: true,
  });
  const locationCount = await db.location.count({ where: { organizationId } });
  if (locationCount === 0) {
    await db.location.create({ data: { organizationId, name: DEFAULT_LOCATION_NAME, type: 'OFFICE', isPrimary: true } });
  }
  await db.documentSequence.createMany({
    data: DEFAULT_DOCUMENT_SEQUENCES.map((s) => ({ organizationId, docType: s.docType, prefix: s.prefix, padding: s.padding, nextNumber: 1 })),
    skipDuplicates: true,
  });
}

/* ---- organization creation -------------------------------------------- */

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'org';
}

export async function createOrganizationWithOwner(db: Db, input: { name: string; ownerUserId: string }) {
  let slug = slugify(input.name);
  if (await db.organization.findUnique({ where: { slug } })) {
    slug = `${slug}-${crypto.randomBytes(3).toString('hex')}`;
  }
  const org = await db.organization.create({ data: { name: input.name, slug } });
  await provisionOrganizationDefaults(db, org.id);
  const ownerRole = await db.role.findUniqueOrThrow({
    where: { organizationId_code: { organizationId: org.id, code: 'OWNER' } },
  });
  await db.organizationMember.create({
    data: { organizationId: org.id, userId: input.ownerUserId, roleId: ownerRole.id, isOwner: true },
  });
  return org;
}

/* ---- members & roles ---------------------------------------------------- */

export async function listRoles(organizationId: string) {
  const roles = await prisma.role.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'asc' },
    include: { permissions: { include: { permission: { select: { code: true } } } }, _count: { select: { members: true } } },
  });
  return roles.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    memberCount: r._count.members,
    permissions: r.permissions.map((p) => p.permission.code).sort(),
  }));
}

export async function listMembers(organizationId: string) {
  const members = await prisma.organizationMember.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { id: true, name: true, email: true, isActive: true } }, role: { select: { id: true, code: true, name: true } } },
  });
  return members.map((m) => ({
    id: m.id,
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    isOwner: m.isOwner,
    status: m.status,
    role: m.role,
    createdAt: m.createdAt,
  }));
}

/** Adds an existing user (by email) or creates a new one, then attaches them to the organization. */
export async function addMember(
  organizationId: string,
  input: { name: string; email: string; password?: string; roleId: string },
) {
  const role = await prisma.role.findFirst({ where: { id: input.roleId, organizationId } });
  if (!role) throw badRequest('Role does not belong to this organization', 'ROLE_INVALID');
  if (role.code === 'OWNER') throw badRequest('Ownership cannot be granted through this endpoint', 'ROLE_INVALID');

  return prisma.$transaction(async (tx) => {
    let user = await tx.user.findUnique({ where: { email: input.email } });
    let temporaryPassword: string | undefined;
    if (!user) {
      temporaryPassword = input.password ?? crypto.randomBytes(9).toString('base64url');
      user = await tx.user.create({
        data: { name: input.name, email: input.email, passwordHash: await bcrypt.hash(temporaryPassword, 10) },
      });
    }
    const existing = await tx.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: user.id } },
    });
    if (existing) throw conflict('This user is already a member of the organization', 'MEMBER_EXISTS');
    const member = await tx.organizationMember.create({
      data: { organizationId, userId: user.id, roleId: role.id },
      include: { user: { select: { id: true, name: true, email: true } }, role: { select: { id: true, code: true, name: true } } },
    });
    return {
      id: member.id,
      userId: member.user.id,
      name: member.user.name,
      email: member.user.email,
      role: member.role,
      status: member.status,
      // Returned once so an admin can hand it over; never stored in clear.
      temporaryPassword: input.password ? undefined : temporaryPassword,
    };
  });
}

export async function updateMember(
  organizationId: string,
  memberId: string,
  input: { roleId?: string; status?: 'ACTIVE' | 'SUSPENDED' },
) {
  const member = await prisma.organizationMember.findFirst({ where: { id: memberId, organizationId } });
  if (!member) throw notFound('Member not found');
  if (member.isOwner) throw badRequest('The organization owner cannot be modified', 'OWNER_LOCKED');
  if (input.roleId) {
    const role = await prisma.role.findFirst({ where: { id: input.roleId, organizationId } });
    if (!role || role.code === 'OWNER') throw badRequest('Role does not belong to this organization', 'ROLE_INVALID');
  }
  return prisma.organizationMember.update({
    where: { id: memberId },
    data: { roleId: input.roleId, status: input.status },
    include: { user: { select: { id: true, name: true, email: true } }, role: { select: { id: true, code: true, name: true } } },
  });
}
