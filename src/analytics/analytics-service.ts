import { Channel, SupportedLanguage } from '../events/models/event';
import { ProviderManager } from '../delivery/providers/provider-manager';
import { RetryEngine } from '../delivery/retry/retry-engine';
import { KafkaClient } from '../infrastructure/kafka-client';
import { FrequencyCapService } from '../compliance/frequency-cap/frequency-cap-service';

export interface OperationalAlert {
  id: string;
  severity: 'CRITICAL' | 'WARNING';
  rule: string;
  message: string;
  triggeredAt: string;
}

export interface RealtimeMetrics {
  totalEventsReceived: number;
  totalDelivered: number;
  totalRead: number;
  totalClicks: number;
  totalFailed: number;
  totalDndBlocked: number;
  totalDndViolations: number;
  totalCapBlocked: number;
  totalQuietQueued: number;
  totalCriticalAttempted: number;
  totalCriticalDelivered: number;
  criticalDeliveryRatePercent: number;
  criticalP50LatencyMs: number;
  criticalP95LatencyMs: number;
  criticalP99LatencyMs: number;
  deliveryRatePercent: number;
  openReadRatePercent: number;
  clickThroughRatePercent: number;
  failureRatePercent: number;
  optOutRatePercent: number;
  avgCostPerNotificationInr: number;
  totalCostInr: number;
  channelBreakdown: Record<Channel, { sent: number; delivered: number; failed: number }>;
  providerBreakdown: Record<string, { requests: number; failures: number; circuitState: string }>;
  eventTypeBreakdown: Record<string, { received: number; delivered: number; failed: number }>;
  languageBreakdown: Record<SupportedLanguage, { delivered: number }>;
  userCostsInr: Record<string, number>;
}

export class AnalyticsService {
  private static instance: AnalyticsService;

  private eventsReceived = 0;
  private deliveredCount = 0;
  private readCount = 0;
  private clickCount = 0;
  private failedCount = 0;
  private dndBlockedCount = 0;
  private dndViolationsCount = 0;
  private capBlockedCount = 0;
  private quietQueuedCount = 0;
  private criticalAttemptedCount = 0;
  private criticalDeliveredCount = 0;
  private criticalLatencies: number[] = [];
  private totalCost = 0;
  private optOutEvents = 0;
  private totalUsersInteracted = new Set<string>();
  private userCostMap: Map<string, number> = new Map();

  private channelStats: Record<Channel, { sent: number; delivered: number; failed: number }> = {
    SMS: { sent: 0, delivered: 0, failed: 0 },
    EMAIL: { sent: 0, delivered: 0, failed: 0 },
    PUSH: { sent: 0, delivered: 0, failed: 0 },
    WHATSAPP: { sent: 0, delivered: 0, failed: 0 },
    IN_APP: { sent: 0, delivered: 0, failed: 0 },
  };

  private eventTypeStats: Record<string, { received: number; delivered: number; failed: number }> = {};

  private languageStats: Record<SupportedLanguage, { delivered: number }> = {
    en: { delivered: 0 },
    hi: { delivered: 0 },
    mr: { delivered: 0 },
    ta: { delivered: 0 },
    te: { delivered: 0 },
  };

  private constructor() {}

  public static getInstance(): AnalyticsService {
    if (!AnalyticsService.instance) {
      AnalyticsService.instance = new AnalyticsService();
    }
    return AnalyticsService.instance;
  }

  public recordEventReceived(eventType?: string, userId?: string): void {
    this.eventsReceived++;
    if (eventType) {
      if (!this.eventTypeStats[eventType]) {
        this.eventTypeStats[eventType] = { received: 0, delivered: 0, failed: 0 };
      }
      this.eventTypeStats[eventType].received++;
    }
    if (userId) this.totalUsersInteracted.add(userId);
  }

  public recordCriticalAttempt(): void {
    this.criticalAttemptedCount++;
  }

  public recordDelivery(
    channel: Channel,
    language: SupportedLanguage,
    latencyMs: number,
    costInr: number,
    isCritical: boolean = false,
    eventType?: string,
    userId?: string
  ): void {
    this.deliveredCount++;
    this.totalCost += costInr;
    this.channelStats[channel].sent++;
    this.channelStats[channel].delivered++;

    if (this.languageStats[language]) {
      this.languageStats[language].delivered++;
    }
    if (eventType) {
      if (!this.eventTypeStats[eventType]) {
        this.eventTypeStats[eventType] = { received: 0, delivered: 0, failed: 0 };
      }
      this.eventTypeStats[eventType].delivered++;
    }
    if (userId) {
      this.userCostMap.set(userId, (this.userCostMap.get(userId) || 0) + costInr);
    }

    if (isCritical) {
      this.criticalDeliveredCount++;
      this.criticalLatencies.push(latencyMs);
      if (this.criticalLatencies.length > 5000) {
        this.criticalLatencies.shift();
      }
    }
  }

  public recordRead(): void {
    this.readCount++;
  }

  public recordClick(): void {
    this.clickCount++;
  }

  public recordFailure(channel: Channel, eventType?: string): void {
    this.failedCount++;
    this.channelStats[channel].failed++;
    if (eventType) {
      if (!this.eventTypeStats[eventType]) {
        this.eventTypeStats[eventType] = { received: 0, delivered: 0, failed: 0 };
      }
      this.eventTypeStats[eventType].failed++;
    }
  }

  public recordDndBlock(): void {
    this.dndBlockedCount++;
  }

  public recordOptOut(): void {
    this.optOutEvents++;
  }

  public recordCapBlock(): void {
    this.capBlockedCount++;
  }

  public recordQuietQueue(): void {
    this.quietQueuedCount++;
  }

  private calculatePercentile(percentile: number): number {
    if (this.criticalLatencies.length === 0) return 0;
    const sorted = [...this.criticalLatencies].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.floor(sorted.length * percentile));
    return sorted[index];
  }

  public calculateP99CriticalLatency(): number {
    return this.calculatePercentile(0.99);
  }

  public getSnapshot(): RealtimeMetrics {
    const totalDispatches = this.deliveredCount + this.failedCount;
    const deliveryRate = totalDispatches > 0 ? (this.deliveredCount / totalDispatches) * 100 : 0;
    const failureRate = totalDispatches > 0 ? (this.failedCount / totalDispatches) * 100 : 0;
    const openRate = this.deliveredCount > 0 ? (this.readCount / this.deliveredCount) * 100 : 0;
    const ctr = this.deliveredCount > 0 ? (this.clickCount / this.deliveredCount) * 100 : 0;
    const criticalRate =
      this.criticalAttemptedCount > 0 ? (this.criticalDeliveredCount / this.criticalAttemptedCount) * 100 : 0;
    const optOutRate = this.eventsReceived > 0 ? (this.optOutEvents / this.eventsReceived) * 100 : 0;
    const avgCost = this.deliveredCount > 0 ? this.totalCost / this.deliveredCount : 0;

    return {
      totalEventsReceived: this.eventsReceived,
      totalDelivered: this.deliveredCount,
      totalRead: this.readCount,
      totalClicks: this.clickCount,
      totalFailed: this.failedCount,
      totalDndBlocked: this.dndBlockedCount,
      totalDndViolations: this.dndViolationsCount,
      totalCapBlocked: this.capBlockedCount,
      totalQuietQueued: this.quietQueuedCount,
      totalCriticalAttempted: this.criticalAttemptedCount,
      totalCriticalDelivered: this.criticalDeliveredCount,
      criticalDeliveryRatePercent: Number(criticalRate.toFixed(2)),
      criticalP50LatencyMs: this.calculatePercentile(0.5),
      criticalP95LatencyMs: this.calculatePercentile(0.95),
      criticalP99LatencyMs: this.calculatePercentile(0.99),
      deliveryRatePercent: Number(deliveryRate.toFixed(2)),
      openReadRatePercent: Number(openRate.toFixed(2)),
      clickThroughRatePercent: Number(ctr.toFixed(2)),
      failureRatePercent: Number(failureRate.toFixed(2)),
      optOutRatePercent: Number(optOutRate.toFixed(2)),
      avgCostPerNotificationInr: Number(avgCost.toFixed(4)),
      totalCostInr: Number(this.totalCost.toFixed(2)),
      channelBreakdown: { ...this.channelStats },
      providerBreakdown: ProviderManager.getInstance().getProviderBreakdown(),
      eventTypeBreakdown: { ...this.eventTypeStats },
      languageBreakdown: { ...this.languageStats },
      userCostsInr: Object.fromEntries(this.userCostMap.entries()),
    };
  }

  /**
   * Evaluates all 7 Section 17 operational alerting conditions against real runtime state.
   */
  public getActiveAlerts(): OperationalAlert[] {
    const alerts: OperationalAlert[] = [];
    const now = new Date().toISOString();
    const dlqDepth = RetryEngine.getInstance().getDlqDepth();
    const kafkaStatus = KafkaClient.getInstance().getStatus();
    const capAnalytics = FrequencyCapService.getInstance().getCapAnalytics();
    const breakers = ProviderManager.getInstance().getCircuitBreakerStatuses();

    if (dlqDepth > 100) {
      alerts.push({
        id: 'ALT-DLQ-DEPTH',
        severity: 'CRITICAL',
        rule: 'DLQ depth > 100',
        message: `Dead letter queue depth is ${dlqDepth} (threshold: 100).`,
        triggeredAt: now,
      });
    }

    for (const cb of breakers) {
      if (cb.state === 'OPEN') {
        alerts.push({
          id: `ALT-CB-${cb.name}`,
          severity: 'CRITICAL',
          rule: 'Provider Circuit Breaker OPEN',
          message: `Circuit breaker for provider ${cb.name} is OPEN.`,
          triggeredAt: cb.stateChangedAt,
        });
      }
    }

    const p99 = this.calculateP99CriticalLatency();
    if (p99 > 30000) {
      alerts.push({
        id: 'ALT-CRIT-P99',
        severity: 'CRITICAL',
        rule: 'CRITICAL P99 latency > 30s',
        message: `Critical event P99 latency is ${p99}ms.`,
        triggeredAt: now,
      });
    }

    const total = this.deliveredCount + this.failedCount;
    if (total >= 10 && (this.failedCount / total) * 100 > 5) {
      alerts.push({
        id: 'ALT-FAIL-RATE',
        severity: 'WARNING',
        rule: 'Delivery failure rate > 5%',
        message: `Current failure rate is ${((this.failedCount / total) * 100).toFixed(2)}%.`,
        triggeredAt: now,
      });
    }

    if (kafkaStatus.estimatedLag > 10000) {
      alerts.push({
        id: 'ALT-KAFKA-LAG',
        severity: 'WARNING',
        rule: 'Kafka consumer lag > 10,000',
        message: `Kafka consumer lag is ${kafkaStatus.estimatedLag}.`,
        triggeredAt: now,
      });
    }

    if (capAnalytics.uniqueUsersTracked >= 5 && capAnalytics.percentUsersAtDailyCap > 50) {
      alerts.push({
        id: 'ALT-FREQ-CAP-SPIKE',
        severity: 'WARNING',
        rule: '>50% users hitting daily cap',
        message: `${capAnalytics.percentUsersAtDailyCap}% of active users reached daily frequency cap.`,
        triggeredAt: now,
      });
    }

    if (this.dndViolationsCount > 0) {
      alerts.push({
        id: 'ALT-DND-VIOLATION',
        severity: 'CRITICAL',
        rule: 'Zero DND violations breached',
        message: `${this.dndViolationsCount} DND violation(s) detected.`,
        triggeredAt: now,
      });
    }

    return alerts;
  }

  /**
   * Generates Prometheus exposition format with all 9 required Section 17 metrics.
   */
  public getPrometheusMetrics(): string {
    const p99 = this.calculateP99CriticalLatency() / 1000;
    const dlqDepth = RetryEngine.getInstance().getDlqDepth();
    const retryCount = RetryEngine.getInstance().getRetryStats().totalRetriesScheduled;
    const kafkaLag = KafkaClient.getInstance().getStatus().estimatedLag;
    const breakers = ProviderManager.getInstance().getCircuitBreakerStatuses();

    const circuitMetrics = breakers
      .map((cb) => {
        const val = cb.state === 'CLOSED' ? 0 : cb.state === 'HALF_OPEN' ? 1 : 2;
        return `delivery_provider_circuit_state{provider="${cb.name}"} ${val}`;
      })
      .join('\n');

    return `
# HELP notification_events_received_total Total events received by ingestion API
# TYPE notification_events_received_total counter
notification_events_received_total ${this.eventsReceived}

# HELP notification_delivery_total Total delivered notifications by channel
# TYPE notification_delivery_total counter
notification_delivery_total{channel="SMS"} ${this.channelStats.SMS.delivered}
notification_delivery_total{channel="EMAIL"} ${this.channelStats.EMAIL.delivered}
notification_delivery_total{channel="PUSH"} ${this.channelStats.PUSH.delivered}
notification_delivery_total{channel="WHATSAPP"} ${this.channelStats.WHATSAPP.delivered}
notification_delivery_total{channel="IN_APP"} ${this.channelStats.IN_APP.delivered}

# HELP notification_delivery_latency_seconds Critical delivery latency P99 in seconds
# TYPE notification_delivery_latency_seconds gauge
notification_delivery_latency_seconds{priority="CRITICAL"} ${p99.toFixed(3)}

# HELP notification_frequency_cap_hits_total Total frequency cap rejections
# TYPE notification_frequency_cap_hits_total counter
notification_frequency_cap_hits_total ${this.capBlockedCount}

# HELP notification_dnd_blocks_total Total TRAI DND blocks
# TYPE notification_dnd_blocks_total counter
notification_dnd_blocks_total ${this.dndBlockedCount}

# HELP notification_dlq_depth Current depth of dead letter queue
# TYPE notification_dlq_depth gauge
notification_dlq_depth ${dlqDepth}

# HELP notification_retry_total Total retry attempts scheduled
# TYPE notification_retry_total counter
notification_retry_total ${retryCount}

# HELP kafka_consumer_lag Estimated Kafka consumer lag
# TYPE kafka_consumer_lag gauge
kafka_consumer_lag ${kafkaLag}

# HELP delivery_provider_circuit_state Circuit breaker state (0=CLOSED, 1=HALF_OPEN, 2=OPEN)
# TYPE delivery_provider_circuit_state gauge
${circuitMetrics}
`.trim();
  }
}
