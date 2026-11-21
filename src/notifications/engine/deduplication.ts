import { RedisClient } from '../../infrastructure/redis-client';
import { DatabaseClient } from '../../database/db-client';
import { logger } from '../../utils/logger';

export interface DeduplicationStats {
  eventsReceived: number;
  eventsDeduplicated: number;
  eventsPassedThrough: number;
  lastDuplicateDetectedAt?: string;
  stormIncidents: Array<{
    incidentId: string;
    detectedAt: string;
    keyPattern: string;
    duplicatesSuppressed: number;
    windowSeconds: number;
  }>;
}

export class DeduplicationEngine {
  private static instance: DeduplicationEngine;
  private cache: Map<string, { expiresAt: number; count: number; firstSeen: string }> = new Map();

  private stats: DeduplicationStats = {
    eventsReceived: 0,
    eventsDeduplicated: 0,
    eventsPassedThrough: 0,
    stormIncidents: [],
  };

  private constructor() {
    const timer = setInterval(() => this.cleanupExpired(), 30000);
    if (timer.unref) timer.unref();
  }

  public static getInstance(): DeduplicationEngine {
    if (!DeduplicationEngine.instance) {
      DeduplicationEngine.instance = new DeduplicationEngine();
    }
    return DeduplicationEngine.instance;
  }

  /**
   * Idempotency fingerprint: event_type + source_entity_id + timestamp_window
   */
  public generateFingerprint(eventType: string, entityId: string, windowSeconds: number = 60): string {
    const timeBucket = Math.floor(Date.now() / (windowSeconds * 1000));
    return `dedup:${eventType}:${entityId}:${timeBucket}`;
  }

  /**
   * Async Redis SET NX EX + in-memory counter for storm incident tracking.
   */
  public async checkAndRegisterAsync(
    fingerprintKey: string,
    ttlSeconds: number = 60,
    eventType: string = 'UNKNOWN',
    entityId: string = 'UNKNOWN'
  ): Promise<{ isDuplicate: boolean; duplicateCount: number }> {
    const redis = RedisClient.getInstance();
    if (redis.isConnected()) {
      const acquired = await redis.setNxEx(fingerprintKey, ttlSeconds, new Date().toISOString());
      if (acquired === false) {
        const local = this.checkAndRegister(fingerprintKey, ttlSeconds);
        if (!local.isDuplicate) {
          // Sync local counter when key came from Redis across cluster instances
          this.stats.eventsDeduplicated++;
          return { isDuplicate: true, duplicateCount: 2 };
        }
        return local;
      }
      if (acquired === true) {
        const db = DatabaseClient.getInstance();
        if (db.isConnected()) {
          void db.query(
            `INSERT INTO event_deduplication (idempotency_key, event_type, source_entity_id, expires_at)
             VALUES ($1, $2, $3, NOW() + ($4 || ' seconds')::interval)
             ON CONFLICT (idempotency_key) DO UPDATE SET duplicate_count = event_deduplication.duplicate_count + 1`,
            [fingerprintKey, eventType, entityId, ttlSeconds.toString()]
          );
        }
      }
    }

    return this.checkAndRegister(fingerprintKey, ttlSeconds);
  }

  public checkAndRegister(
    fingerprintKey: string,
    ttlSeconds: number = 60
  ): { isDuplicate: boolean; duplicateCount: number } {
    this.stats.eventsReceived++;
    const now = Date.now();
    const existing = this.cache.get(fingerprintKey);

    if (existing && existing.expiresAt > now) {
      existing.count++;
      this.stats.eventsDeduplicated++;
      this.stats.lastDuplicateDetectedAt = new Date().toISOString();

      if (existing.count === 50) {
        this.triggerStormIncident(fingerprintKey, existing.count, ttlSeconds);
      }

      return { isDuplicate: true, duplicateCount: existing.count };
    }

    this.cache.set(fingerprintKey, {
      expiresAt: now + ttlSeconds * 1000,
      count: 1,
      firstSeen: new Date().toISOString(),
    });
    this.stats.eventsPassedThrough++;

    return { isDuplicate: false, duplicateCount: 1 };
  }

  private triggerStormIncident(key: string, count: number, windowSeconds: number) {
    const incident = {
      incidentId: `INC-STORM-${Date.now()}`,
      detectedAt: new Date().toISOString(),
      keyPattern: key,
      duplicatesSuppressed: count,
      windowSeconds,
    };
    this.stats.stormIncidents.unshift(incident);
    logger.warn('Notification storm detected and suppressed', {
      service: 'DeduplicationEngine',
      incidentId: incident.incidentId,
      key,
      duplicatesSuppressed: count,
    });
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, val] of this.cache.entries()) {
      if (val.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }

  public getStats(): DeduplicationStats {
    return { ...this.stats };
  }
}
