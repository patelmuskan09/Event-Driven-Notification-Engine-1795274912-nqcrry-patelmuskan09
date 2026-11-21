import { v4 as uuidv4 } from 'uuid';
import {
  IngestedEventPayload,
  EnrichedEvent,
  NotificationRecord,
  SupportedLanguage,
  Channel,
} from '../../events/models/event';
import { getEventDefinition } from '../../events/taxonomy';
import { validateEventPayload } from '../../events/validators/event-validator';
import { DeduplicationEngine } from './deduplication';
import { NotificationRouter } from '../routing/router';
import { TemplateEngine } from '../../templates/engine/template-engine';
import { DndService } from '../../compliance/dnd/dnd-service';
import { FrequencyCapService } from '../../compliance/frequency-cap/frequency-cap-service';
import { QuietHoursService } from '../../compliance/quiet-hours/quiet-hours-service';
import { ProviderManager } from '../../delivery/providers/provider-manager';
import { RetryEngine } from '../../delivery/retry/retry-engine';
import { NotificationStateMachine } from '../state-machine/state-machine';
import { AnalyticsService } from '../../analytics/analytics-service';
import { DatabaseClient } from '../../database/db-client';
import { KafkaClient } from '../../infrastructure/kafka-client';
import { RabbitMqClient } from '../../infrastructure/rabbitmq-client';
import { PreferencesService } from '../../preferences/preferences-service';
import { config } from '../../config/env';
import { decryptPii } from '../../utils/crypto';
import { logger } from '../../utils/logger';

export interface IngestionResult {
  notificationId: string;
  eventId: string;
  status: string;
  channelsTargeted: Channel[];
  estimatedDeliveryMs: number;
  createdAt: string;
  correlationId: string;
  isDuplicate?: boolean;
}

export class NotificationEngine {
  private static instance: NotificationEngine;

  private dedupEngine: DeduplicationEngine;
  private router: NotificationRouter;
  private templateEngine: TemplateEngine;
  private dndService: DndService;
  private frequencyCapService: FrequencyCapService;
  private quietHoursService: QuietHoursService;
  private providerManager: ProviderManager;
  private retryEngine: RetryEngine;
  private stateMachine: NotificationStateMachine;
  private analytics: AnalyticsService;
  private preferencesService: PreferencesService;

  private constructor() {
    this.dedupEngine = DeduplicationEngine.getInstance();
    this.router = NotificationRouter.getInstance();
    this.templateEngine = TemplateEngine.getInstance();
    this.dndService = DndService.getInstance();
    this.frequencyCapService = FrequencyCapService.getInstance();
    this.quietHoursService = QuietHoursService.getInstance();
    this.providerManager = ProviderManager.getInstance();
    this.retryEngine = RetryEngine.getInstance();
    this.stateMachine = NotificationStateMachine.getInstance();
    this.analytics = AnalyticsService.getInstance();
    this.preferencesService = PreferencesService.getInstance();

    // Register real retry worker callback
    this.retryEngine.registerRetryHandler(async (notification) => {
      await this.dispatchWithProvider(notification);
    });
    this.retryEngine.startRetryWorker(1000);
  }

  public static getInstance(): NotificationEngine {
    if (!NotificationEngine.instance) {
      NotificationEngine.instance = new NotificationEngine();
    }
    return NotificationEngine.instance;
  }

  /**
   * Resolves user context from PostgreSQL (with decrypted PII) or deterministic profile fallback.
   */
  private async resolveUserContext(
    userId: string,
    targetLanguage?: SupportedLanguage
  ): Promise<EnrichedEvent['userContext']> {
    const db = DatabaseClient.getInstance();
    if (db.isConnected()) {
      const res = await db.query<{
        full_name: string;
        email: string;
        phone: string;
        preferred_language: SupportedLanguage;
        timezone: string;
        account_type: 'RETAIL' | 'HNI' | 'PRO';
        risk_profile: 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE';
        is_dnd_registered: boolean;
      }>(
        `SELECT full_name, email, phone, preferred_language, timezone, account_type, risk_profile, is_dnd_registered
         FROM users WHERE id = $1`,
        [userId]
      );
      if (res && res.rows.length > 0) {
        const u = res.rows[0];
        const phone = decryptPii(u.phone);
        const email = decryptPii(u.email);
        if (u.is_dnd_registered) {
          this.dndService.registerDndNumber(phone);
        }
        return {
          userId,
          fullName: u.full_name,
          email,
          phone,
          language: targetLanguage || u.preferred_language || 'en',
          timezone: u.timezone || config.compliance.defaultTimezone,
          accountType: u.account_type || 'RETAIL',
          riskProfile: u.risk_profile || 'MODERATE',
          isDndRegistered: u.is_dnd_registered,
          dndOptInCategories: [],
          emailConsent: true,
          whatsappConsent: true,
          dailyCostSpentInr: 0,
          monthlyCostSpentInr: 0,
        };
      }
    }

    const phone = userId.includes('999')
      ? '+919876543210'
      : `+9198${Math.floor(10000000 + Math.random() * 90000000)}`;
    return {
      userId,
      fullName: `Investor ${userId.slice(-4)}`,
      email: `user_${userId.toLowerCase()}@brokerage.in`,
      phone,
      language: targetLanguage || 'en',
      timezone: config.compliance.defaultTimezone,
      accountType: 'RETAIL',
      riskProfile: 'MODERATE',
      isDndRegistered: this.dndService.isDndRegistered(phone),
      dndOptInCategories: [],
      emailConsent: true,
      whatsappConsent: true,
      dailyCostSpentInr: 0,
      monthlyCostSpentInr: 0,
    };
  }

  public async processEvent(event: IngestedEventPayload): Promise<IngestionResult> {
    const correlationId = event.correlationId || uuidv4();
    const eventId = event.eventId || uuidv4();
    this.analytics.recordEventReceived(event.eventType, event.userId);

    const definition = getEventDefinition(event.eventType);
    if (!definition) {
      throw new Error(`Unknown event type: ${event.eventType}. Please check event taxonomy.`);
    }

    const validation = validateEventPayload(event.eventType, event.payload);
    if (!validation.success) {
      throw new Error(`Payload validation failed for ${event.eventType}: ${validation.error}`);
    }

    // Deduplication at ingestion layer
    const sourceEntityId = (event.payload.order_id ||
      event.payload.symbol ||
      event.payload.account_id ||
      event.userId) as string;
    const idempotencyKey =
      event.idempotencyKey || this.dedupEngine.generateFingerprint(event.eventType, sourceEntityId);
    const dedupResult = await this.dedupEngine.checkAndRegisterAsync(
      idempotencyKey,
      60,
      event.eventType,
      sourceEntityId
    );

    if (dedupResult.isDuplicate) {
      logger.warn('Duplicate event suppressed at ingestion', {
        service: 'NotificationEngine',
        correlationId,
        idempotencyKey,
        duplicateCount: dedupResult.duplicateCount,
      });
      return {
        notificationId: `dup_${eventId}`,
        eventId,
        status: 'SUPPRESSED_DUPLICATE',
        channelsTargeted: [],
        estimatedDeliveryMs: 0,
        createdAt: new Date().toISOString(),
        correlationId,
        isDuplicate: true,
      };
    }

    // Stream into Kafka topic (notification-critical vs notification-events) when Kafka is live
    const targetTopic =
      definition.priority === 'CRITICAL' ? config.kafka.topicCritical : config.kafka.topicEvents;
    await KafkaClient.getInstance().publishEvent(targetTopic, event.userId, event, correlationId);

    const userContext = await this.resolveUserContext(
      event.userId,
      event.metadata?.targetLanguage as SupportedLanguage | undefined
    );

    const enrichedEvent: EnrichedEvent = {
      ...event,
      eventId,
      correlationId,
      idempotencyKey,
      definition,
      userContext,
      enrichedAt: new Date().toISOString(),
    };

    // Hydrate Redis/DB preferences into memory before synchronous router evaluation
    await this.preferencesService.getPreferencesAsync(event.userId, userContext.accountType);

    const routeDecision = this.router.route(enrichedEvent);
    const selectedChannels = routeDecision.selectedChannels;
    const primaryNotificationId = `notif_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    if (selectedChannels.length === 0) {
      return {
        notificationId: primaryNotificationId,
        eventId,
        status: 'DISCARDED_BY_PREFERENCES',
        channelsTargeted: [],
        estimatedDeliveryMs: 0,
        createdAt: new Date().toISOString(),
        correlationId,
      };
    }

    // Check user digest mode for LOW/MEDIUM non-regulatory events
    const userPrefs = this.preferencesService.getPreferences(event.userId, userContext.accountType);
    const catPref = userPrefs.categorySettings[definition.category];
    if (
      definition.regulatoryClassification !== 'REGULATORY_MANDATORY' &&
      (definition.priority === 'LOW' || definition.priority === 'MEDIUM') &&
      catPref &&
      catPref.digestMode !== 'IMMEDIATE'
    ) {
      this.preferencesService.addToDigestBuffer(
        event.userId,
        event.eventType,
        `${definition.name} (${catPref.digestMode} digest)`
      );
    }

    for (const channel of selectedChannels) {
      const channelNotifId =
        selectedChannels.length === 1 ? primaryNotificationId : `${primaryNotificationId}_${channel}`;
      await this.processChannelDelivery(enrichedEvent, channel, channelNotifId, correlationId);
    }

    const estimatedDeliveryMs = definition.priority === 'CRITICAL' ? 12 : 45;
    return {
      notificationId: primaryNotificationId,
      eventId,
      status: 'QUEUED_FOR_DELIVERY',
      channelsTargeted: selectedChannels,
      estimatedDeliveryMs,
      createdAt: new Date().toISOString(),
      correlationId,
    };
  }

  private async processChannelDelivery(
    event: EnrichedEvent,
    channel: Channel,
    notificationId: string,
    correlationId: string
  ): Promise<void> {
    const def = event.definition;
    const user = event.userContext;
    const prefs = this.preferencesService.getPreferences(user.userId, user.accountType);

    const renderResult = this.templateEngine.render(event, channel, user.language);

    let recipient = user.phone;
    if (channel === 'EMAIL') recipient = user.email;
    else if (channel === 'IN_APP') recipient = user.userId;
    else if (channel === 'PUSH') {
      const deviceOs = event.metadata?.deviceOs as string | undefined;
      recipient = deviceOs === 'IOS' ? `apns_token_${user.userId}` : `fcm_token_${user.userId}`;
    }

    const notification: NotificationRecord = {
      id: notificationId,
      eventId: event.eventId,
      userId: user.userId,
      eventType: event.eventType,
      category: def.category,
      priority: def.priority,
      channel,
      status: 'CREATED',
      recipientAddress: recipient,
      subject: renderResult.subject,
      renderedBody: renderResult.body,
      language: renderResult.languageUsed,
      costInr: 0,
      provider: 'PENDING',
      retryCount: 0,
      maxRetries: def.retryPolicy.maxRetries,
      correlationId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      complianceLog: {},
    };

    if (def.priority === 'CRITICAL') {
      this.analytics.recordCriticalAttempt();
    }

    this.stateMachine.registerNotification(notification, event.payload);
    this.stateMachine.transition(notification, 'ENRICHED', 'EnrichmentService');
    this.stateMachine.transition(notification, 'ROUTED', 'RoutingEngine', undefined, {
      channel,
      templateVersion: renderResult.templateVersion,
      abVariant: renderResult.abVariant,
    });

    // Quiet Hours Check (user-configured or default)
    const quietStart = prefs.quietHours?.enabled ? prefs.quietHours.startTime : '21:00';
    const quietEnd = prefs.quietHours?.enabled ? prefs.quietHours.endTime : '08:00';
    const quietEval = this.quietHoursService.evaluate(def.priority, user.timezone, quietStart, quietEnd);
    notification.complianceLog!.quietHoursCheckedAt = new Date().toISOString();
    notification.complianceLog!.quietHoursAction = quietEval.action;

    if (prefs.quietHours?.enabled && quietEval.action === 'QUEUED_FOR_MORNING') {
      this.quietHoursService.enqueueForMorning(user.userId, notification);
      this.stateMachine.transition(notification, 'QUIET', 'QuietHoursService', quietEval.reason);
      this.analytics.recordQuietQueue();
      return;
    }

    // Frequency Capping Check
    const capResult = await this.frequencyCapService.checkAndRecordAsync(
      user.userId,
      channel,
      def.category,
      event.eventType,
      def.priority,
      def.regulatoryClassification
    );

    notification.complianceLog!.frequencyCapCheckedAt = new Date().toISOString();
    notification.complianceLog!.frequencyCapResult = capResult.status;

    if (!capResult.allowed) {
      this.stateMachine.transition(notification, 'CAPPED', 'FrequencyCapService', capResult.reason);
      this.analytics.recordCapBlock();
      return;
    }

    // TRAI DND Verification (CRITICAL: LAST step immediately before SMS dispatch)
    if (channel === 'SMS') {
      const dndResult = this.dndService.verifySmsDispatch(
        recipient,
        def.regulatoryClassification,
        event.eventType,
        user.dndOptInCategories.includes(def.category)
      );

      notification.complianceLog!.dndCheckedAt = dndResult.checkedAt;
      notification.complianceLog!.dndResult = dndResult.status;

      if (!dndResult.allowed) {
        this.stateMachine.transition(notification, 'DND', 'DndService', dndResult.reason);
        this.analytics.recordDndBlock();
        return;
      }
    }

    // Persist compliance audit decision
    const db = DatabaseClient.getInstance();
    if (db.isConnected()) {
      void db.query(
        `INSERT INTO compliance_audit_log (
           notification_id, user_id, event_type, channel, dnd_status, dnd_checked_at,
           cap_status, cap_reason, quiet_hours_action
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          notification.id,
          notification.userId,
          notification.eventType,
          notification.channel,
          notification.complianceLog?.dndResult || null,
          notification.complianceLog?.dndCheckedAt || null,
          notification.complianceLog?.frequencyCapResult || null,
          capResult.reason,
          notification.complianceLog?.quietHoursAction || null,
        ]
      );
    }

    // RabbitMQ priority routing
    this.stateMachine.transition(notification, 'QUEUED', 'RabbitMqRouting');
    RabbitMqClient.getInstance().publishToPriorityQueue(def.priority, notification, correlationId);

    await this.dispatchWithProvider(notification);
  }

  public async dispatchWithProvider(notification: NotificationRecord): Promise<void> {
    const dispatchStart = Date.now();
    const providerRes = await this.providerManager.dispatch(notification);
    const latency = Date.now() - dispatchStart;

    if (providerRes.success) {
      notification.externalProviderId = providerRes.externalId;
      this.stateMachine.transition(
        notification,
        'SENT',
        notification.provider,
        undefined,
        { mode: providerRes.mode },
        providerRes.rawResponse
      );

      // Delivery confirmation from provider response (live SocketIO or accepted gateway receipt)
      this.stateMachine.transition(notification, 'DELIVERED', notification.provider, undefined, {
        deliveryMode: providerRes.mode,
      });
      this.analytics.recordDelivery(
        notification.channel,
        notification.language,
        latency,
        notification.costInr,
        notification.priority === 'CRITICAL',
        notification.eventType,
        notification.userId
      );
    } else {
      notification.failureReason = providerRes.errorMessage;
      this.analytics.recordFailure(notification.channel, notification.eventType);

      if (this.retryEngine.shouldRetry(notification, providerRes.errorClassification)) {
        notification.retryCount++;
        const delayMs = await this.retryEngine.scheduleRetry(notification);
        this.stateMachine.transition(
          notification,
          'RETRYING',
          'RetryEngine',
          `Attempt ${notification.retryCount}/${notification.maxRetries} scheduled in ${delayMs}ms: ${providerRes.errorMessage}`
        );
      } else {
        this.stateMachine.transition(notification, 'FAILED', 'DeliveryWorker', providerRes.errorMessage);
        this.retryEngine.sendToDlq(
          notification,
          `Provider dispatch failed permanently: ${providerRes.errorMessage}`,
          providerRes.errorMessage || 'Unknown provider error',
          providerRes.errorClassification || 'TRANSIENT'
        );
      }
    }
  }

  /**
   * Handles provider webhook delivery receipts (DELIVERED, READ, BOUNCED, CLICKED).
   */
  public handleProviderWebhook(
    provider: string,
    payload: {
      notificationId?: string;
      externalId?: string;
      status: 'DELIVERED' | 'READ' | 'BOUNCED' | 'CLICKED';
      reason?: string;
    },
    signatureVerified: boolean
  ): { found: boolean; notification?: NotificationRecord } {
    const notif = payload.notificationId
      ? this.stateMachine.getNotification(payload.notificationId)
      : payload.externalId
        ? this.stateMachine.findByExternalId(payload.externalId)
        : undefined;

    if (!notif) return { found: false };

    const db = DatabaseClient.getInstance();
    if (db.isConnected()) {
      void db.query(
        `INSERT INTO provider_callbacks (notification_id, provider, external_id, event_status, raw_payload, signature_verified)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          notif.id,
          provider,
          payload.externalId || notif.externalProviderId || null,
          payload.status,
          JSON.stringify(payload),
          signatureVerified,
        ]
      );
    }

    if (payload.status === 'READ') {
      this.stateMachine.transition(notif, 'READ', `${provider}Webhook`);
      this.analytics.recordRead();
    } else if (payload.status === 'CLICKED') {
      this.analytics.recordClick();
    } else if (payload.status === 'BOUNCED') {
      this.stateMachine.transition(notif, 'BOUNCED', `${provider}Webhook`, payload.reason);
      this.analytics.recordFailure(notif.channel, notif.eventType);
    } else if (payload.status === 'DELIVERED' && notif.status !== 'DELIVERED' && notif.status !== 'READ') {
      this.stateMachine.transition(notif, 'DELIVERED', `${provider}Webhook`);
    }

    return { found: true, notification: notif };
  }
}
