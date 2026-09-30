/**
 * Email templates keyed by event type (phase-01 1.7 / phase-02 2.7). Plain text on purpose: the
 * HTML layer comes with the web work. Every template returns null when the event needs no mail.
 */
import { EVENT_TYPES, iamInvitationCreatedPayload, tenantLifecyclePayload } from '@b2b/contracts';
import type { EventEnvelope } from '@b2b/platform-kit';
import { z } from 'zod';

export interface Mail {
  template: string;
  to: string;
  subject: string;
  text: string;
}

export interface TemplateContext {
  appUrl: string;
  adminUrl: string;
}

const ownerInvitedPayload = z.object({ userId: z.string(), tenantId: z.string(), email: z.string(), fullName: z.string(), inviteToken: z.string(), expiresAt: z.string(), alreadyActive: z.boolean() });
const passwordResetPayload = z.object({ userId: z.string(), email: z.string(), fullName: z.string(), resetToken: z.string(), expiresAt: z.string() });

export function renderMail(envelope: EventEnvelope, ctx: TemplateContext): Mail | null {
  switch (envelope.eventType) {
    case EVENT_TYPES.TENANT_CREATED: {
      const p = tenantLifecyclePayload.parse(envelope.payload);
      if (p.source !== 'APPLICATION') return null;
      return { template: 'tenant.application_received', to: p.ownerEmail, subject: `We received your application for ${p.displayName}`, text: `Hello ${p.ownerName},\n\nThank you for applying to join B2B Inventory. Your application (reference ${p.code}) is under review. We will email you once it is approved.\n` };
    }
    case EVENT_TYPES.TENANT_APPROVED: {
      const p = tenantLifecyclePayload.parse(envelope.payload);
      return { template: 'tenant.approved', to: p.ownerEmail, subject: `${p.displayName} has been approved`, text: `Hello ${p.ownerName},\n\nYour organisation ${p.legalName} has been approved. You will receive an invitation to set your password as soon as the account is activated.\n` };
    }
    case EVENT_TYPES.AUTH_OWNER_INVITED: {
      const p = ownerInvitedPayload.parse(envelope.payload);
      const link = `${ctx.appUrl}/accept-invite?token=${encodeURIComponent(p.inviteToken)}`;
      return { template: 'auth.owner_invite', to: p.email, subject: 'Your B2B Inventory account is ready', text: `Hello ${p.fullName},\n\nYour organisation is active. Set your password to sign in:\n${link}\n\nThis link expires on ${p.expiresAt}.\n` };
    }
    case EVENT_TYPES.TENANT_SUSPENDED: {
      const p = tenantLifecyclePayload.parse(envelope.payload);
      return { template: 'tenant.suspended', to: p.ownerEmail, subject: `${p.displayName} has been suspended`, text: `Hello ${p.ownerName},\n\nAccess to ${p.legalName} has been suspended.${p.reason ? `\nReason: ${p.reason}` : ''}\n\nPlease contact support.\n` };
    }
    case EVENT_TYPES.TENANT_REACTIVATED: {
      const p = tenantLifecyclePayload.parse(envelope.payload);
      return { template: 'tenant.reactivated', to: p.ownerEmail, subject: `${p.displayName} is active again`, text: `Hello ${p.ownerName},\n\nAccess to ${p.legalName} has been restored. You can sign in at ${ctx.appUrl}.\n` };
    }
    case EVENT_TYPES.TENANT_DEACTIVATED: {
      const p = tenantLifecyclePayload.parse(envelope.payload);
      return { template: 'tenant.deactivated', to: p.ownerEmail, subject: `${p.displayName} has been deactivated`, text: `Hello ${p.ownerName},\n\nThe account for ${p.legalName} has been deactivated.${p.reason ? `\nReason: ${p.reason}` : ''}\n\nYour data is retained; contact support for exports.\n` };
    }
    case EVENT_TYPES.AUTH_PASSWORD_RESET_REQUESTED: {
      const p = passwordResetPayload.parse(envelope.payload);
      const link = `${ctx.appUrl}/reset-password?token=${encodeURIComponent(p.resetToken)}`;
      return { template: 'auth.password_reset', to: p.email, subject: 'Reset your password', text: `Hello ${p.fullName},\n\nUse this link to choose a new password (valid until ${p.expiresAt}):\n${link}\n\nIf you did not ask for this, ignore this email.\n` };
    }
    case EVENT_TYPES.IAM_INVITATION_CREATED: {
      const p = iamInvitationCreatedPayload.parse(envelope.payload);
      const link = `${ctx.appUrl}/accept-invitation?token=${encodeURIComponent(p.acceptToken)}`;
      return { template: 'iam.invitation', to: p.email, subject: `You have been invited to ${p.tenantName ?? 'an organisation'} on B2B Inventory`, text: `Hello,\n\n${p.invitedByName ?? 'An administrator'} invited you as ${p.roleKeys.join(', ')}. Accept here:\n${link}\n\nThis invitation expires on ${p.expiresAt}.\n` };
    }
    default:
      return null;
  }
}

export const NOTIFICATION_BINDINGS = [
  EVENT_TYPES.TENANT_CREATED,
  EVENT_TYPES.TENANT_APPROVED,
  EVENT_TYPES.TENANT_SUSPENDED,
  EVENT_TYPES.TENANT_REACTIVATED,
  EVENT_TYPES.TENANT_DEACTIVATED,
  EVENT_TYPES.AUTH_OWNER_INVITED,
  EVENT_TYPES.AUTH_PASSWORD_RESET_REQUESTED,
  EVENT_TYPES.IAM_INVITATION_CREATED,
];
