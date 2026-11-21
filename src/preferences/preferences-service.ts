import { Channel, EventCategory, RegulatoryClassification, SupportedLanguage } from '../events/models/event';
import { DatabaseClient } from '../database/db-client';
import { RedisClient } from '../infrastructure/redis-client';

export interface UserPreferences {
  userId: string;
  preferredLanguage: SupportedLanguage;
  timezone: string;
  channelSettings: Record<Channel, boolean>;
  categorySettings: Record<
    EventCategory,
    {
      enabled: boolean;
      channels: Channel[];
      digestMode: 'IMMEDIATE' | 'HOURLY' | 'DAILY';
    }
  >;
  eventOverrides?: Record<string, { enabled: boolean; channels?: Channel[] }>;
  quietHours: {
    enabled: boolean;
    startTime: string; // "21:00"
    endTime: string; // "08:00"
  };
  updatedAt: string;
}

export class PreferencesService {
  private static instance: PreferencesService;
  private cache: Map<string, UserPreferences> = new Map();
  private digestBuffer: Map<string, Array<{ eventType: string; summary: string; createdAt: string }>> =
    new Map();

  private constructor() {}

  public static getInstance(): PreferencesService {
    if (!PreferencesService.instance) {
      PreferencesService.instance = new PreferencesService();
    }
    return PreferencesService.instance;
  }

  /**
   * Level 1 + Level 2: System Defaults merged with Account Segment Overrides (RETAIL, HNI, PRO).
   */
  public getDefaultPreferences(
    userId: string,
    segment: 'RETAIL' | 'HNI' | 'PRO' = 'RETAIL'
  ): UserPreferences {
    return {
      userId,
      preferredLanguage: 'en',
      timezone: 'Asia/Kolkata',
      channelSettings: {
        SMS: true,
        EMAIL: true,
        PUSH: true,
        WHATSAPP: segment !== 'RETAIL' ? true : true,
        IN_APP: true,
      },
      categorySettings: {
        TRANSACTION: {
          enabled: true,
          channels: segment === 'PRO' ? ['PUSH', 'IN_APP', 'SMS'] : ['SMS', 'EMAIL', 'PUSH', 'IN_APP'],
          digestMode: 'IMMEDIATE',
        },
        RISK: {
          enabled: true,
          channels: ['SMS', 'EMAIL', 'PUSH', 'WHATSAPP', 'IN_APP'],
          digestMode: 'IMMEDIATE',
        },
        SIP: {
          enabled: true,
          channels: ['EMAIL', 'PUSH', 'IN_APP'],
          digestMode: segment === 'HNI' ? 'IMMEDIATE' : 'HOURLY',
        },
        MARKET: {
          enabled: true,
          channels: ['PUSH', 'IN_APP'],
          digestMode: segment === 'PRO' ? 'IMMEDIATE' : 'DAILY',
        },
        REGULATORY: {
          enabled: true,
          channels: ['SMS', 'EMAIL', 'IN_APP'],
          digestMode: 'IMMEDIATE',
        },
      },
      quietHours: {
        enabled: true,
        startTime: '21:00',
        endTime: '08:00',
      },
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Enforces minimum 6-hour quiet hours window per Section 10.
   */
  public validateQuietHoursDuration(startTime: string, endTime: string): { valid: boolean; hours: number } {
    const [sH, sM] = startTime.split(':').map((n) => parseInt(n, 10));
    const [eH, eM] = endTime.split(':').map((n) => parseInt(n, 10));
    if (Number.isNaN(sH) || Number.isNaN(eH)) return { valid: false, hours: 0 };

    const startMin = sH * 60 + (sM || 0);
    const endMin = eH * 60 + (eM || 0);
    const diffMin = endMin > startMin ? endMin - startMin : 24 * 60 - startMin + endMin;
    const hours = diffMin / 60;
    return { valid: hours >= 6, hours };
  }

  public getPreferences(userId: string, segment?: 'RETAIL' | 'HNI' | 'PRO'): UserPreferences {
    if (this.cache.has(userId)) {
      return this.cache.get(userId)!;
    }
    const defaults = this.getDefaultPreferences(userId, segment);
    this.cache.set(userId, defaults);
    return defaults;
  }

  /**
   * Resolves preferences across Redis cache -> PostgreSQL -> System/Segment defaults.
   */
  public async getPreferencesAsync(
    userId: string,
    segment: 'RETAIL' | 'HNI' | 'PRO' = 'RETAIL'
  ): Promise<UserPreferences> {
    const redis = RedisClient.getInstance();
    const cachedJson = await redis.get(`pref:${userId}`);
    if (cachedJson) {
      try {
        const parsed = JSON.parse(cachedJson) as UserPreferences;
        this.cache.set(userId, parsed);
        return parsed;
      } catch {
        // Ignore malformed cache
      }
    }

    const db = DatabaseClient.getInstance();
    if (db.isConnected()) {
      const res = await db.query<{
        channel_settings: Record<Channel, boolean>;
        category_settings: any;
        quiet_hours: { enabled: boolean; startTime: string; endTime: string };
        digest_mode: string;
        updated_at: string;
      }>(
        `SELECT channel_settings, category_settings, quiet_hours, digest_mode, updated_at
         FROM user_preferences WHERE user_id = $1`,
        [userId]
      );
      if (res && res.rows.length > 0) {
        const row = res.rows[0];
        const base = this.getDefaultPreferences(userId, segment);
        const merged: UserPreferences = {
          ...base,
          channelSettings: { ...base.channelSettings, ...(row.channel_settings || {}) },
          categorySettings:
            row.category_settings && Object.keys(row.category_settings).length > 0
              ? { ...base.categorySettings, ...row.category_settings }
              : base.categorySettings,
          quietHours: row.quiet_hours || base.quietHours,
          updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : base.updatedAt,
        };
        this.cache.set(userId, merged);
        await redis.setEx(`pref:${userId}`, 3600, JSON.stringify(merged));
        return merged;
      }
    }

    const defaults = this.getPreferences(userId, segment);
    await redis.setEx(`pref:${userId}`, 3600, JSON.stringify(defaults));
    return defaults;
  }

  /**
   * Level 4: Applies Regulatory Override so mandatory channels can never be disabled.
   */
  public applyRegulatoryOverride(
    prefs: UserPreferences,
    classification: RegulatoryClassification,
    mandatoryChannels: Channel[]
  ): UserPreferences {
    if (classification !== 'REGULATORY_MANDATORY') return prefs;
    const overriddenChannels = { ...prefs.channelSettings };
    for (const ch of mandatoryChannels) {
      overriddenChannels[ch] = true;
    }
    return {
      ...prefs,
      channelSettings: overriddenChannels,
    };
  }

  public updatePreferences(userId: string, updates: Partial<UserPreferences>): UserPreferences {
    const current = this.getPreferences(userId);
    if (updates.quietHours?.enabled && updates.quietHours.startTime && updates.quietHours.endTime) {
      const check = this.validateQuietHoursDuration(updates.quietHours.startTime, updates.quietHours.endTime);
      if (!check.valid) {
        throw new Error(`Quiet hours must span at least 6 hours (configured: ${check.hours.toFixed(1)}h)`);
      }
    }

    const updated: UserPreferences = {
      ...current,
      ...updates,
      channelSettings: updates.channelSettings
        ? { ...current.channelSettings, ...updates.channelSettings }
        : current.channelSettings,
      categorySettings: updates.categorySettings
        ? { ...current.categorySettings, ...updates.categorySettings }
        : current.categorySettings,
      eventOverrides: updates.eventOverrides
        ? { ...(current.eventOverrides || {}), ...updates.eventOverrides }
        : current.eventOverrides,
      quietHours: updates.quietHours ? { ...current.quietHours, ...updates.quietHours } : current.quietHours,
      userId,
      updatedAt: new Date().toISOString(),
    };
    this.cache.set(userId, updated);
    return updated;
  }

  public async updatePreferencesAsync(
    userId: string,
    updates: Partial<UserPreferences>
  ): Promise<UserPreferences> {
    const updated = this.updatePreferences(userId, updates);

    const db = DatabaseClient.getInstance();
    if (db.isConnected()) {
      await db.query(
        `INSERT INTO user_preferences (user_id, channel_settings, category_settings, quiet_hours, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           channel_settings = EXCLUDED.channel_settings,
           category_settings = EXCLUDED.category_settings,
           quiet_hours = EXCLUDED.quiet_hours,
           updated_at = NOW()`,
        [
          userId,
          JSON.stringify(updated.channelSettings),
          JSON.stringify(updated.categorySettings),
          JSON.stringify(updated.quietHours),
        ]
      );
    }

    // Invalidate & re-warm Redis cache
    const redis = RedisClient.getInstance();
    await redis.del(`pref:${userId}`);
    await redis.setEx(`pref:${userId}`, 3600, JSON.stringify(updated));
    return updated;
  }

  public invalidateCache(userId: string): void {
    this.cache.delete(userId);
    void RedisClient.getInstance().del(`pref:${userId}`);
  }

  public addToDigestBuffer(userId: string, eventType: string, summary: string): number {
    const list = this.digestBuffer.get(userId) || [];
    list.push({ eventType, summary, createdAt: new Date().toISOString() });
    this.digestBuffer.set(userId, list);
    return list.length;
  }

  public flushDigestBuffer(userId: string) {
    const items = this.digestBuffer.get(userId) || [];
    this.digestBuffer.delete(userId);
    return items;
  }

  public getPreferenceAnalytics() {
    const all = Array.from(this.cache.values());
    const channelOptOuts: Record<Channel, number> = {
      SMS: 0,
      EMAIL: 0,
      PUSH: 0,
      WHATSAPP: 0,
      IN_APP: 0,
    };
    for (const pref of all) {
      (Object.keys(channelOptOuts) as Channel[]).forEach((ch) => {
        if (!pref.channelSettings[ch]) channelOptOuts[ch]++;
      });
    }
    return {
      trackedUsersCount: all.length,
      channelOptOuts,
    };
  }
}
