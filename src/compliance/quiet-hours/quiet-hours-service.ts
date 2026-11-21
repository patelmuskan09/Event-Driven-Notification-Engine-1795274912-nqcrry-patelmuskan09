import { EventPriority, NotificationRecord } from '../../events/models/event';
import { RedisClient } from '../../infrastructure/redis-client';

export interface QuietHoursEvaluation {
  isQuietHour: boolean;
  action: 'DISPATCH_IMMEDIATE' | 'QUEUED_FOR_MORNING' | 'CRITICAL_BYPASS';
  localTimeStr: string;
  userTimezone: string;
  reason: string;
}

export class QuietHoursService {
  private static instance: QuietHoursService;
  private quietHoursQueue: Map<string, NotificationRecord[]> = new Map();

  private constructor() {}

  public static getInstance(): QuietHoursService {
    if (!QuietHoursService.instance) {
      QuietHoursService.instance = new QuietHoursService();
    }
    return QuietHoursService.instance;
  }

  /**
   * Checks if current time in the user's IANA timezone is inside quiet hours (midnight wrapping supported).
   */
  public evaluate(
    priority: EventPriority,
    userTimezone: string = 'Asia/Kolkata',
    quietStart: string = '21:00',
    quietEnd: string = '08:00',
    referenceDate: Date = new Date()
  ): QuietHoursEvaluation {
    let validTz = userTimezone;
    let parts: Intl.DateTimeFormatPart[];
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: validTz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      parts = formatter.formatToParts(referenceDate);
    } catch {
      validTz = 'Asia/Kolkata';
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: validTz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      parts = formatter.formatToParts(referenceDate);
    }

    const hourPartRaw = parts.find((p) => p.type === 'hour')?.value || '00';
    const hourNum = parseInt(hourPartRaw, 10) % 24;
    const minutePart = parts.find((p) => p.type === 'minute')?.value || '00';
    const currentMinutes = hourNum * 60 + parseInt(minutePart, 10);
    const localTimeStr = `${hourNum.toString().padStart(2, '0')}:${minutePart}`;

    const [startH, startM] = quietStart.split(':').map((s) => parseInt(s, 10));
    const [endH, endM] = quietEnd.split(':').map((s) => parseInt(s, 10));
    const startMinutes = startH * 60 + (startM || 0);
    const endMinutes = endH * 60 + (endM || 0);

    let isInQuietHours = false;
    if (startMinutes > endMinutes) {
      isInQuietHours = currentMinutes >= startMinutes || currentMinutes < endMinutes;
    } else {
      isInQuietHours = currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }

    if (!isInQuietHours) {
      return {
        isQuietHour: false,
        action: 'DISPATCH_IMMEDIATE',
        localTimeStr,
        userTimezone: validTz,
        reason: 'Current local time is within normal active notification hours.',
      };
    }

    if (priority === 'CRITICAL') {
      return {
        isQuietHour: true,
        action: 'CRITICAL_BYPASS',
        localTimeStr,
        userTimezone: validTz,
        reason: 'CRITICAL event bypassed quiet hours (Regulatory/Liquidation Urgency).',
      };
    }

    return {
      isQuietHour: true,
      action: 'QUEUED_FOR_MORNING',
      localTimeStr,
      userTimezone: validTz,
      reason: `Queued during quiet hours (${quietStart}-${quietEnd} in ${validTz}). Scheduled for ${quietEnd} dispatch.`,
    };
  }

  public enqueueForMorning(userId: string, notification: NotificationRecord): void {
    const list = this.quietHoursQueue.get(userId) || [];
    list.push(notification);
    this.quietHoursQueue.set(userId, list);
    void RedisClient.getInstance().zadd(`quiet:queue:${userId}`, Date.now(), JSON.stringify(notification));
  }

  public getQueuedNotifications(userId?: string): NotificationRecord[] {
    if (userId) {
      return this.quietHoursQueue.get(userId) || [];
    }
    const all: NotificationRecord[] = [];
    this.quietHoursQueue.forEach((items) => all.push(...items));
    return all;
  }

  public flushMorningQueue(userId: string): { items: NotificationRecord[]; digestSuggested: boolean } {
    const items = this.quietHoursQueue.get(userId) || [];
    this.quietHoursQueue.delete(userId);
    void RedisClient.getInstance().del(`quiet:queue:${userId}`);
    const digestSuggested = items.length > 5;
    return { items, digestSuggested };
  }
}
