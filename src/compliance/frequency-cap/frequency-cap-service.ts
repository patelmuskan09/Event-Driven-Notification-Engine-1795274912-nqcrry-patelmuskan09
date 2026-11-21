import { Channel, EventCategory, EventPriority, RegulatoryClassification } from '../../events/models/event';
import { config } from '../../config/env';
import { RedisClient } from '../../infrastructure/redis-client';

export interface FrequencyCapLimits {
  globalUserDailyCap: number;
  smsDailyCap: number;
  pushDailyCap: number;
  emailDailyCap: number;
  categoryHourlyCap: number;
  sameEventCooldownMs: number;
  weeklyDigestThresholdPerDay: number;
}

export const DEFAULT_CAP_LIMITS: FrequencyCapLimits = {
  globalUserDailyCap: config.compliance.globalUserDailyCap,
  smsDailyCap: config.compliance.smsDailyCap,
  pushDailyCap: config.compliance.pushDailyCap,
  emailDailyCap: config.compliance.emailDailyCap,
  categoryHourlyCap: config.compliance.categoryHourlyCap,
  sameEventCooldownMs: config.compliance.sameEventCooldownMinutes * 60 * 1000,
  weeklyDigestThresholdPerDay: 8,
};

export interface CapEvaluationResult {
  allowed: boolean;
  bypassed: boolean;
  status: 'PASS' | 'BLOCKED' | 'CRITICAL_BYPASS';
  reason: string;
  suggestDigest?: boolean;
  counters: {
    userDailyCount: number;
    channelDailyCount: number;
    categoryHourlyCount: number;
    lastEventTimestamp?: number;
  };
}

export class FrequencyCapService {
  private static instance: FrequencyCapService;
  private limits: FrequencyCapLimits = { ...DEFAULT_CAP_LIMITS };

  // In-memory sliding window store (also used as fallback if Redis is offline)
  private userDeliveries: Map<
    string,
    { timestamp: number; channel: Channel; category: EventCategory; eventType: string }[]
  > = new Map();
  private capDecisionsLog: Array<{
    userId: string;
    eventType: string;
    channel: Channel;
    result: CapEvaluationResult;
    timestamp: string;
  }> = [];

  private constructor() {}

  public static getInstance(): FrequencyCapService {
    if (!FrequencyCapService.instance) {
      FrequencyCapService.instance = new FrequencyCapService();
    }
    return FrequencyCapService.instance;
  }

  /**
   * Async variant that leverages Redis atomic Lua sliding-window counters when Redis is connected.
   */
  public async checkAndRecordAsync(
    userId: string,
    channel: Channel,
    category: EventCategory,
    eventType: string,
    priority: EventPriority,
    regulatoryClassification: RegulatoryClassification,
    recordIfPassed: boolean = true
  ): Promise<CapEvaluationResult> {
    const redis = RedisClient.getInstance();
    if (
      redis.isConnected() &&
      priority !== 'CRITICAL' &&
      regulatoryClassification !== 'REGULATORY_MANDATORY' &&
      recordIfPassed
    ) {
      const uid = `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      const globalCheck = await redis.checkSlidingWindowLua(
        `cap:user:${userId}:daily`,
        24 * 3600 * 1000,
        this.limits.globalUserDailyCap,
        uid
      );
      if (globalCheck && !globalCheck.allowed) {
        const blocked: CapEvaluationResult = {
          allowed: false,
          bypassed: false,
          status: 'BLOCKED',
          reason: `Global user daily cap exceeded (${globalCheck.currentCount}/${this.limits.globalUserDailyCap} in 24h via Redis atomic window)`,
          counters: {
            userDailyCount: globalCheck.currentCount,
            channelDailyCount: 0,
            categoryHourlyCount: 0,
          },
        };
        this.logDecision(userId, eventType, channel, blocked);
        return blocked;
      }
    }

    return this.checkAndRecord(
      userId,
      channel,
      category,
      eventType,
      priority,
      regulatoryClassification,
      recordIfPassed
    );
  }

  public checkAndRecord(
    userId: string,
    channel: Channel,
    category: EventCategory,
    eventType: string,
    priority: EventPriority,
    regulatoryClassification: RegulatoryClassification,
    recordIfPassed: boolean = true
  ): CapEvaluationResult {
    const now = Date.now();
    const rolling24Hours = now - 24 * 60 * 60 * 1000;
    const rolling60Minutes = now - 60 * 60 * 1000;

    let history = this.userDeliveries.get(userId) || [];
    history = history.filter((entry) => entry.timestamp > rolling24Hours);
    this.userDeliveries.set(userId, history);

    // 1. CRITICAL / Regulatory Mandatory bypass (SEBI liquidation protection)
    if (priority === 'CRITICAL' || regulatoryClassification === 'REGULATORY_MANDATORY') {
      const result: CapEvaluationResult = {
        allowed: true,
        bypassed: true,
        status: 'CRITICAL_BYPASS',
        reason: 'CRITICAL priority / Regulatory mandatory notification bypassed frequency caps.',
        counters: {
          userDailyCount: history.length,
          channelDailyCount: history.filter((e) => e.channel === channel).length,
          categoryHourlyCount: history.filter(
            (e) => e.category === category && e.timestamp > rolling60Minutes
          ).length,
        },
      };

      if (recordIfPassed) {
        history.push({ timestamp: now, channel, category, eventType });
      }

      this.logDecision(userId, eventType, channel, result);
      return result;
    }

    // 2. Global user daily cap (12)
    const userDailyCount = history.length;
    if (userDailyCount >= this.limits.globalUserDailyCap) {
      const result: CapEvaluationResult = {
        allowed: false,
        bypassed: false,
        status: 'BLOCKED',
        reason: `Global user daily cap exceeded (${userDailyCount}/${this.limits.globalUserDailyCap} in 24h)`,
        suggestDigest: true,
        counters: { userDailyCount, channelDailyCount: 0, categoryHourlyCount: 0 },
      };
      this.logDecision(userId, eventType, channel, result);
      return result;
    }

    // 3. Channel daily cap
    const channelDailyCount = history.filter((e) => e.channel === channel).length;
    let channelLimit = 999;
    if (channel === 'SMS') channelLimit = this.limits.smsDailyCap;
    else if (channel === 'PUSH') channelLimit = this.limits.pushDailyCap;
    else if (channel === 'EMAIL') channelLimit = this.limits.emailDailyCap;

    if (channelDailyCount >= channelLimit) {
      const result: CapEvaluationResult = {
        allowed: false,
        bypassed: false,
        status: 'BLOCKED',
        reason: `${channel} daily frequency cap exceeded (${channelDailyCount}/${channelLimit} in 24h)`,
        counters: { userDailyCount, channelDailyCount, categoryHourlyCount: 0 },
      };
      this.logDecision(userId, eventType, channel, result);
      return result;
    }

    // 4. Category hourly cap (3 in 60 mins)
    const categoryHourlyCount = history.filter(
      (e) => e.category === category && e.timestamp > rolling60Minutes
    ).length;
    if (categoryHourlyCount >= this.limits.categoryHourlyCap) {
      const result: CapEvaluationResult = {
        allowed: false,
        bypassed: false,
        status: 'BLOCKED',
        reason: `${category} category hourly cap exceeded (${categoryHourlyCount}/${this.limits.categoryHourlyCap} in 60m)`,
        counters: { userDailyCount, channelDailyCount, categoryHourlyCount },
      };
      this.logDecision(userId, eventType, channel, result);
      return result;
    }

    // 5. Same event-type cooldown (15 minutes)
    const lastSameEvent = history
      .filter((e) => e.eventType === eventType)
      .sort((a, b) => b.timestamp - a.timestamp)[0];

    if (lastSameEvent && now - lastSameEvent.timestamp < this.limits.sameEventCooldownMs) {
      const remainingSeconds = Math.ceil(
        (this.limits.sameEventCooldownMs - (now - lastSameEvent.timestamp)) / 1000
      );
      const result: CapEvaluationResult = {
        allowed: false,
        bypassed: false,
        status: 'BLOCKED',
        reason: `Same event-type cooldown active. Retry in ${remainingSeconds}s.`,
        counters: {
          userDailyCount,
          channelDailyCount,
          categoryHourlyCount,
          lastEventTimestamp: lastSameEvent.timestamp,
        },
      };
      this.logDecision(userId, eventType, channel, result);
      return result;
    }

    const nextDailyCount = userDailyCount + 1;
    const result: CapEvaluationResult = {
      allowed: true,
      bypassed: false,
      status: 'PASS',
      reason: 'All frequency capping criteria met',
      suggestDigest: nextDailyCount > this.limits.weeklyDigestThresholdPerDay,
      counters: {
        userDailyCount: nextDailyCount,
        channelDailyCount: channelDailyCount + 1,
        categoryHourlyCount: categoryHourlyCount + 1,
      },
    };

    if (recordIfPassed) {
      history.push({ timestamp: now, channel, category, eventType });
    }

    this.logDecision(userId, eventType, channel, result);
    return result;
  }

  private logDecision(
    userId: string,
    eventType: string,
    channel: Channel,
    result: CapEvaluationResult
  ): void {
    this.capDecisionsLog.push({
      userId,
      eventType,
      channel,
      result,
      timestamp: new Date().toISOString(),
    });
    if (this.capDecisionsLog.length > 5000) {
      this.capDecisionsLog.shift();
    }
  }

  public getDecisionLogs() {
    return [...this.capDecisionsLog];
  }

  public getCapAnalytics() {
    const blocked = this.capDecisionsLog.filter((d) => !d.result.allowed).length;
    const bypassed = this.capDecisionsLog.filter((d) => d.result.bypassed).length;
    const uniqueUsersTracked = this.userDeliveries.size;
    let usersHittingDailyCap = 0;
    this.userDeliveries.forEach((items) => {
      if (items.length >= this.limits.globalUserDailyCap) usersHittingDailyCap++;
    });
    return {
      totalEvaluated: this.capDecisionsLog.length,
      blocked,
      bypassed,
      uniqueUsersTracked,
      usersHittingDailyCap,
      percentUsersAtDailyCap:
        uniqueUsersTracked > 0 ? Number(((usersHittingDailyCap / uniqueUsersTracked) * 100).toFixed(2)) : 0,
    };
  }

  public resetUserHistory(userId: string): void {
    this.userDeliveries.delete(userId);
  }
}
