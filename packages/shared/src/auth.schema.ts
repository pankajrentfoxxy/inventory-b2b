import { z } from 'zod';
import { requiredBusinessName, requiredEmail, requiredPersonName, uuidField } from './validation/fields.js';
import { MESSAGES } from './validation/messages.js';

const passwordField = (min: number) =>
  z
    .string({ required_error: MESSAGES.required('Password'), invalid_type_error: MESSAGES.required('Password') })
    .min(min, min > 1 ? `Password must be at least ${min} characters` : MESSAGES.required('Password'))
    .max(128, MESSAGES.tooLong('Password', 128));

export const loginSchema = z.object({
  email: requiredEmail({ lowercase: true }),
  password: passwordField(1),
});

export const registerSchema = z.object({
  name: requiredPersonName('Your name', { min: 2 }),
  email: requiredEmail({ lowercase: true }),
  password: passwordField(8),
  organizationName: requiredBusinessName('Organization name', { min: 2, max: 150 }),
});

export const addMemberSchema = z.object({
  name: requiredPersonName('Name', { min: 2 }),
  email: requiredEmail({ lowercase: true }),
  password: passwordField(8).optional(),
  roleId: uuidField('role'),
});

export const updateMemberSchema = z.object({
  roleId: z.string().uuid(MESSAGES.uuid('role')).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});
