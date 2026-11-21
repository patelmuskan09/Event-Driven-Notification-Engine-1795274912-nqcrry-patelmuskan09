import Redis from 'ioredis';
import { config } from '../config/env';
import { logger } from '../utils/logger';

export type RedisConnectionState = 'CONNECTED' | 'IN_MEMORY_FALLBACK' | 'DISCONNECTED';

const SLIDING_WINDOW_RATE_LIMIT_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  return {0, count}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return {1, count + 1}
`;

export class RedisClient {
  private static instance: RedisClient;
  private client: Redis | null = null;
  private state: RedisConnectionState = 'DISCONNECTED';
  private lastError: string | null = null;

  private constructor() {}

  public static getInstance(): RedisClient {
    if (!RedisClient.instance) {
      RedisClient.instance = new RedisClient();
    }
    return RedisClient.instance;
  }

  public async connect(): Promise<boolean> {
    if (!config.redis.enabled) {
      this.state = 'IN_MEMORY_FALLBACK';
      return false;
    }

    try {
      const redis = new Redis(config.redis.url, {
        password: config.redis.password || undefined,
        db: config.redis.db,
        keyPrefix: config.redis.keyPrefix,
        connectTimeout: 2000,
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        retryStrategy: () => null, // Fail fast to explicit fallback if Redis daemon is absent
      });

      redis.on('error', (err) => {
        this.lastError = err.message;
      });

      await redis.connect();
      const pong = await redis.ping();
      if (pong === 'PONG') {
        this.client = redis;
        this.state = 'CONNECTED';
        this.lastError = null;
        logger.info('Connected to Redis 7+ cluster', { service: 'RedisClient' });
        return true;
      }
      await redis.quit().catch(() => undefined);
      this.state = 'IN_MEMORY_FALLBACK';
      return false;
    } catch (err: any) {
      this.lastError = err.message;
      this.state = 'IN_MEMORY_FALLBACK';
      this.client = null;
      logger.warn('Redis unavailable; operating with in-memory sliding-window fallback', {
        service: 'RedisClient',
        reason: err.message,
      });
      return false;
    }
  }

  public isConnected(): boolean {
    return this.state === 'CONNECTED' && this.client !== null;
  }

  public getStatus(): { state: RedisConnectionState; mode: string; lastError: string | null } {
    return {
      state: this.state,
      mode: this.isConnected() ? 'REDIS_LIVE' : 'IN_MEMORY_FALLBACK',
      lastError: this.lastError,
    };
  }

  public async get(key: string): Promise<string | null> {
    if (!this.isConnected() || !this.client) return null;
    try {
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  public async setEx(key: string, ttlSeconds: number, value: string): Promise<boolean> {
    if (!this.isConnected() || !this.client) return false;
    try {
      await this.client.setex(key, ttlSeconds, value);
      return true;
    } catch {
      return false;
    }
  }

  public async setNxEx(key: string, ttlSeconds: number, value: string): Promise<boolean | null> {
    if (!this.isConnected() || !this.client) return null;
    try {
      const res = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
      return res === 'OK';
    } catch {
      return null;
    }
  }

  public async del(key: string): Promise<void> {
    if (!this.isConnected() || !this.client) return;
    await this.client.del(key).catch(() => undefined);
  }

  /**
   * Executes an atomic Lua sliding-window rate check in Redis.
   */
  public async checkSlidingWindowLua(
    key: string,
    windowMs: number,
    limit: number,
    memberId: string
  ): Promise<{ allowed: boolean; currentCount: number } | null> {
    if (!this.isConnected() || !this.client) return null;
    try {
      const res = (await this.client.eval(
        SLIDING_WINDOW_RATE_LIMIT_LUA,
        1,
        key,
        Date.now().toString(),
        windowMs.toString(),
        limit.toString(),
        memberId
      )) as [number, number];
      return { allowed: res[0] === 1, currentCount: res[1] };
    } catch {
      return null;
    }
  }

  /**
   * Schedules a retry job in a Redis Sorted Set (`ZSET`) ordered by executeAt epoch ms.
   */
  public async zadd(key: string, score: number, member: string): Promise<boolean> {
    if (!this.isConnected() || !this.client) return false;
    try {
      await this.client.zadd(key, score, member);
      return true;
    } catch {
      return false;
    }
  }

  public async zrangeByScoreAndRemove(key: string, maxScore: number): Promise<string[]> {
    if (!this.isConnected() || !this.client) return [];
    try {
      const items = await this.client.zrangebyscore(key, 0, maxScore);
      if (items.length > 0) {
        await this.client.zrem(key, ...items);
      }
      return items;
    } catch {
      return [];
    }
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit().catch(() => undefined);
      this.client = null;
      this.state = 'DISCONNECTED';
    }
  }
}
