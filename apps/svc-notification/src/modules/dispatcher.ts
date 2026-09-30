/**
 * Consumes notification-worthy events, renders the template, sends, and logs the delivery. A
 * transport failure is recorded as FAILED (no retry storm; alerting reads the log) while a
 * template error still throws so the broker retries and eventually dead-letters.
 */
import { Router } from 'express';
import { z } from 'zod';
import { rk } from '@b2b/contracts';
import { asyncHandler, authenticate, parseQuery, registerConsumer, uuidv7, validateQuery, type ConsumerRuntime, type EventEnvelope, type Logger, type TokenVerifier } from '@b2b/platform-kit';
import type { PrismaClient } from '../db.js';
import { NOTIFICATION_BINDINGS, renderMail, type TemplateContext } from './templates.js';
import type { EmailTransport } from './transport.js';

export interface DispatcherDeps {
  transport: EmailTransport;
  from: string;
  templates: TemplateContext;
  logger: Logger;
}

export async function registerDispatcher(runtime: ConsumerRuntime, deps: DispatcherDeps): Promise<void> {
  await registerConsumer(runtime, {
    name: 'notification.dispatcher',
    bindings: NOTIFICATION_BINDINGS.map((t) => rk(t)),
    tenantOf: () => null,
    handle: async (envelope, tx) => {
      const mail = renderMail(envelope as EventEnvelope, deps.templates);
      if (!mail) return;
      let status = 'SENT';
      let error: string | null = null;
      try {
        await deps.transport.send(mail, deps.from);
      } catch (err) {
        status = 'FAILED';
        error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
        deps.logger.error({ eventId: envelope.eventId, template: mail.template, err: error }, 'email delivery failed');
      }
      await tx.$executeRaw`
        INSERT INTO "deliveries" ("id", "event_id", "tenant_id", "channel", "recipient", "template", "subject", "body_text", "status", "error", "correlation_id")
        VALUES (${uuidv7()}::uuid, ${envelope.eventId}::uuid, ${envelope.tenantId}::uuid, 'EMAIL', ${mail.to}, ${mail.template}, ${mail.subject}, ${mail.text}, ${status}, ${error}, ${envelope.correlationId})
        ON CONFLICT ("event_id") DO NOTHING`;
    },
  });
}

const querySchema = z.object({ recipient: z.string().optional(), template: z.string().optional(), tenantId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });

export function createInternalRouter(prisma: PrismaClient, verifier: TokenVerifier) {
  const router = Router();
  router.use(authenticate({ verifier, types: ['service', 'platform'], serviceName: 'svc-notification' }));
  router.get('/deliveries', validateQuery(querySchema), asyncHandler(async (_req, res) => {
    const q = parseQuery<typeof querySchema>(res);
    const rows = await prisma.delivery.findMany({ where: { ...(q.recipient ? { recipient: q.recipient.toLowerCase() } : {}), ...(q.template ? { template: q.template } : {}), ...(q.tenantId ? { tenantId: q.tenantId } : {}) }, orderBy: { createdAt: 'desc' }, take: q.limit });
    res.json({ data: rows });
  }));
  return router;
}
