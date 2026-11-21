/**
 * Strict TypeScript Models for Event-Driven Notification Engine
 */

export type Channel = 'SMS' | 'EMAIL' | 'PUSH' | 'WHATSAPP' | 'IN_APP';

export type EventCategory = 'TRANSACTION' | 'RISK' | 'SIP' | 'MARKET' | 'REGULATORY';

export type EventPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type RegulatoryClassification = 'TRANSACTIONAL' | 'PROMOTIONAL' | 'REGULATORY_MANDATORY';

export type NotificationStatus =
  | 'CREATED'
  | 'ENRICHED'
  | 'ROUTED'
  | 'QUEUED'
  | 'SENT'
  | 'DELIVERED'
  | 'READ'
  | 'CAPPED'
  | 'QUIET'
  | 'DND'
  | 'FAILED'
  | 'RETRYING'
  | 'BOUNCED'
  | 'DLQ';

export type SupportedLanguage = 'en' | 'hi' | 'mr' | 'ta' | 'te';

export interface FinancialEventDefinition {
  code: string;
  name: string;
  category: EventCategory;
  priority: EventPriority;
  regulatoryClassification: RegulatoryClassification;
  permittedChannels: Channel[];
  mandatoryChannels: Channel[];
  maxDeliveryLatencySeconds: number;
  retryPolicy: {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
}

export interface IngestedEventPayload {
  eventId?: string;
  eventType: string; // e.g. 'TXNX-001'
  userId: string;
  timestamp: string; // ISO8601
  sourceSystem: 'TRADING_ENGINE' | 'RMS' | 'SIP_ENGINE' | 'MARKET_FEED' | 'COMPLIANCE';
  idempotencyKey?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
  payload: Record<string, unknown>;
}

export interface EnrichedEvent extends IngestedEventPayload {
  eventId: string;
  correlationId: string;
  idempotencyKey: string;
  definition: FinancialEventDefinition;
  userContext: {
    userId: string;
    fullName: string;
    email: string;
    phone: string;
    language: SupportedLanguage;
    timezone: string;
    accountType: 'RETAIL' | 'HNI' | 'PRO';
    riskProfile: 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE';
    isDndRegistered: boolean;
    dndOptInCategories: string[];
    emailConsent: boolean;
    whatsappConsent: boolean;
    dailyCostSpentInr: number;
    monthlyCostSpentInr: number;
  };
  enrichedAt: string;
}

export interface NotificationRecord {
  id: string;
  eventId: string;
  userId: string;
  eventType: string;
  category: EventCategory;
  priority: EventPriority;
  channel: Channel;
  status: NotificationStatus;
  recipientAddress: string;
  subject?: string;
  renderedBody: string;
  language: SupportedLanguage;
  costInr: number;
  provider: string;
  externalProviderId?: string;
  retryCount: number;
  maxRetries: number;
  failureReason?: string;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
  readAt?: string;
  complianceLog?: {
    dndCheckedAt?: string;
    dndResult?: 'PASS' | 'BLOCKED' | 'REGULATORY_BYPASS';
    frequencyCapCheckedAt?: string;
    frequencyCapResult?: 'PASS' | 'BLOCKED' | 'CRITICAL_BYPASS';
    quietHoursCheckedAt?: string;
    quietHoursAction?: 'DISPATCH_IMMEDIATE' | 'QUEUED_FOR_MORNING' | 'CRITICAL_BYPASS';
  };
}

export interface NotificationStateTransition {
  id: string;
  notificationId: string;
  previousState: NotificationStatus;
  newState: NotificationStatus;
  timestamp: string;
  actorService: string;
  retryCount: number;
  providerResponse?: unknown;
  failureReason?: string;
  metadata?: Record<string, unknown>;
}
