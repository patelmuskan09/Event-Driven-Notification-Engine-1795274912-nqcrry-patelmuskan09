import { EventPriority, NotificationRecord } from '../../events/models/event';
import { DatabaseClient } from '../../database/db-client';
import { RedisClient } from '../../infrastructure/redis-client';
import { RabbitMqClient } from '../../infrastructure/rabbitmq-client';
import { KafkaClient } from '../../infrastructure/kafka-client';
import { config } from '../../config/env';
import { logger } from '../../utils/logger';

export interface DlqEntry {
  id: string;
  notificationId: string;
  notification: NotificationRecord;
  reason: string;
  errorClassification: 'TRANSIENT' | 'PERMANENT' | 'CONFIGURATION';
  failedAt: string;
  attemptsMade: number;
  lastError: string;
  status: 'PENDING_REVIEW' | 'RETRY_INITIATED' | 'DISCARDED';
}

interface ScheduledRetryJob {
  notification: NotificationRecord;
  executeAt: number;
}

export class RetryEngine {
  private static instance: RetryEngine;
  private dlqEntries: Map<string, DlqEntry> = new Map();
  private inMemorySchedule: ScheduledRetryJob[] = [];
  private retryTimer: NodeJS.Timeout | null = null;
  private retryHandler?: (notification: NotificationRecord) => Promise<void>;
  private totalRetriesScheduled = 0;

  private constructor() {}

  public static getInstance(): RetryEngine {
    if (!RetryEngine.instance) {
      RetryEngine.instance = new RetryEngine();
    }
    return RetryEngine.instance;
  }

  public registerRetryHandler(handler: (notification: NotificationRecord) => Promise<void>): void {
    this.retryHandler = handler;
  }

  public startRetryWorker(intervalMs: number = 1000): void {
    if (this.retryTimer) return;
    this.retryTimer = setInterval(() => {
      void this.processDueRetries();
    }, intervalMs);
    if (this.retryTimer.unref) this.retryTimer.unref();
  }

  public stopRetryWorker(): void {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /**
   * Exponential backoff with jitter:
   * retryDelay = min(baseDelay * 2^attempt + randomJitter(0, 1000), maxDelay)
   */
  public calculateDelay(attempt: number, priority: EventPriority): number {
    let baseDelay = 1000;
    let maxDelay = 300000;

    switch (priority) {
      case 'CRITICAL':
        baseDelay = 500;
        maxDelay = 60000;
        break;
      case 'HIGH':
        baseDelay = 1000;
        maxDelay = 300000;
        break;
      case 'MEDIUM':
        baseDelay = 5000;
        maxDelay = 1800000;
        break;
      case 'LOW':
        baseDelay = 30000;
        maxDelay = 7200000;
        break;
    }

    const exponential = baseDelay * Math.pow(2, attempt);
    const jitter = Math.floor(Math.random() * 1000);
    return Math.min(exponential + jitter, maxDelay);
  }

  public shouldRetry(
    notification: NotificationRecord,
    errorClassification?: 'TRANSIENT' | 'PERMANENT' | 'CONFIGURATION'
  ): boolean {
    if (errorClassification === 'PERMANENT' || errorClassification === 'CONFIGURATION') {
      return false;
    }
    return notification.retryCount < notification.maxRetries;
  }

  public async scheduleRetry(notification: NotificationRecord, customDelayMs?: number): Promise<number> {
    const delayMs =
      customDelayMs !== undefined
        ? customDelayMs
        : this.calculateDelay(notification.retryCount, notification.priority);
    const executeAt = Date.now() + delayMs;
    this.totalRetriesScheduled++;

    const redis = RedisClient.getInstance();
    const storedInRedis = await redis.zadd(
      'retry:schedule',
      executeAt,
      JSON.stringify({ notification, executeAt })
    );

    if (!storedInRedis) {
      this.inMemorySchedule.push({ notification, executeAt });
    }
    return delayMs;
  }

  public async processDueRetries(): Promise<number> {
    const now = Date.now();
    let processed = 0;

    const redis = RedisClient.getInstance();
    const dueJson = await redis.zrangeByScoreAndRemove('retry:schedule', now);
    const dueJobs: ScheduledRetryJob[] = dueJson
      .map((raw) => {
        try {
          return JSON.parse(raw) as ScheduledRetryJob;
        } catch {
          return null;
        }
      })
      .filter((x): x is ScheduledRetryJob => x !== null);

    const remaining: ScheduledRetryJob[] = [];
    for (const job of this.inMemorySchedule) {
      if (job.executeAt <= now) {
        dueJobs.push(job);
      } else {
        remaining.push(job);
      }
    }
    this.inMemorySchedule = remaining;

    for (const job of dueJobs) {
      if (this.retryHandler) {
        await this.retryHandler(job.notification);
        processed++;
      }
    }
    return processed;
  }

  public sendToDlq(
    notification: NotificationRecord,
    reason: string,
    lastError: string,
    errorClassification: 'TRANSIENT' | 'PERMANENT' | 'CONFIGURATION' = 'TRANSIENT'
  ): DlqEntry {
    notification.status = 'DLQ';
    const entry: DlqEntry = {
      id: `dlq_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      notificationId: notification.id,
      notification,
      reason,
      errorClassification,
      failedAt: new Date().toISOString(),
      attemptsMade: notification.retryCount,
      lastError,
      status: 'PENDING_REVIEW',
    };

    this.dlqEntries.set(entry.id, entry);
    logger.warn('Notification moved to Dead Letter Queue', {
      service: 'RetryEngine',
      correlationId: notification.correlationId,
      notificationId: notification.id,
      reason,
      errorClassification,
    });

    // Persist to PostgreSQL & forward to Kafka/RabbitMQ DLQs asynchronously when active
    const db = DatabaseClient.getInstance();
    if (db.isConnected()) {
      void db.query(
        `INSERT INTO dead_letter_queue (id, notification_id, user_id, reason, error_classification, attempts_made, last_error, status, failed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [
          entry.id,
          entry.notificationId,
          notification.userId,
          entry.reason,
          entry.errorClassification,
          entry.attemptsMade,
          entry.lastError,
          entry.status,
          entry.failedAt,
        ]
      );
    }
    void KafkaClient.getInstance().publishEvent(
      config.kafka.topicDlq,
      notification.userId,
      entry,
      notification.correlationId
    );
    RabbitMqClient.getInstance().publishToDlq(entry, notification.correlationId);

    return entry;
  }

  public getDlqEntries(filterStatus?: DlqEntry['status']): DlqEntry[] {
    const all = Array.from(this.dlqEntries.values());
    if (filterStatus) {
      return all.filter((e) => e.status === filterStatus);
    }
    return all.sort((a, b) => new Date(b.failedAt).getTime() - new Date(a.failedAt).getTime());
  }

  public discardFromDlq(dlqId: string): boolean {
    const entry = this.dlqEntries.get(dlqId);
    if (!entry) return false;
    entry.status = 'DISCARDED';

    const db = DatabaseClient.getInstance();
    if (db.isConnected()) {
      void db.query(`UPDATE dead_letter_queue SET status = 'DISCARDED', resolved_at = NOW() WHERE id = $1`, [
        dlqId,
      ]);
    }
    return true;
  }

  public markRetryInitiated(dlqId: string): DlqEntry | null {
    const entry = this.dlqEntries.get(dlqId);
    if (!entry) return null;
    entry.status = 'RETRY_INITIATED';

    const db = DatabaseClient.getInstance();
    if (db.isConnected()) {
      void db.query(
        `UPDATE dead_letter_queue SET status = 'RETRY_INITIATED', resolved_at = NOW() WHERE id = $1`,
        [dlqId]
      );
    }

    if (this.retryHandler) {
      void this.retryHandler(entry.notification);
    }
    return entry;
  }

  public getDlqDepth(): number {
    return Array.from(this.dlqEntries.values()).filter((e) => e.status === 'PENDING_REVIEW').length;
  }

  public getRetryStats() {
    return {
      totalRetriesScheduled: this.totalRetriesScheduled,
      pendingRetryJobs: this.inMemorySchedule.length,
      dlqDepth: this.getDlqDepth(),
    };
  }
}
