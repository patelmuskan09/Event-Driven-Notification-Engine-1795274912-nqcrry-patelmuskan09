import pino from 'pino';
import { config } from '../config/env';
import { maskEmail, maskPhoneNumber } from './crypto';

const baseLogger = pino({
  level: process.env.LOG_LEVEL || (config.nodeEnv === 'test' ? 'silent' : 'info'),
  base: {
    service: config.appName,
    env: config.nodeEnv,
  },
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  redact: {
    paths: ['password', 'token', 'refreshToken', 'authorization', '*.password', '*.token', '*.authKey'],
    censor: '[REDACTED]',
  },
});

export interface LogContext {
  correlationId?: string;
  service?: string;
  userId?: string;
  phone?: string;
  email?: string;
  [key: string]: unknown;
}

function sanitizeContext(ctx?: LogContext): Record<string, unknown> {
  if (!ctx) return {};
  const sanitized: Record<string, unknown> = { ...ctx };
  if (typeof sanitized.phone === 'string') {
    sanitized.phone = maskPhoneNumber(sanitized.phone);
  }
  if (typeof sanitized.email === 'string') {
    sanitized.email = maskEmail(sanitized.email);
  }
  if (typeof sanitized.recipientAddress === 'string') {
    if (sanitized.recipientAddress.includes('@')) {
      sanitized.recipientAddress = maskEmail(sanitized.recipientAddress);
    } else if (/^\+?\d{10,14}$/.test(sanitized.recipientAddress)) {
      sanitized.recipientAddress = maskPhoneNumber(sanitized.recipientAddress);
    }
  }
  return sanitized;
}

export const logger = {
  info(message: string, ctx?: LogContext): void {
    baseLogger.info(sanitizeContext(ctx), message);
  },
  warn(message: string, ctx?: LogContext): void {
    baseLogger.warn(sanitizeContext(ctx), message);
  },
  error(message: string, ctx?: LogContext): void {
    baseLogger.error(sanitizeContext(ctx), message);
  },
  debug(message: string, ctx?: LogContext): void {
    baseLogger.debug(sanitizeContext(ctx), message);
  },
};
