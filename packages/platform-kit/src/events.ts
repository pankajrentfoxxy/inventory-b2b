/** Event envelope (phase-plan/README.md 5.8). */
export interface EventActor {
  type: 'user' | 'service' | 'system';
  id: string | null;
  name?: string | null;
}

export interface EventAggregate {
  type: string;
  id: string;
  version: number | null;
}

export interface EventEnvelope<P = Record<string, unknown>> {
  eventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  tenantId: string | null;
  producer: string;
  correlationId: string;
  causationId: string | null;
  actor: EventActor;
  aggregate: EventAggregate;
  payload: P;
}

export function routingKeyFor(envelope: Pick<EventEnvelope, 'eventType' | 'eventVersion'>): string {
  return `${envelope.eventType}.v${envelope.eventVersion}`;
}

/** AMQP-style topic match: `*` = one word, `#` = zero or more words. */
export function topicMatches(pattern: string, routingKey: string): boolean {
  const p = pattern.split('.');
  const k = routingKey.split('.');
  const go = (pi: number, ki: number): boolean => {
    if (pi === p.length) return ki === k.length;
    if (p[pi] === '#') {
      for (let skip = 0; skip <= k.length - ki; skip += 1) if (go(pi + 1, ki + skip)) return true;
      return false;
    }
    if (ki >= k.length) return false;
    if (p[pi] === '*' || p[pi] === k[ki]) return go(pi + 1, ki + 1);
    return false;
  };
  return go(0, 0);
}
