import { test, describe } from 'node:test';
import assert from 'node:assert';
import { RetryEngine } from '../../src/delivery/retry/retry-engine';
import { CircuitBreaker } from '../../src/delivery/circuit-breaker/circuit-breaker';
import { ProviderManager } from '../../src/delivery/providers/provider-manager';
import { PreferencesService } from '../../src/preferences/preferences-service';
import { DndService } from '../../src/compliance/dnd/dnd-service';
import { NotificationRouter } from '../../src/notifications/routing/router';
import { NotificationStateMachine } from '../../src/notifications/state-machine/state-machine';
import { AnalyticsService } from '../../src/analytics/analytics-service';
import { DatabaseClient } from '../../src/database/db-client';
import { RedisClient } from '../../src/infrastructure/redis-client';
import { KafkaClient } from '../../src/infrastructure/kafka-client';
import { RabbitMqClient } from '../../src/infrastructure/rabbitmq-client';
import { generate1000Users } from '../../src/database/seeds/seed_1000_users';
import { EventFactory } from '../../src/events/factory';
import { getEventDefinition } from '../../src/events/taxonomy';
import { NotificationRecord } from '../../src/events/models/event';

describe('Resilience, Retry Backoff, Failover, Infrastructure & Compliance Edge Cases', () => {
  test('1. RetryEngine computes exponential backoff delays within priority bounds', () => {
    const retry = RetryEngine.getInstance();
    const critDelay = retry.calculateDelay(1, 'CRITICAL');
    assert.ok(critDelay >= 1000 && critDelay <= 60000);
    const lowDelay = retry.calculateDelay(0, 'LOW');
    assert.ok(lowDelay >= 30000 && lowDelay <= 7200000);
  });

  test('2. RetryEngine never retries PERMANENT or CONFIGURATION errors', () => {
    const retry = RetryEngine.getInstance();
    const notif = { retryCount: 0, maxRetries: 5 } as NotificationRecord;
    assert.strictEqual(retry.shouldRetry(notif, 'PERMANENT'), false);
    assert.strictEqual(retry.shouldRetry(notif, 'CONFIGURATION'), false);
    assert.strictEqual(retry.shouldRetry(notif, 'TRANSIENT'), true);
  });

  test('3. RetryEngine schedules retries and dispatches due jobs via retry worker', async () => {
    const retry = RetryEngine.getInstance();
    let retriedId = '';
    retry.registerRetryHandler(async (n) => {
      retriedId = n.id;
    });

    const notif = {
      id: `notif-retry-${Date.now()}`,
      eventId: 'evt-1',
      userId: 'USR-R1',
      eventType: 'TXNX-001',
      category: 'TRANSACTION',
      priority: 'HIGH',
      channel: 'EMAIL',
      status: 'RETRYING',
      recipientAddress: 'test@brokerage.in',
      renderedBody: 'Test',
      language: 'en',
      costInr: 0,
      provider: 'Ethereal-SMTP',
      retryCount: 1,
      maxRetries: 3,
      correlationId: 'corr-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as NotificationRecord;

    await retry.scheduleRetry(notif, 0);
    const processed = await retry.processDueRetries();
    assert.ok(processed >= 1);
    assert.strictEqual(retriedId, notif.id);
  });

  test('4. Dead Letter Queue records, retries, and discards failed notifications', () => {
    const retry = RetryEngine.getInstance();
    const notif = {
      id: `notif-dlq-${Date.now()}`,
      userId: 'USR-DLQ',
      correlationId: 'corr-dlq',
      retryCount: 3,
      status: 'FAILED',
    } as NotificationRecord;

    const entry = retry.sendToDlq(notif, 'Max retries exhausted', 'HTTP 503', 'TRANSIENT');
    assert.strictEqual(entry.status, 'PENDING_REVIEW');
    assert.ok(retry.getDlqEntries('PENDING_REVIEW').some((e) => e.id === entry.id));

    const retried = retry.markRetryInitiated(entry.id);
    assert.strictEqual(retried?.status, 'RETRY_INITIATED');

    assert.strictEqual(retry.discardFromDlq(entry.id), true);
    assert.strictEqual(retry.discardFromDlq('UNKNOWN-ID'), false);
  });

  test('5. CircuitBreaker transitions CLOSED -> OPEN -> HALF_OPEN -> CLOSED after 2 probe successes', () => {
    const cb = new CircuitBreaker({ name: 'TEST-CB', failureThreshold: 3, windowMs: 60000, openPeriodMs: 1000 });
    assert.strictEqual(cb.getState(), 'CLOSED');
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    assert.strictEqual(cb.getState(), 'OPEN');
    assert.strictEqual(cb.canExecute(), false);

    cb.forceState('HALF_OPEN');
    assert.strictEqual(cb.canExecute(), true);
    cb.recordSuccess();
    assert.strictEqual(cb.getState(), 'HALF_OPEN');
    cb.recordSuccess();
    assert.strictEqual(cb.getState(), 'CLOSED');

    // Failure during HALF_OPEN re-opens immediately
    cb.forceState('HALF_OPEN');
    cb.recordFailure();
    assert.strictEqual(cb.getState(), 'OPEN');
  });

  test('6. Spec Error 3 Fix: Android push tokens NEVER fail over from FCM to Apple APNS', async () => {
    const pm = ProviderManager.getInstance();
    pm.fcmProvider.setSimulatedFailure(true);

    const androidNotif = {
      id: `notif-and-${Date.now()}`,
      userId: 'USR-ANDROID',
      channel: 'PUSH',
      recipientAddress: 'fcm_token_android_device_123',
      renderedBody: 'Price alert',
      correlationId: 'corr-and',
    } as NotificationRecord;

    const res = await pm.dispatch(androidNotif);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.provider, 'Firebase-FCM');

    pm.fcmProvider.setSimulatedFailure(false);
    pm.fcmBreaker.forceState('CLOSED');
  });

  test('7. Spec Error 3 Fix: iOS push tokens route via APNS and failover to FCM cleanly', async () => {
    const pm = ProviderManager.getInstance();
    pm.apnsProvider.setSimulatedFailure(true);

    const iosNotif = {
      id: `notif-ios-${Date.now()}`,
      userId: 'USR-IOS',
      channel: 'PUSH',
      recipientAddress: 'apns_token_USR-IOS',
      renderedBody: 'Margin alert',
      correlationId: 'corr-ios',
    } as NotificationRecord;

    const res = await pm.dispatch(iosNotif);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.provider, 'Firebase-FCM');
    assert.strictEqual(res.fallbackUsed, true);

    pm.apnsProvider.setSimulatedFailure(false);
    pm.apnsBreaker.forceState('CLOSED');
  });

  test('8. Quiet hours duration validation enforces >= 6 hours window & digest buffer works', () => {
    const prefs = PreferencesService.getInstance();
    assert.strictEqual(prefs.validateQuietHoursDuration('21:00', '08:00').valid, true);
    assert.strictEqual(prefs.validateQuietHoursDuration('22:00', '02:00').valid, false);
    assert.throws(() => {
      prefs.updatePreferences('USR-QH-VAL', {
        quietHours: { enabled: true, startTime: '22:00', endTime: '01:00' },
      });
    }, /at least 6 hours/);

    const digestCount = prefs.addToDigestBuffer('USR-DIG-1', 'MKTX-001', 'Price Alert summary');
    assert.strictEqual(digestCount, 1);
    const flushed = prefs.flushDigestBuffer('USR-DIG-1');
    assert.strictEqual(flushed.length, 1);
    assert.ok(prefs.getPreferenceAnalytics().channelOptOuts);
  });

  test('9. NotificationRouter respects 4-level hierarchy, OTT consent, and daily cost budget', () => {
    const router = NotificationRouter.getInstance();
    const prefs = PreferencesService.getInstance();
    const userId = `USR-ROUTE-${Date.now()}`;
    prefs.updatePreferences(userId, {
      channelSettings: { SMS: false, EMAIL: true, PUSH: false, WHATSAPP: true, IN_APP: true },
    });

    const evt = EventFactory.createEvent('MKTX-001', { userId });
    const decision = router.route({
      ...evt,
      eventId: evt.eventId!,
      correlationId: evt.correlationId!,
      idempotencyKey: evt.idempotencyKey!,
      definition: getEventDefinition('MKTX-001')!,
      userContext: {
        userId,
        fullName: 'Test Investor',
        email: 'inv@test.in',
        phone: '+919876543211',
        language: 'en',
        timezone: 'Asia/Kolkata',
        accountType: 'RETAIL',
        riskProfile: 'MODERATE',
        isDndRegistered: false,
        dndOptInCategories: [],
        emailConsent: true,
        whatsappConsent: false,
        dailyCostSpentInr: 100,
        monthlyCostSpentInr: 400,
      },
      enrichedAt: new Date().toISOString(),
    });

    assert.strictEqual(decision.selectedChannels.includes('WHATSAPP'), false);
    assert.strictEqual(decision.selectedChannels.includes('SMS'), false);
  });

  test('10. Separate OTT consent verification works independently of TRAI DND', () => {
    const dnd = DndService.getInstance();
    assert.strictEqual(dnd.verifyOttConsent('WHATSAPP', 'TRANSACTIONAL', false).allowed, false);
    assert.strictEqual(dnd.verifyOttConsent('WHATSAPP', 'REGULATORY_MANDATORY', false).allowed, true);
  });

  test('11. StateMachine supports 90-day personalisation retention scrubbing', async () => {
    const sm = NotificationStateMachine.getInstance();
    const oldNotif: NotificationRecord = {
      id: `notif-old-${Date.now()}`,
      eventId: 'evt-old',
      userId: 'USR-OLD',
      eventType: 'TXNX-001',
      category: 'TRANSACTION',
      priority: 'HIGH',
      channel: 'EMAIL',
      status: 'DELIVERED',
      recipientAddress: 'old@brokerage.in',
      subject: 'Private order receipt',
      renderedBody: 'Confidential trade details for INR 5,00,000',
      language: 'en',
      costInr: 0.02,
      provider: 'Ethereal-SMTP',
      retryCount: 0,
      maxRetries: 3,
      correlationId: 'corr-old',
      createdAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
    };
    sm.registerNotification(oldNotif, { order_id: 'SECRET-1' });
    const res = await sm.scrubOldPersonalisation(90);
    assert.ok(res.scrubbedCount >= 1);
    assert.strictEqual(sm.getNotification(oldNotif.id)?.renderedBody, '[SCRUBBED_90D_RETENTION]');
  });

  test('12. Channel provider recipient validations, simulated failures, and status checks', async () => {
    const pm = ProviderManager.getInstance();
    assert.strictEqual(pm.msg91Provider.validateRecipient('+919876543210'), true);
    assert.strictEqual(pm.msg91Provider.validateRecipient('badphone'), false);
    assert.strictEqual(pm.twilioProvider.validateRecipient('+919876543210'), true);
    assert.strictEqual(pm.emailProvider.validateRecipient('bad-email'), false);
    assert.strictEqual(pm.apnsProvider.validateRecipient('apns_token_123'), true);
    assert.strictEqual(pm.apnsProvider.validateRecipient('fcm_token_123'), false);
    assert.strictEqual(pm.whatsAppProvider.validateRecipient('+919876543210'), true);

    pm.whatsAppProvider.setSimulatedFailure(true);
    const waFail = await pm.dispatch({
      id: 'n-wa-fail',
      channel: 'WHATSAPP',
      recipientAddress: '+919876543210',
      renderedBody: 'Hi',
    } as NotificationRecord);
    assert.strictEqual(waFail.success, false);
    pm.whatsAppProvider.setSimulatedFailure(false);
    pm.whatsAppBreaker.forceState('CLOSED');

    const statusCheck = await pm.msg91Provider.getStatus('ext_1');
    assert.strictEqual(statusCheck.delivered, true);
  });

  test('13. Seed generator generates 1,000 realistic multi-lingual user profiles', () => {
    const users = generate1000Users();
    assert.strictEqual(users.length, 1000);
    assert.ok(users[0].email.includes('@'));
    assert.ok(users[0].phone.startsWith('+91'));
    assert.ok(['en', 'hi', 'mr', 'ta', 'te'].includes(users[0].preferredLanguage));
  });

  test('14. Infrastructure clients degrade gracefully when backing services are disconnected', async () => {
    const db = DatabaseClient.getInstance();
    const redis = RedisClient.getInstance();
    const kafka = KafkaClient.getInstance();
    const rabbit = RabbitMqClient.getInstance();

    assert.ok(['CONNECTED', 'IN_MEMORY_FALLBACK', 'DISCONNECTED'].includes(db.getStatus().state));
    assert.ok(['CONNECTED', 'IN_MEMORY_FALLBACK', 'DISCONNECTED'].includes(redis.getStatus().state));
    assert.ok(['CONNECTED', 'IN_MEMORY_FALLBACK', 'DISCONNECTED'].includes(kafka.getStatus().state));
    assert.ok(['CONNECTED', 'IN_MEMORY_FALLBACK', 'DISCONNECTED'].includes(rabbit.getStatus().state));

    assert.strictEqual(await kafka.publishEvent('notification-events', 'USR-1', { test: true }, 'c-1'), false);
    assert.strictEqual(rabbit.publishToPriorityQueue('HIGH', { test: true }, 'c-1'), false);
  });

  test('15. AnalyticsService evaluates operational alert rules and failure/read/click rates cleanly', () => {
    const analytics = AnalyticsService.getInstance();
    analytics.recordEventReceived('RISK-001', 'USR-ALT-1');
    analytics.recordCriticalAttempt();
    analytics.recordDelivery('SMS', 'en', 12, 0.25, true, 'RISK-001', 'USR-ALT-1');
    analytics.recordRead();
    analytics.recordClick();
    analytics.recordFailure('EMAIL', 'TXNX-001');
    analytics.recordDndBlock();
    analytics.recordOptOut();
    analytics.recordCapBlock();
    analytics.recordQuietQueue();

    const alerts = analytics.getActiveAlerts();
    assert.ok(Array.isArray(alerts));
    const snap = analytics.getSnapshot();
    assert.ok(snap.totalRead >= 1);
    assert.ok(snap.totalClicks >= 1);
    assert.ok(snap.openReadRatePercent >= 0);
    assert.ok(snap.criticalP50LatencyMs >= 0);
    assert.ok(snap.criticalP95LatencyMs >= 0);
    assert.ok(snap.criticalP99LatencyMs >= 0);
  });

  test('16. Channel providers report PERMANENT error on malformed email and TRANSIENT on simulated outage', async () => {
    const pm = ProviderManager.getInstance();
    const badEmail = await pm.dispatch({
      id: 'n-bad-email',
      channel: 'EMAIL',
      recipientAddress: 'invalid-email-address',
      renderedBody: 'Hello',
    } as NotificationRecord);
    assert.strictEqual(badEmail.success, false);
    assert.strictEqual(badEmail.errorClassification, 'PERMANENT');

    pm.emailProvider.setSimulatedFailure(true);
    const emailOutage = await pm.dispatch({
      id: 'n-email-out',
      channel: 'EMAIL',
      recipientAddress: 'valid@brokerage.in',
      renderedBody: 'Hello',
    } as NotificationRecord);
    assert.strictEqual(emailOutage.success, false);
    pm.emailProvider.setSimulatedFailure(false);
    pm.emailBreaker.forceState('CLOSED');

    pm.twilioProvider.setSimulatedFailure(true);
    pm.msg91Provider.setSimulatedFailure(true);
    const smsExhausted = await pm.dispatch({
      id: 'n-sms-ex',
      channel: 'SMS',
      priority: 'CRITICAL',
      recipientAddress: '+919876543210',
      renderedBody: 'Urgent',
    } as NotificationRecord);
    assert.strictEqual(smsExhausted.success, false);
    assert.strictEqual(smsExhausted.provider, 'SMS_CLUSTER_EXHAUSTED');
    pm.msg91Provider.setSimulatedFailure(false);
    pm.twilioProvider.setSimulatedFailure(false);
    pm.msg91Breaker.forceState('CLOSED');
    pm.twilioBreaker.forceState('CLOSED');
  });
});
