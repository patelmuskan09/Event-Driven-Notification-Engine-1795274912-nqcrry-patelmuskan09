import dotenv from 'dotenv';

dotenv.config();

/**
 * Centralized environment-based configuration for Project BE-6B.
 * All secrets must be supplied via environment variables in production.
 */
export interface AppConfig {
  nodeEnv: string;
  port: number;
  host: string;
  appName: string;
  jwtSecret: string;
  refreshSecret: string;
  tokenExpirySeconds: number;
  refreshExpirySeconds: number;
  piiEncryptionKey: string;
  webhookHmacSecret: string;
  enableAuthEnforcement: boolean;
  enableRealProviders: boolean;
  database: {
    url: string;
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
    ssl: boolean;
    poolMax: number;
    idleTimeoutMs: number;
    enabled: boolean;
  };
  redis: {
    url: string;
    host: string;
    port: number;
    password?: string;
    db: number;
    keyPrefix: string;
    enabled: boolean;
  };
  kafka: {
    brokers: string[];
    clientId: string;
    groupId: string;
    topicEvents: string;
    topicCritical: string;
    topicDlq: string;
    ssl: boolean;
    enabled: boolean;
  };
  rabbitmq: {
    url: string;
    exchangeName: string;
    criticalQueue: string;
    highQueue: string;
    standardQueue: string;
    dlqQueue: string;
    enabled: boolean;
  };
  providers: {
    msg91AuthKey: string;
    msg91SenderId: string;
    twilioAccountSid: string;
    twilioAuthToken: string;
    twilioFromNumber: string;
    fcmServerKey: string;
    apnsKeyId: string;
    whatsappToken: string;
    whatsappPhoneNumberId: string;
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpPass: string;
  };
  compliance: {
    traiDndEnforced: boolean;
    globalUserDailyCap: number;
    smsDailyCap: number;
    pushDailyCap: number;
    emailDailyCap: number;
    categoryHourlyCap: number;
    sameEventCooldownMinutes: number;
    quietHoursStart: string;
    quietHoursEnd: string;
    defaultTimezone: string;
  };
}

function parseBool(val: string | undefined, defaultValue: boolean): boolean {
  if (val === undefined) return defaultValue;
  return val.toLowerCase() === 'true';
}

export const config: AppConfig = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  appName: process.env.APP_NAME || 'NotificationEngine-BE-6B',
  jwtSecret:
    process.env.APP_SECRET || process.env.JWT_SECRET || 'dev-only-jwt-secret-change-in-production-32ch',
  refreshSecret: process.env.REFRESH_TOKEN_SECRET || 'dev-only-refresh-secret-change-in-production-32ch',
  tokenExpirySeconds: Math.min(parseInt(process.env.TOKEN_EXPIRY_SECONDS || '3600', 10), 3600), // Max 1 hour TTL
  refreshExpirySeconds: parseInt(process.env.REFRESH_TOKEN_EXPIRY_SECONDS || '604800', 10),
  piiEncryptionKey: process.env.PII_ENCRYPTION_KEY || 'dev-only-aes256-pii-key-32-bytes!',
  webhookHmacSecret: process.env.WEBHOOK_HMAC_SECRET || 'dev-only-webhook-hmac-secret-32c',
  enableAuthEnforcement: parseBool(process.env.ENABLE_AUTH_ENFORCEMENT, true),
  enableRealProviders: parseBool(process.env.ENABLE_REAL_PROVIDERS, false),
  database: {
    url:
      process.env.DATABASE_URL ||
      'postgres://notification_user:notification_pass@localhost:5432/notifications_db',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'notification_user',
    password: process.env.DB_PASSWORD || 'notification_pass',
    name: process.env.DB_NAME || 'notifications_db',
    ssl: parseBool(process.env.DB_SSL, false),
    poolMax: parseInt(process.env.DB_POOL_MAX || '25', 10),
    idleTimeoutMs: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '10000', 10),
    enabled: parseBool(process.env.ENABLE_POSTGRES, true),
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'ne:',
    enabled: parseBool(process.env.ENABLE_REDIS, true),
  },
  kafka: {
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',').map((b) => b.trim()),
    clientId: process.env.KAFKA_CLIENT_ID || 'notification-engine',
    groupId: process.env.KAFKA_GROUP_ID || 'notification-engine-consumer-group',
    topicEvents: process.env.KAFKA_TOPIC_EVENTS || 'notification-events',
    topicCritical: process.env.KAFKA_TOPIC_CRITICAL || 'notification-critical',
    topicDlq: process.env.KAFKA_TOPIC_DLQ || 'notification-dlq',
    ssl: parseBool(process.env.KAFKA_SSL, false),
    enabled: parseBool(process.env.ENABLE_KAFKA, true),
  },
  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
    exchangeName: process.env.RABBITMQ_EXCHANGE_NAME || 'notifications.direct',
    criticalQueue: process.env.RABBITMQ_CRITICAL_QUEUE || 'notifications.priority.critical',
    highQueue: process.env.RABBITMQ_HIGH_QUEUE || 'notifications.priority.high',
    standardQueue: process.env.RABBITMQ_STANDARD_QUEUE || 'notifications.priority.standard',
    dlqQueue: process.env.RABBITMQ_DLQ || 'notifications.delivery.dlq',
    enabled: parseBool(process.env.ENABLE_RABBITMQ, true),
  },
  providers: {
    msg91AuthKey: process.env.MSG91_AUTH_KEY || 'test_msg91_auth_key_sandbox',
    msg91SenderId: process.env.MSG91_SENDER_ID || 'FINNOT',
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || 'AC_dummy_twilio_account_sid_test_mode',
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || 'test_twilio_auth_token_secret',
    twilioFromNumber: process.env.TWILIO_FROM_NUMBER || '+15005550006',
    fcmServerKey: process.env.FCM_SERVER_KEY || 'test_fcm_http_v1_server_key_json',
    apnsKeyId: process.env.APNS_KEY_ID || 'test_apns_key_id',
    whatsappToken: process.env.WHATSAPP_TOKEN || 'test_whatsapp_cloud_api_token',
    whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '10987654321',
    smtpHost: process.env.SMTP_HOST || 'smtp.ethereal.email',
    smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
    smtpUser: process.env.SMTP_USER || 'ethereal_user@ethereal.email',
    smtpPass: process.env.SMTP_PASS || 'ethereal_password',
  },
  compliance: {
    traiDndEnforced: parseBool(process.env.TRAI_DND_ENFORCED, true),
    globalUserDailyCap: parseInt(process.env.GLOBAL_USER_DAILY_CAP || '12', 10),
    smsDailyCap: parseInt(process.env.SMS_DAILY_CAP || '5', 10),
    pushDailyCap: parseInt(process.env.PUSH_DAILY_CAP || '8', 10),
    emailDailyCap: parseInt(process.env.EMAIL_DAILY_CAP || '3', 10),
    categoryHourlyCap: parseInt(process.env.CATEGORY_HOURLY_CAP || '3', 10),
    sameEventCooldownMinutes: parseInt(process.env.SAME_EVENT_COOLDOWN_MINUTES || '15', 10),
    quietHoursStart: process.env.QUIET_HOURS_START || '21:00',
    quietHoursEnd: process.env.QUIET_HOURS_END || '08:00',
    defaultTimezone: process.env.DEFAULT_TIMEZONE || 'Asia/Kolkata',
  },
};
