import { v4 as uuidv4 } from 'uuid';
import { RegulatoryClassification } from '../../events/models/event';
import { DatabaseClient } from '../../database/db-client';
import { RedisClient } from '../../infrastructure/redis-client';

export interface DndCheckResult {
  allowed: boolean;
  status: 'PASS' | 'BLOCKED' | 'REGULATORY_BYPASS';
  reason: string;
  checkedAt: string;
  phoneNumber: string;
  classification: RegulatoryClassification;
  dndCategory?: string;
}

export interface ConsentRecord {
  id: string;
  userId: string;
  channel: 'SMS' | 'WHATSAPP' | 'EMAIL';
  category: string;
  optedIn: boolean;
  source: string;
  timestamp: string;
  ipAddress?: string;
}

export class DndService {
  private static instance: DndService;
  // Simulated National Customer Preference Register (NCPR / TRAI DND)
  private dndRegistry: Set<string> = new Set();
  private consentAuditLogs: ConsentRecord[] = [];
  private lastRefreshedAt: string = new Date().toISOString();

  private constructor() {
    this.dndRegistry.add('+919876543210');
    this.dndRegistry.add('+919999988888');
    this.dndRegistry.add('+919123456780');
    this.dndRegistry.add('+919888877777');
  }

  public static getInstance(): DndService {
    if (!DndService.instance) {
      DndService.instance = new DndService();
    }
    return DndService.instance;
  }

  public registerDndNumber(phone: string): void {
    this.dndRegistry.add(phone);
    void RedisClient.getInstance().setEx(`dnd:${phone}`, 86400, '1');
  }

  public unregisterDndNumber(phone: string): void {
    this.dndRegistry.delete(phone);
    void RedisClient.getInstance().del(`dnd:${phone}`);
  }

  public isDndRegistered(phone: string): boolean {
    return this.dndRegistry.has(phone);
  }

  public async refreshDailyCache(): Promise<{ refreshedCount: number; refreshedAt: string }> {
    const redis = RedisClient.getInstance();
    for (const phone of this.dndRegistry) {
      await redis.setEx(`dnd:${phone}`, 86400, '1');
    }
    this.lastRefreshedAt = new Date().toISOString();
    return { refreshedCount: this.dndRegistry.size, refreshedAt: this.lastRefreshedAt };
  }

  public getLastRefreshedAt(): string {
    return this.lastRefreshedAt;
  }

  /**
   * Verified immediately at SMS dispatch time (LAST compliance step before carrier call).
   */
  public verifySmsDispatch(
    phone: string,
    classification: RegulatoryClassification,
    eventCode: string,
    hasExplicitFinancialOptIn: boolean = false
  ): DndCheckResult {
    const checkedAt = new Date().toISOString();
    const isRegistered = this.dndRegistry.has(phone);

    // 1. Regulatory Mandatory & Transactional ALWAYS bypass DND per SEBI / TRAI UCC Regulation 2018
    if (classification === 'REGULATORY_MANDATORY' || classification === 'TRANSACTIONAL') {
      return {
        allowed: true,
        status: isRegistered ? 'REGULATORY_BYPASS' : 'PASS',
        reason: `Exempted from TRAI DND under UCC Regulation 2018 (Event: ${eventCode}, Classification: ${classification})`,
        checkedAt,
        phoneNumber: phone,
        classification,
        dndCategory: 'BANKING_FINANCE',
      };
    }

    // 2. Promotional SMS to DND number requires explicit financial opt-in
    if (isRegistered && !hasExplicitFinancialOptIn) {
      return {
        allowed: false,
        status: 'BLOCKED',
        reason: 'Recipient is registered on TRAI NCPR (DND) and has no explicit financial promotion opt-in.',
        checkedAt,
        phoneNumber: phone,
        classification,
        dndCategory: 'PROMOTIONAL_BLOCKED',
      };
    }

    return {
      allowed: true,
      status: 'PASS',
      reason: isRegistered
        ? 'Allowed via explicit opt-in preference override'
        : 'Recipient not on DND registry',
      checkedAt,
      phoneNumber: phone,
      classification,
      dndCategory: 'PROMOTIONAL_OPT_IN',
    };
  }

  /**
   * Separate OTT WhatsApp Meta opt-in & Email consent checks (Spec Error 2 fix).
   */
  public verifyOttConsent(
    channel: 'WHATSAPP' | 'EMAIL',
    classification: RegulatoryClassification,
    hasChannelConsent: boolean
  ): { allowed: boolean; reason: string } {
    if (classification === 'REGULATORY_MANDATORY') {
      return { allowed: true, reason: 'Regulatory mandate overrides channel consent restrictions' };
    }
    if (!hasChannelConsent) {
      return {
        allowed: false,
        reason: `${channel} explicit opt-in consent missing (Meta/Email policy enforcement)`,
      };
    }
    return { allowed: true, reason: `${channel} explicit consent verified` };
  }

  public recordConsent(consent: ConsentRecord): void {
    const record: ConsentRecord = {
      ...consent,
      id: consent.id || uuidv4(),
      timestamp: consent.timestamp || new Date().toISOString(),
    };
    this.consentAuditLogs.push(record);

    const db = DatabaseClient.getInstance();
    if (db.isConnected()) {
      void db.query(
        `INSERT INTO consent_records (id, user_id, channel, category, opted_in, source, ip_address, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [
          record.id,
          record.userId,
          record.channel,
          record.category,
          record.optedIn,
          record.source,
          record.ipAddress || null,
          record.timestamp,
        ]
      );
    }
  }

  public getConsentLogs(userId?: string): ConsentRecord[] {
    if (userId) {
      return this.consentAuditLogs.filter((c) => c.userId === userId);
    }
    return [...this.consentAuditLogs];
  }
}
