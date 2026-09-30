import { z } from 'zod';
import { requiredEmail, requiredPersonName, requiredText, optionalText } from '@b2b/shared';

export const createRoleSchema = z.object({
  name: requiredText('Role name', 100, { min: 2 }),
  description: optionalText(300, {}, 'Description'),
  permissionCodes: z.array(z.string().min(1).max(80)).max(200),
  rank: z.number().int().min(1).max(99),
});

export const cloneRoleSchema = z.object({ name: requiredText('Role name', 100, { min: 2 }), rank: z.number().int().min(1).max(99).optional() });
export const rolePermissionsSchema = z.object({ permissionCodes: z.array(z.string().min(1).max(80)).max(200) });

export const inviteSchema = z.object({
  email: requiredEmail({ lowercase: true }),
  fullName: requiredPersonName('Name', { min: 2 }).optional(),
  roleIds: z.array(z.string().uuid()).min(1).max(10),
  warehouseIds: z.array(z.string().uuid()).max(50).optional(),
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(10),
  fullName: requiredPersonName('Your name', { min: 2 }).optional(),
  password: z.string().min(1).max(128).optional(),
});

export const memberRolesSchema = z.object({ roleIds: z.array(z.string().uuid()).min(1).max(10) });
export const reasonSchema = z.object({ reason: requiredText('Reason', 500, { min: 3 }) });
export const warehouseScopeSchema = z.object({ allWarehouses: z.boolean(), warehouseIds: z.array(z.string().uuid()).max(50).default([]) });
export const membersQuerySchema = z.object({ status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED']).optional(), roleId: z.string().uuid().optional() });
export const platformInviteSchema = z.object({ email: requiredEmail({ lowercase: true }), fullName: requiredPersonName('Name', { min: 2 }).optional(), roleKeys: z.array(z.string()).min(1).max(3) });
export const platformRolesSchema = z.object({ roleKeys: z.array(z.string()).min(1).max(3) });
