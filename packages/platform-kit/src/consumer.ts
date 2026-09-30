/**
 * Consumer registration: binds a queue, deduplicates with the inbox, and runs the handler in a
 * transaction with the RLS context of the event's tenant. Consumers assert that the envelope's
 * tenant matches the entity they touch (phase-05 tests: events with the wrong tenant are ignored).
 */
import type { Broker } from './broker.js';
import type { SqlClient, TransactionalClient } from './db.js';
import { setTenantContext } from './db.js';
import type { EventEnvelope } from './events.js';
import { claimEvent } from './inbox.js';
import type { Logger } from './logger.js';

export interface ConsumerDefinition<P = Record<string, unknown>> {
  /** Unique consumer name (also the queue name), e.g. 'inventory.receipts'. */
  name: string;
  bindings: string[];
  /** Runs inside a transaction after the inbox claim; throw to retry. */
  handle: (envelope: EventEnvelope<P>, tx: SqlClient) => Promise<void>;
  /** Default: tenant context from envelope.tenantId; platform when null. */
  tenantOf?: (envelope: EventEnvelope<P>) => string | null;
}

export interface ConsumerRuntime {
  broker: Broker;
  client: TransactionalClient;
  logger: Logger;
}

export async function registerConsumer<P>(runtime: ConsumerRuntime, definition: ConsumerDefinition<P>): Promise<void> {
  const { broker, client, logger } = runtime;
  await broker.subscribe({
    queue: definition.name,
    bindings: definition.bindings,
    handler: async (raw) => {
      const envelope = raw as EventEnvelope<P>;
      const tenantId = definition.tenantOf ? definition.tenantOf(envelope) : envelope.tenantId;
      const applied = await client.$transaction(
        async (tx) => {
          await setTenantContext(tx, tenantId);
          if (!(await claimEvent(tx, definition.name, envelope.eventId))) return false;
          await definition.handle(envelope, tx);
          return true;
        },
        { maxWait: 10_000, timeout: 30_000 },
      );
      if (!applied) logger.debug({ consumer: definition.name, eventId: envelope.eventId }, 'duplicate event ignored');
    },
  });
}
