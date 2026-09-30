/**
 * RabbitMQ publisher for the outbox relay: topic exchange `domain.events`, routing key
 * `<eventType>.v<eventVersion>`, persistent messages, publisher confirms (README 5.8).
 * The connection is opened lazily and re-opened after a failure; the relay retries rows anyway.
 */
import amqp, { type ChannelModel, type ConfirmChannel } from 'amqplib';
import type { EventEnvelope, EventPublisher } from './outbox.js';
import { logger } from './logger.js';

export class AmqpPublisher implements EventPublisher {
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private connecting: Promise<ConfirmChannel> | null = null;

  constructor(
    private readonly url: string,
    private readonly exchange: string,
  ) {}

  private async open(): Promise<ConfirmChannel> {
    if (this.channel) return this.channel;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const connection = await amqp.connect(this.url);
      connection.on('error', (err) => logger.warn({ err }, 'amqp connection error'));
      connection.on('close', () => {
        this.connection = null;
        this.channel = null;
      });
      const channel = await connection.createConfirmChannel();
      await channel.assertExchange(this.exchange, 'topic', { durable: true });
      this.connection = connection;
      this.channel = channel;
      return channel;
    })();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async publish(routingKey: string, envelope: EventEnvelope): Promise<void> {
    const channel = await this.open();
    await new Promise<void>((resolve, reject) => {
      channel.publish(
        this.exchange,
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

  async close(): Promise<void> {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch (err) {
      logger.warn({ err }, 'amqp close failed');
    } finally {
      this.channel = null;
      this.connection = null;
    }
  }
}
