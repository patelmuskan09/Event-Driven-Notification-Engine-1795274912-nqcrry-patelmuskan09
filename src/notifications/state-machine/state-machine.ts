import { v4 as uuidv4 } from 'uuid';
import {
  NotificationRecord,
  NotificationStatus,
  NotificationStateTransition,
} from '../../events/models/event';
import { DatabaseClient } from '../../database/db-client';
import { encryptPii } from '../../utils/crypto';

export class NotificationStateMachine {
  private static instance: NotificationStateMachine;
  private stateLogs: Map<string, NotificationStateTransition[]> = new Map();
  private notifications: Map<string, NotificationRecord> = new Map();
  private personalisationPayloads: Map<string, Record<string, unknown>> = new Map();

  private constructor() {}

  public static getInstance(): NotificationStateMachine {
    if (!NotificationStateMachine.instance) {
      NotificationStateMachine.instance = new NotificationStateMachine();
    }
    return NotificationStateMachine.instance;
  }

  public registerNotification(
    notification: NotificationRecord,
    personalisationData: Record<string, unknown> = {}
  ): void {
    this.notifications.set(notification.id, notification);
    this.personalisationPayloads.set(notification.id, personalisationData);

    const db = DatabaseClient.getInstance();
    if (db.isConnected()) {
      void db.query(
        `INSERT INTO notifications (
           id, created_at, event_id, user_id, event_type, category, priority, channel, status,
           recipient_address, subject, rendered_body, language, cost_inr, provider, retry_count,
           max_retries, correlation_id, personalisation_data
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (id, created_at) DO NOTHING`,
        [
          notification.id,
          notification.createdAt,
          notification.eventId,
          notification.userId,
          notification.eventType,
          notification.category,
          notification.priority,
          notification.channel,
          notification.status,
          encryptPii(notification.recipientAddress),
          notification.subject || null,
          notification.renderedBody,
          notification.language,
          notification.costInr,
          notification.provider,
          notification.retryCount,
          notification.maxRetries,
          notification.correlationId,
          JSON.stringify(personalisationData),
        ]
      );
    }

    this.transition(notification, 'CREATED', 'IngestionService', 'Notification entity created');
  }

  public transition(
    notification: NotificationRecord,
    newState: NotificationStatus,
    actorService: string,
    reason?: string,
    metadata?: Record<string, unknown>,
    providerResponse?: unknown
  ): NotificationStateTransition {
    const previousState = notification.status || 'CREATED';
    notification.status = newState;
    notification.updatedAt = new Date().toISOString();

    if (newState === 'DELIVERED') {
      notification.deliveredAt = notification.updatedAt;
    } else if (newState === 'READ') {
      notification.readAt = notification.updatedAt;
    }

    const logEntry: NotificationStateTransition = {
      id: uuidv4(),
      notificationId: notification.id,
      previousState,
      newState,
      timestamp: notification.updatedAt,
      actorService,
      retryCount: notification.retryCount,
      failureReason: reason,
      providerResponse,
      metadata,
    };

    const history = this.stateLogs.get(notification.id) || [];
    history.push(logEntry);
    this.stateLogs.set(notification.id, history);

    const db = DatabaseClient.getInstance();
    if (db.isConnected()) {
      void db.query(
        `UPDATE notifications
         SET status = $1, provider = $2, cost_inr = $3, external_provider_id = $4,
             retry_count = $5, failure_reason = $6, delivered_at = $7, read_at = $8, updated_at = $9
         WHERE id = $10`,
        [
          notification.status,
          notification.provider,
          notification.costInr,
          notification.externalProviderId || null,
          notification.retryCount,
          notification.failureReason || null,
          notification.deliveredAt || null,
          notification.readAt || null,
          notification.updatedAt,
          notification.id,
        ]
      );

      void db.query(
        `INSERT INTO notification_state_log (
           id, notification_id, previous_state, new_state, timestamp, actor_service,
           retry_count, failure_reason, provider_response, metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          logEntry.id,
          logEntry.notificationId,
          logEntry.previousState,
          logEntry.newState,
          logEntry.timestamp,
          logEntry.actorService,
          logEntry.retryCount,
          logEntry.failureReason || null,
          providerResponse ? JSON.stringify(providerResponse) : null,
          metadata ? JSON.stringify(metadata) : null,
        ]
      );
    }

    return logEntry;
  }

  public getNotification(notificationId: string): NotificationRecord | undefined {
    return this.notifications.get(notificationId);
  }

  public findByExternalId(externalId: string): NotificationRecord | undefined {
    for (const notif of this.notifications.values()) {
      if (notif.externalProviderId === externalId) return notif;
    }
    return undefined;
  }

  public getHistory(notificationId: string): NotificationStateTransition[] {
    return this.stateLogs.get(notificationId) || [];
  }

  public getAllNotifications(limit: number = 100): NotificationRecord[] {
    const list = Array.from(this.notifications.values());
    return list
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  /**
   * Section 16: Scrub personalisation content older than N days (default 90) while keeping analytics metadata.
   */
  public async scrubOldPersonalisation(retentionDays: number = 90): Promise<{ scrubbedCount: number }> {
    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let scrubbedCount = 0;

    for (const [id, notif] of this.notifications.entries()) {
      if (
        new Date(notif.createdAt).getTime() < cutoffMs &&
        notif.renderedBody !== '[SCRUBBED_90D_RETENTION]'
      ) {
        notif.renderedBody = '[SCRUBBED_90D_RETENTION]';
        notif.subject = '[SCRUBBED]';
        this.personalisationPayloads.set(id, { scrubbedAt: new Date().toISOString() });
        scrubbedCount++;
      }
    }

    const db = DatabaseClient.getInstance();
    if (db.isConnected()) {
      const res = await db.query(
        `UPDATE notifications
         SET personalisation_data = '{"scrubbed":true}'::jsonb,
             rendered_body = '[SCRUBBED_90D_RETENTION]'
         WHERE created_at < NOW() - ($1 || ' days')::interval
           AND rendered_body <> '[SCRUBBED_90D_RETENTION]'`,
        [retentionDays.toString()]
      );
      if (res && typeof res.rowCount === 'number') {
        scrubbedCount = Math.max(scrubbedCount, res.rowCount);
      }
    }

    return { scrubbedCount };
  }

  /**
   * Section 16 & 18: Right-to-Erasure API anonymisation for a user's notification records.
   */
  public async anonymiseUserRecords(userId: string): Promise<{ anonymisedCount: number }> {
    const anonUserId = `ANON-${userId.slice(-4)}`;
    let anonymisedCount = 0;

    for (const [id, notif] of this.notifications.entries()) {
      if (notif.userId === userId) {
        notif.userId = anonUserId;
        notif.recipientAddress = '[ANONYMISED]';
        notif.renderedBody = '[REDACTED_BY_USER_ERASURE_REQUEST]';
        notif.subject = '[REDACTED]';
        this.personalisationPayloads.set(id, { anonymised: true });
        anonymisedCount++;
      }
    }

    const db = DatabaseClient.getInstance();
    if (db.isConnected()) {
      const res = await db.query(
        `UPDATE notifications
         SET user_id = $2,
             recipient_address = '[ANONYMISED]',
             rendered_body = '[REDACTED_BY_USER_ERASURE_REQUEST]',
             personalisation_data = '{"anonymised":true}'::jsonb
         WHERE user_id = $1`,
        [userId, anonUserId]
      );
      await db.query(
        `UPDATE users
         SET full_name = 'Anonymised User',
             email = '[ANONYMISED]',
             phone = '[ANONYMISED]'
         WHERE id = $1`,
        [userId]
      );
      if (res && typeof res.rowCount === 'number') {
        anonymisedCount = Math.max(anonymisedCount, res.rowCount);
      }
    }

    return { anonymisedCount };
  }
}
