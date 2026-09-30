/**
 * Message broker abstraction. Producers use `EventPublisher` (through the outbox relay); consumers
 * subscribe to queues bound to topic patterns. Two implementations:
 *   - InMemoryBroker: tests and co-hosted development without RabbitMQ. Deterministic `drain()`.
 *   - AmqpBroker: RabbitMQ topology from infra/rabbitmq/definitions.json, retry queues, DLQ.
 */
import amqp, { type ChannelModel, type ConfirmChannel, type ConsumeMessage } from 'amqplib';
import type { EventEnvelope } from './events.js';
import { topicMatches } from './events.js';
import type { Logger } from './logger.js';
import type { EventPublisher } from './outbox.js';

export type EventHandler = (envelope: EventEnvelope) => Promise<void>;

export interface Subscription {
  /** Queue name, e.g. 'inventory.receipts'. */
  queue: string;
  /** Topic bindings, e.g. ['procurement.grn.received.v1']. */
  bindings: string[];
  handler: EventHandler;
}

export interface Broker extends EventPublisher {
  subscribe(subscription: Subscription): Promise<void>;
  close(): Promise<void>;
}

/** Retry schedule (README 5.8): 10 s, 60 s, 10 min, then dead-letter. */
export const RETRY_STEPS = ['10s', '60s', '10m'] as const;

/* ---- in-memory ---------------------------------------------------------- */

interface Delivery {
  subscription: Subscription;
  envelope: EventEnvelope;
  attempt: number;
}

export class InMemoryBroker implements Broker {
  private subscriptions: Subscription[] = [];
  private queue: Delivery[] = [];
  readonly deadLetters: { queue: string; envelope: EventEnvelope; error: string }[] = [];
  readonly published: { routingKey: string; envelope: EventEnvelope }[] = [];
  /** Simulated broker outage: publishes throw. */
  failing = false;
  /** Retries are immediate in tests (no timers); set the max attempts before dead-lettering. */
  maxAttempts = RETRY_STEPS.length + 1;

  constructor(private readonly logger?: Logger) {}

  async publish(routingKey: string, envelope: EventEnvelope): Promise<void> {
    if (this.failing) throw new Error('broker unavailable (simulated)');
    this.published.push({ routingKey, envelope });
    for (const s of this.subscriptions) {
      if (s.bindings.some((b) => topicMatches(b, routingKey))) this.queue.push({ subscription: s, envelope, attempt: 1 });
    }
  }

  async subscribe(subscription: Subscription): Promise<void> {
    this.subscriptions.push(subscription);
  }

  /** Delivers everything queued (including retries) until no work remains. Returns deliveries made. */
  async drain(): Promise<number> {
    let delivered = 0;
    while (this.queue.length) {
      const d = this.queue.shift()!;
      delivered += 1;
      try {
        await d.subscription.handler(d.envelope);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (d.attempt < this.maxAttempts) this.queue.push({ ...d, attempt: d.attempt + 1 });
        else {
          this.deadLetters.push({ queue: d.subscription.queue, envelope: d.envelope, error: message });
          this.logger?.warn({ queue: d.subscription.queue, eventId: d.envelope.eventId, err: message }, 'event dead-lettered');
        }
      }
    }
    return delivered;
  }

  pendingCount(): number {
    return this.queue.length;
  }

  async close(): Promise<void> {
    this.subscriptions = [];
    this.queue = [];
  }
}

/* ---- RabbitMQ ------------------------------------------------------------ */

export interface AmqpBrokerOptions {
  url: string;
  exchange: string;
  logger: Logger;
  /** Consumer prefetch. */
  prefetch?: number;
}

export class AmqpBroker implements Broker {
  private connection: ChannelModel | null = null;
  private publishChannel: ConfirmChannel | null = null;
  private connecting: Promise<ChannelModel> | null = null;
  private readonly consumerChannels: ConfirmChannel[] = [];

  constructor(private readonly options: AmqpBrokerOptions) {}

  private async connect(): Promise<ChannelModel> {
    if (this.connection) return this.connection;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const connection = await amqp.connect(this.options.url);
      connection.on('error', (err) => this.options.logger.warn({ err }, 'amqp connection error'));
      connection.on('close', () => {
        this.connection = null;
        this.publishChannel = null;
      });
      this.connection = connection;
      return connection;
    })();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async channel(): Promise<ConfirmChannel> {
    if (this.publishChannel) return this.publishChannel;
    const connection = await this.connect();
    const ch = await connection.createConfirmChannel();
    await ch.assertExchange(this.options.exchange, 'topic', { durable: true });
    await ch.assertExchange(`${this.options.exchange}.retry`, 'direct', { durable: true });
    await ch.assertExchange(`${this.options.exchange}.dlx`, 'direct', { durable: true });
    this.publishChannel = ch;
    return ch;
  }

  async publish(routingKey: string, envelope: EventEnvelope): Promise<void> {
    const ch = await this.channel();
    await new Promise<void>((resolve, reject) => {
      ch.publish(
        this.options.exchange,
        routingKey,
        Buffer.from(JSON.stringify(envelope)),
        {
          persistent: true,
          contentType: 'application/json',
          messageId: envelope.eventId,
          correlationId: envelope.correlationId,
          type: envelope.eventType,
          timestamp: Math.floor(Date.parse(envelope.occurredAt) / 1000),
          headers: { tenantId: envelope.tenantId ?? '', producer: envelope.producer, eventVersion: envelope.eventVersion },
        },
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }

  /**
   * Declares the queue with its retry queues and DLQ (idempotent with infra/rabbitmq/definitions.json),
   * binds it and consumes. Failed handlers are re-published to `<queue>.retry.<step>`; after the
   * last step the message goes to `<queue>.dlq`.
   */
  async subscribe(subscription: Subscription): Promise<void> {
    const connection = await this.connect();
    const ch = await connection.createConfirmChannel();
    await ch.prefetch(this.options.prefetch ?? 10);
    const { exchange, logger } = this.options;
    const queue = subscription.queue;
    const dlx = `${exchange}.dlx`;
    const retryExchange = `${exchange}.retry`;
    await ch.assertExchange(exchange, 'topic', { durable: true });
    await ch.assertExchange(retryExchange, 'direct', { durable: true });
    await ch.assertExchange(dlx, 'direct', { durable: true });
    await ch.assertQueue(queue, { durable: true, arguments: { 'x-queue-type': 'quorum', 'x-dead-letter-exchange': dlx, 'x-dead-letter-routing-key': queue } });
    await ch.assertQueue(`${queue}.dlq`, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
    await ch.bindQueue(`${queue}.dlq`, dlx, queue);
    const ttl: Record<(typeof RETRY_STEPS)[number], number> = { '10s': 10_000, '60s': 60_000, '10m': 600_000 };
    for (const step of RETRY_STEPS) {
      // Expired retry messages come back to the main queue through the dlx with the queue's own key.
      await ch.assertQueue(`${queue}.retry.${step}`, { durable: true, arguments: { 'x-message-ttl': ttl[step], 'x-dead-letter-exchange': dlx, 'x-dead-letter-routing-key': queue } });
      await ch.bindQueue(`${queue}.retry.${step}`, retryExchange, `${queue}.retry.${step}`);
    }
    await ch.bindQueue(queue, dlx, queue);
    for (const binding of subscription.bindings) await ch.bindQueue(queue, exchange, binding);

    await ch.consume(queue, async (msg: ConsumeMessage | null) => {
      if (!msg) return;
      let envelope: EventEnvelope;
      try {
        envelope = JSON.parse(msg.content.toString()) as EventEnvelope;
      } catch {
        ch.nack(msg, false, false); // unparsable -> DLQ
        return;
      }
      const attempt = Number(msg.properties.headers?.['x-attempt'] ?? 1);
      try {
        await subscription.handler(envelope);
        ch.ack(msg);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const step = RETRY_STEPS[attempt - 1];
        if (step) {
          ch.publish(retryExchange, `${queue}.retry.${step}`, msg.content, { ...msg.properties, headers: { ...(msg.properties.headers ?? {}), 'x-attempt': attempt + 1, 'x-last-error': message } });
          ch.ack(msg);
          logger.warn({ queue, eventId: envelope.eventId, attempt, retryIn: step, err: message }, 'event handler failed; scheduled retry');
        } else {
          ch.nack(msg, false, false);
          logger.error({ queue, eventId: envelope.eventId, attempt, err: message }, 'event handler failed; dead-lettered');
        }
      }
    });
    this.consumerChannels.push(ch);
  }

  async close(): Promise<void> {
    try {
      for (const ch of this.consumerChannels) await ch.close();
      await this.publishChannel?.close();
      await this.connection?.close();
    } catch (err) {
      this.options.logger.warn({ err }, 'amqp close failed');
    } finally {
      this.publishChannel = null;
      this.connection = null;
    }
  }
}
