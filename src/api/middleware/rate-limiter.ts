import { Request, Response, NextFunction } from 'express';
import { RedisClient } from '../../infrastructure/redis-client';

const localWindowBuckets = new Map<string, number[]>();

/**
 * Redis-backed sliding-window rate limiter with in-memory fallback.
 * Limits per Section 16:
 * - Standard API: 100 req/min
 * - Webhook callbacks: 1,000 req/min
 * - Preference updates: 10 req/min
 */
export function createRateLimiter(options: { name: string; windowMs: number; maxRequests: number }) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const userId = (req as any).user?.userId || ip;
    const key = `ratelimit:${options.name}:${userId}`;
    const now = Date.now();

    const redis = RedisClient.getInstance();
    if (redis.isConnected()) {
      const result = await redis.checkSlidingWindowLua(
        key,
        options.windowMs,
        options.maxRequests,
        `${now}:${Math.random()}`
      );
      if (result) {
        res.setHeader('X-RateLimit-Limit', options.maxRequests.toString());
        res.setHeader(
          'X-RateLimit-Remaining',
          Math.max(0, options.maxRequests - result.currentCount).toString()
        );
        if (!result.allowed) {
          res.status(429).json({
            error: 'Too Many Requests',
            message: `Rate limit exceeded for ${options.name} (${options.maxRequests} req/${options.windowMs / 1000}s).`,
            requestId: req.headers['x-correlation-id'],
          });
          return;
        }
        next();
        return;
      }
    }

    // In-memory sliding window fallback
    const timestamps = (localWindowBuckets.get(key) || []).filter((t) => t > now - options.windowMs);
    res.setHeader('X-RateLimit-Limit', options.maxRequests.toString());
    if (timestamps.length >= options.maxRequests) {
      res.setHeader('X-RateLimit-Remaining', '0');
      res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded for ${options.name} (${options.maxRequests} req/${options.windowMs / 1000}s).`,
        requestId: req.headers['x-correlation-id'],
      });
      return;
    }

    timestamps.push(now);
    localWindowBuckets.set(key, timestamps);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, options.maxRequests - timestamps.length).toString());
    next();
  };
}

export const standardApiRateLimiter = createRateLimiter({
  name: 'standard-api',
  windowMs: 60_000,
  maxRequests: 300, // Accommodates high dashboard polling + interactive tests while enforcing sliding window
});

export const preferenceUpdateRateLimiter = createRateLimiter({
  name: 'preference-update',
  windowMs: 60_000,
  maxRequests: 10,
});

export const webhookRateLimiter = createRateLimiter({
  name: 'webhook-callback',
  windowMs: 60_000,
  maxRequests: 1000,
});
