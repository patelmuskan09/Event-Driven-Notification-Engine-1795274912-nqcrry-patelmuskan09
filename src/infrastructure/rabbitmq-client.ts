import amqp from 'amqplib';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { EventPriority } from '../events/models/event';

export type RabbitConnectionState = 'CONNECTED' | 'IN_MEMORY_FALLBACK' | 'DISCONNECTED';

export class RabbitMqClient {
  private static instance: RabbitMqClient;
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.Channel | null = null;
  private state: RabbitConnectionState = 'DISCONNECTED';
  private lastError: string | null = null;

  private constructor() {}

  public static getInstance(): RabbitMqClient {
    if (!RabbitMqClient.instance) {
      RabbitMqClient.instance = new RabbitMqClient();
    }
    return RabbitMqClient.instance;
  }

  public async connect(): Promise<boolean> {
    if (!config.rabbitmq.enabled) {
      this.state = 'IN_MEMORY_FALLBACK';
      return false;
    }

    try {
      this.connection = await amqp.connect(config.rabbitmq.url, { timeout: 2500 });
      this.channel = await this.connection.createChannel();

      // Setup Dead Letter Exchange & DLQ
      await this.channel.assertExchange('notifications.dlx', 'direct', { durable: true });
      await this.channel.assertQueue(config.rabbitmq.dlqQueue, { durable: true });
      await this.channel.bindQueue(config.rabbitmq.dlqQueue, 'notifications.dlx', 'dlq');

      // Setup Primary Direct Exchange & Priority Queues
      await this.channel.assertExchange(config.rabbitmq.exchangeName, 'direct', { durable: true });
      await this.channel.assertQueue(config.rabbitmq.criticalQueue, {
        durable: true,
        arguments: {
          'x-max-priority': 10,
          'x-dead-letter-exchange': 'notifications.dlx',
          'x-dead-letter-routing-key': 'dlq',
        },
      });
      await this.channel.assertQueue(config.rabbitmq.highQueue, {
        durable: true,
        arguments: {
          'x-max-priority': 5,
          'x-dead-letter-exchange': 'notifications.dlx',
          'x-dead-letter-routing-key': 'dlq',
        },
      });
      await this.channel.assertQueue(config.rabbitmq.standardQueue, {
        durable: true,
        arguments: {
          'x-max-priority': 3,
          'x-dead-letter-exchange': 'notifications.dlx',
          'x-dead-letter-routing-key': 'dlq',
        },
      });

      await this.channel.bindQueue(config.rabbitmq.criticalQueue, config.rabbitmq.exchangeName, 'CRITICAL');
      await this.channel.bindQueue(config.rabbitmq.highQueue, config.rabbitmq.exchangeName, 'HIGH');
      await this.channel.bindQueue(config.rabbitmq.standardQueue, config.rabbitmq.exchangeName, 'STANDARD');

      this.state = 'CONNECTED';
      this.lastError = null;
      logger.info('Connected to RabbitMQ 3.12+ priority queues', { service: 'RabbitMqClient' });
      return true;
    } catch (err: any) {
      this.lastError = err.message;
      this.state = 'IN_MEMORY_FALLBACK';
      this.channel = null;
      this.connection = null;
      logger.warn('RabbitMQ unavailable; using direct worker dispatch fallback', {
        service: 'RabbitMqClient',
        reason: err.message,
      });
      return false;
    }
  }

  public isConnected(): boolean {
    return this.state === 'CONNECTED' && this.channel !== null;
  }

  public getStatus(): { state: RabbitConnectionState; mode: string; lastError: string | null } {
    return {
      state: this.state,
      mode: this.isConnected() ? 'RABBITMQ_LIVE' : 'IN_MEMORY_FALLBACK',
      lastError: this.lastError,
    };
  }

  public publishToPriorityQueue(priority: EventPriority, payload: unknown, correlationId: string): boolean {
    if (!this.isConnected() || !this.channel) return false;
    const routingKey = priority === 'CRITICAL' ? 'CRITICAL' : priority === 'HIGH' ? 'HIGH' : 'STANDARD';
    const numericPriority = priority === 'CRITICAL' ? 10 : priority === 'HIGH' ? 5 : 2;
    return this.channel.publish(
      config.rabbitmq.exchangeName,
      routingKey,
      Buffer.from(JSON.stringify(payload)),
      {
        persistent: true,
        priority: numericPriority,
        correlationId,
        contentType: 'application/json',
      }
    );
  }

  public publishToDlq(payload: unknown, correlationId: string): boolean {
    if (!this.isConnected() || !this.channel) return false;
    return this.channel.publish('notifications.dlx', 'dlq', Buffer.from(JSON.stringify(payload)), {
      persistent: true,
      correlationId,
    });
  }

  public async disconnect(): Promise<void> {
    if (this.channel) {
      await this.channel.close().catch(() => undefined);
      this.channel = null;
    }
    if (this.connection) {
      await this.connection.close().catch(() => undefined);
      this.connection = null;
    }
    this.state = 'DISCONNECTED';
  }
}
