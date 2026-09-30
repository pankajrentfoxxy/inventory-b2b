import { z } from 'zod';
import { gstinField, panField, pincodeField, requiredBusinessName, requiredEmail, requiredPersonName, requiredText, optionalText, optionalCode, phoneField } from '@b2b/shared';

export const addressSchema = z.object({
  line1: requiredText('Address line 1', 200),
  line2: optionalText(200, {}, 'Address line 2'),
  city: requiredText('City', 100),
  state: requiredText('State', 100),
  stateCode: z.string().length(2, 'State code must be 2 digits'),
  pincode: pincodeField({ required: true }),
  country: z.string().length(2).default('IN'),
});

export const createTenantSchema = z.object({
  code: optionalCode('Code', 40, { min: 2 }),
  legalName: requiredBusinessName('Legal name', { min: 2, max: 200 }),
  displayName: requiredBusinessName('Display name', { min: 2, max: 150 }),
  pan: panField({ required: false }),
  gstin: gstinField({ required: false }),
  registeredAddress: addressSchema,
  ownerName: requiredPersonName('Owner name', { min: 2 }),
  ownerEmail: requiredEmail({ lowercase: true }),
  ownerPhone: phoneField({ required: false }),
});
export type CreateTenantInput = z.output<typeof createTenantSchema>;

export const updateTenantSchema = createTenantSchema.omit({ code: true }).partial();
export type UpdateTenantInput = z.output<typeof updateTenantSchema>;

export const reasonSchema = z.object({ reason: requiredText('Reason', 500, { min: 3 }) });
export const noteSchema = z.object({ note: optionalText(500, {}, 'Note') });
export const deactivateSchema = z.object({ reason: requiredText('Reason', 500, { min: 3 }), confirmCode: requiredText('Confirmation code', 40) });

export const listQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'REJECTED']).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export const applicationSchema = createTenantSchema.omit({ code: true }).extend({ captchaToken: z.string().optional() });

export const settingsSchema = z.object({
  timezone: z.string().min(1).max(60).optional(),
  fyStartMonth: z.number().int().min(1).max(12).optional(),
  baseCurrency: z.string().length(3).optional(),
  features: z.record(z.unknown()).optional(),
  limits: z.record(z.unknown()).optional(),
});
