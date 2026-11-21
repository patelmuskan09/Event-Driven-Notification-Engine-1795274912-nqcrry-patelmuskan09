import { Channel, NotificationRecord } from '../../events/models/event';

export type ProviderAdapterMode = 'LIVE' | 'SANDBOX';

export interface ProviderDeliveryResponse {
  success: boolean;
  externalId: string;
  provider: string;
  mode?: ProviderAdapterMode;
  latencyMs: number;
  statusCode?: number;
  errorMessage?: string;
  errorClassification?: 'TRANSIENT' | 'PERMANENT' | 'CONFIGURATION';
  rawResponse?: Record<string, unknown>;
}

export interface ProviderQuota {
  provider: string;
  remainingDaily: number;
  totalLimitDaily: number;
  costPerUnitInr: number;
}

export interface DeliveryProvider {
  readonly name: string;
  readonly channel: Channel;
  readonly mode: ProviderAdapterMode;
  readonly limitations?: string;
  send(notification: NotificationRecord): Promise<ProviderDeliveryResponse>;
  getStatus(externalId: string): Promise<{ delivered: boolean; timestamp: string }>;
  validateRecipient(address: string): boolean;
  getQuota(): ProviderQuota;
  isHealthy(): boolean;
  setSimulatedFailure(shouldFail: boolean): void;
}
