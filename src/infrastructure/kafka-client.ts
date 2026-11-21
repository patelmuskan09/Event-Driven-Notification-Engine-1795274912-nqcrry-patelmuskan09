import { Kafka, Producer, Consumer, logLevel } from 'kafkajs';
import { config } from '../config/env';
import { logger } from '../utils/logger';

export type KafkaConnectionState = 'CONNECTED' | 'IN_MEMORY_FALLBACK' | 'DISCONNECTED';

export class KafkaClient {
  private static instance: KafkaClient;
  private kafka: Kafka | null = null;
  private producer: Producer | null = null;
  private consumer: Consumer | null = null;
  private state: KafkaConnectionState = 'DISCONNECTED';
  private lastError: string | null = null;
  private messagesPublished = 0;
  private messagesConsumed = 0;

  private constructor() {}

  public static getInstance(): KafkaClient {
    if (!KafkaClient.instance) {
      KafkaClient.instance = new KafkaClient();
    }
    return KafkaClient.instance;
  }

  public async connect(
    onMessage?: (topic: string, payload: string, correlationId?: string) => Promise<void>
  ): Promise<boolean> {
    if (!config.kafka.enabled) {
      this.state = 'IN_MEMORY_FALLBACK';
      return false;
    }

    try {
      this.kafka = new Kafka({
        clientId: config.kafka.clientId,
        brokers: config.kafka.brokers,
        ssl: config.kafka.ssl,
        connectionTimeout: 2000,
        requestTimeout: 3000,
        retry: { retries: 1, initialRetryTime: 200 },
        logLevel: logLevel.NOTHING,
      });

      this.producer = this.kafka.producer({
        idempotent: true,
        allowAutoTopicCreation: true,
        maxInFlightRequests: 5,
      });

      await this.producer.connect();

      const admin = this.kafka.admin();
      await admin.connect();
      await admin
        .createTopics({
          waitForLeaders: false,
          topics: [
            { topic: config.kafka.topicEvents, numPartitions: 16, replicationFactor: 1 },
            { topic: config.kafka.topicCritical, numPartitions: 32, replicationFactor: 1 },
            { topic: config.kafka.topicDlq, numPartitions: 4, replicationFactor: 1 },
          ],
        })
        .catch(() => undefined);
      await admin.disconnect();

      if (onMessage) {
        this.consumer = this.kafka.consumer({
          groupId: config.kafka.groupId,
          allowAutoTopicCreation: true,
        });
        await this.consumer.connect();
        await this.consumer.subscribe({
          topics: [config.kafka.topicCritical, config.kafka.topicEvents],
          fromBeginning: false,
        });

        await this.consumer.run({
          autoCommit: false, // Manual offset management per Section 3
          eachMessage: async ({ topic, partition, message }) => {
            const rawVal = message.value?.toString() || '{}';
            const correlationId = message.headers?.['x-correlation-id']?.toString();
            await onMessage(topic, rawVal, correlationId);
            this.messagesConsumed++;
            await this.consumer!.commitOffsets([
              { topic, partition, offset: (Number(message.offset) + 1).toString() },
            ]);
          },
        });
      }

      this.state = 'CONNECTED';
      this.lastError = null;
      logger.info('Connected to Apache Kafka idempotent producer & consumer group', {
        service: 'KafkaClient',
        brokers: config.kafka.brokers,
      });
      return true;
    } catch (err: any) {
      this.lastError = err.message;
      this.state = 'IN_MEMORY_FALLBACK';
      this.producer = null;
      this.consumer = null;
      logger.warn('Apache Kafka unavailable; using in-process async stream fallback', {
        service: 'KafkaClient',
        reason: err.message,
      });
      return false;
    }
  }

  public isConnected(): boolean {
    return this.state === 'CONNECTED' && this.producer !== null;
  }

  public getStatus() {
    return {
      state: this.state,
      mode: this.isConnected() ? 'KAFKA_LIVE' : 'IN_MEMORY_FALLBACK',
      estimatedLag: Math.max(0, this.messagesPublished - this.messagesConsumed),
      lastError: this.lastError,
    };
  }

  public async publishEvent(
    topic: string,
    partitionKey: string,
    payload: unknown,
    correlationId: string
  ): Promise<boolean> {
    if (!this.isConnected() || !this.producer) return false;
    try {
      await this.producer.send({
        topic,
        acks: -1,
        messages: [
          {
            key: partitionKey,
            value: JSON.stringify(payload),
            headers: {
              'x-correlation-id': correlationId,
              'x-schema-version': '1.0',
            },
          },
        ],
      });
      this.messagesPublished++;
      return true;
    } catch (err: any) {
      logger.error('Kafka publish failed', {
        service: 'KafkaClient',
        topic,
        correlationId,
        error: err.message,
      });
      return false;
    }
  }

  public async disconnect(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect().catch(() => undefined);
      this.consumer = null;
    }
    if (this.producer) {
      await this.producer.disconnect().catch(() => undefined);
      this.producer = null;
    }
    this.state = 'DISCONNECTED';
  }
}
