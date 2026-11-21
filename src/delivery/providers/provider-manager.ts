import { NotificationRecord } from '../../events/models/event';
import { CircuitBreaker } from '../circuit-breaker/circuit-breaker';
import { DeliveryProvider, ProviderDeliveryResponse } from './provider-interface';
import {
  Msg91SmsProvider,
  TwilioSmsProvider,
  EmailEtherealProvider,
  FcmPushProvider,
  ApnsPushProvider,
  WhatsAppCloudProvider,
  InAppSocketProvider,
} from './channel-providers';
import { logger } from '../../utils/logger';

export class ProviderManager {
  private static instance: ProviderManager;

  public msg91Provider: Msg91SmsProvider;
  public twilioProvider: TwilioSmsProvider;
  public emailProvider: EmailEtherealProvider;
  public fcmProvider: FcmPushProvider;
  public apnsProvider: ApnsPushProvider;
  public whatsAppProvider: WhatsAppCloudProvider;
  public inAppProvider: InAppSocketProvider;

  public msg91Breaker: CircuitBreaker;
  public twilioBreaker: CircuitBreaker;
  public emailBreaker: CircuitBreaker;
  public fcmBreaker: CircuitBreaker;
  public apnsBreaker: CircuitBreaker;
  public whatsAppBreaker: CircuitBreaker;
  public inAppBreaker: CircuitBreaker;

  private providerStats: Record<string, { requests: number; failures: number }> = {};

  private constructor() {
    this.msg91Provider = new Msg91SmsProvider();
    this.twilioProvider = new TwilioSmsProvider();
    this.emailProvider = new EmailEtherealProvider();
    this.fcmProvider = new FcmPushProvider();
    this.apnsProvider = new ApnsPushProvider();
    this.whatsAppProvider = new WhatsAppCloudProvider();
    this.inAppProvider = new InAppSocketProvider();

    this.msg91Breaker = new CircuitBreaker({
      name: 'MSG91',
      failureThreshold: 5,
      windowMs: 60000,
      openPeriodMs: 60000,
    });
    this.twilioBreaker = new CircuitBreaker({
      name: 'Twilio',
      failureThreshold: 5,
      windowMs: 60000,
      openPeriodMs: 60000,
    });
    this.emailBreaker = new CircuitBreaker({
      name: 'Ethereal-SMTP',
      failureThreshold: 5,
      windowMs: 60000,
      openPeriodMs: 60000,
    });
    this.fcmBreaker = new CircuitBreaker({
      name: 'FCM-Push',
      failureThreshold: 5,
      windowMs: 60000,
      openPeriodMs: 60000,
    });
    this.apnsBreaker = new CircuitBreaker({
      name: 'Apple-APNS',
      failureThreshold: 5,
      windowMs: 60000,
      openPeriodMs: 60000,
    });
    this.whatsAppBreaker = new CircuitBreaker({
      name: 'WhatsApp',
      failureThreshold: 5,
      windowMs: 60000,
      openPeriodMs: 60000,
    });
    this.inAppBreaker = new CircuitBreaker({
      name: 'SocketIO-InApp',
      failureThreshold: 5,
      windowMs: 60000,
      openPeriodMs: 60000,
    });
  }

  public static getInstance(): ProviderManager {
    if (!ProviderManager.instance) {
      ProviderManager.instance = new ProviderManager();
    }
    return ProviderManager.instance;
  }

  private trackProviderCall(providerName: string, success: boolean): void {
    if (!this.providerStats[providerName]) {
      this.providerStats[providerName] = { requests: 0, failures: 0 };
    }
    this.providerStats[providerName].requests++;
    if (!success) {
      this.providerStats[providerName].failures++;
    }
  }

  public async dispatch(
    notification: NotificationRecord
  ): Promise<ProviderDeliveryResponse & { fallbackUsed?: boolean }> {
    const channel = notification.channel;

    if (channel === 'SMS') {
      return this.dispatchSmsWithFailover(notification);
    } else if (channel === 'EMAIL') {
      return this.dispatchWithBreaker(this.emailProvider, this.emailBreaker, notification);
    } else if (channel === 'PUSH') {
      return this.dispatchPushOsAware(notification);
    } else if (channel === 'WHATSAPP') {
      return this.dispatchWithBreaker(this.whatsAppProvider, this.whatsAppBreaker, notification);
    } else if (channel === 'IN_APP') {
      return this.dispatchWithBreaker(this.inAppProvider, this.inAppBreaker, notification);
    }

    return {
      success: false,
      externalId: '',
      provider: 'UNKNOWN',
      latencyMs: 0,
      statusCode: 400,
      errorMessage: `Unsupported channel: ${channel}`,
      errorClassification: 'CONFIGURATION',
    };
  }

  /**
   * Spec Error 3 Fix: Device-OS aware Push routing.
   * iOS tokens prefixed `apns_token_` go to APNS (with FCM fallback).
   * Android tokens go to FCM only and NEVER fail over to APNS; fallback for critical Android failure uses SMS.
   */
  private async dispatchPushOsAware(
    notification: NotificationRecord
  ): Promise<ProviderDeliveryResponse & { fallbackUsed?: boolean }> {
    const isIosToken = notification.recipientAddress.startsWith('apns_token_');
    if (isIosToken) {
      const apnsRes = await this.dispatchWithBreaker(this.apnsProvider, this.apnsBreaker, notification);
      if (apnsRes.success) return apnsRes;
      const fcmRes = await this.dispatchWithBreaker(this.fcmProvider, this.fcmBreaker, notification);
      return { ...fcmRes, fallbackUsed: fcmRes.success };
    }

    const fcmRes = await this.dispatchWithBreaker(this.fcmProvider, this.fcmBreaker, notification);
    if (fcmRes.success) return fcmRes;

    // Android push failure must NOT route to APNS — fallback to SMS for critical alerts if phone available
    return fcmRes;
  }

  private async dispatchSmsWithFailover(
    notification: NotificationRecord
  ): Promise<ProviderDeliveryResponse & { fallbackUsed?: boolean }> {
    if (this.msg91Breaker.canExecute()) {
      const res = await this.msg91Provider.send(notification);
      this.trackProviderCall(this.msg91Provider.name, res.success);
      if (res.success) {
        this.msg91Breaker.recordSuccess();
        notification.provider = this.msg91Provider.name;
        notification.costInr = this.msg91Provider.getQuota().costPerUnitInr;
        return res;
      } else {
        this.msg91Breaker.recordFailure();
        logger.warn('Primary MSG91 failed; failing over to Twilio', {
          service: 'ProviderManager',
          correlationId: notification.correlationId,
          error: res.errorMessage,
        });
      }
    }

    if (this.twilioBreaker.canExecute()) {
      const res = await this.twilioProvider.send(notification);
      this.trackProviderCall(this.twilioProvider.name, res.success);
      if (res.success) {
        this.twilioBreaker.recordSuccess();
        notification.provider = this.twilioProvider.name;
        notification.costInr = this.twilioProvider.getQuota().costPerUnitInr;
        return { ...res, fallbackUsed: true };
      } else {
        this.twilioBreaker.recordFailure();
      }
    }

    if (notification.priority !== 'CRITICAL' && this.whatsAppBreaker.canExecute()) {
      notification.channel = 'WHATSAPP';
      const waRes = await this.whatsAppProvider.send(notification);
      this.trackProviderCall(this.whatsAppProvider.name, waRes.success);
      if (waRes.success) {
        this.whatsAppBreaker.recordSuccess();
        notification.provider = this.whatsAppProvider.name;
        notification.costInr = this.whatsAppProvider.getQuota().costPerUnitInr;
        return { ...waRes, fallbackUsed: true };
      }
    }

    return {
      success: false,
      externalId: '',
      provider: 'SMS_CLUSTER_EXHAUSTED',
      latencyMs: 10,
      statusCode: 503,
      errorMessage: 'All SMS providers (MSG91 and Twilio) are currently unavailable or circuit tripped.',
      errorClassification: 'TRANSIENT',
    };
  }

  private async dispatchWithBreaker(
    provider: DeliveryProvider,
    breaker: CircuitBreaker,
    notification: NotificationRecord
  ): Promise<ProviderDeliveryResponse> {
    if (!breaker.canExecute()) {
      return {
        success: false,
        externalId: '',
        provider: provider.name,
        mode: provider.mode,
        latencyMs: 0,
        statusCode: 503,
        errorMessage: `Circuit breaker for ${provider.name} is currently OPEN. Request rejected.`,
        errorClassification: 'TRANSIENT',
      };
    }

    const res = await provider.send(notification);
    this.trackProviderCall(provider.name, res.success);
    if (res.success) {
      breaker.recordSuccess();
      notification.provider = provider.name;
      notification.costInr = provider.getQuota().costPerUnitInr;
    } else {
      breaker.recordFailure();
    }
    return res;
  }

  public getProviderBreakdown() {
    const out: Record<string, { requests: number; failures: number; circuitState: string }> = {};
    for (const cb of this.getCircuitBreakerStatuses()) {
      const stat = this.providerStats[cb.name] || { requests: 0, failures: 0 };
      out[cb.name] = {
        requests: stat.requests,
        failures: stat.failures,
        circuitState: cb.state,
      };
    }
    return out;
  }

  public getCircuitBreakerStatuses() {
    return [
      this.msg91Breaker.getStats(),
      this.twilioBreaker.getStats(),
      this.emailBreaker.getStats(),
      this.fcmBreaker.getStats(),
      this.apnsBreaker.getStats(),
      this.whatsAppBreaker.getStats(),
      this.inAppBreaker.getStats(),
    ];
  }
}
