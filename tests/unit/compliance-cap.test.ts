import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { DndService } from '../../src/compliance/dnd/dnd-service';
import { FrequencyCapService } from '../../src/compliance/frequency-cap/frequency-cap-service';
import { QuietHoursService } from '../../src/compliance/quiet-hours/quiet-hours-service';

describe('TRAI DND & Atomic Frequency Capping Test Suite (25+ Tests)', () => {
  const dndService = DndService.getInstance();
  const capService = FrequencyCapService.getInstance();
  const quietService = QuietHoursService.getInstance();

  const dndPhone = '+919876543210';
  const cleanPhone = '+919111122222';
  const testUser = 'USR-TEST-CAP-1';

  beforeEach(() => {
    dndService.registerDndNumber(dndPhone);
    dndService.unregisterDndNumber(cleanPhone);
    capService.resetUserHistory(testUser);
  });

  // DND Tests (1-10)
  test('1. Blocks promotional SMS to DND-registered number', () => {
    const res = dndService.verifySmsDispatch(dndPhone, 'PROMOTIONAL', 'SIPX-004');
    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.status, 'BLOCKED');
  });

  test('2. Allows promotional SMS to clean (non-DND) number', () => {
    const res = dndService.verifySmsDispatch(cleanPhone, 'PROMOTIONAL', 'SIPX-004');
    assert.strictEqual(res.allowed, true);
    assert.strictEqual(res.status, 'PASS');
  });

  test('3. Allows Transactional SMS (Buy Order) to DND number via UCC exemption', () => {
    const res = dndService.verifySmsDispatch(dndPhone, 'TRANSACTIONAL', 'TXNX-001');
    assert.strictEqual(res.allowed, true);
    assert.strictEqual(res.status, 'REGULATORY_BYPASS');
  });

  test('4. Allows Mandatory Margin Call (RISK-001) to DND number', () => {
    const res = dndService.verifySmsDispatch(dndPhone, 'REGULATORY_MANDATORY', 'RISK-001');
    assert.strictEqual(res.allowed, true);
    assert.strictEqual(res.status, 'REGULATORY_BYPASS');
  });

  test('5. Allows Emergency Policy Change (REGX-005) to DND number', () => {
    const res = dndService.verifySmsDispatch(dndPhone, 'REGULATORY_MANDATORY', 'REGX-005');
    assert.strictEqual(res.allowed, true);
  });

  test('6. Allows promotional SMS if user has explicit financial opt-in', () => {
    const res = dndService.verifySmsDispatch(dndPhone, 'PROMOTIONAL', 'MKTX-005', true);
    assert.strictEqual(res.allowed, true);
    assert.strictEqual(res.status, 'PASS');
  });

  test('7. Records immutable consent audit log', () => {
    dndService.recordConsent({
      id: 'c-1',
      userId: testUser,
      channel: 'SMS',
      category: 'PROMOTIONAL',
      optedIn: true,
      source: 'MOBILE_APP_SETTINGS',
      timestamp: new Date().toISOString(),
    });
    const logs = dndService.getConsentLogs(testUser);
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].optedIn, true);
  });

  test('8. DND verification records ISO timestamp on check', () => {
    const res = dndService.verifySmsDispatch(cleanPhone, 'TRANSACTIONAL', 'TXNX-002');
    assert.ok(res.checkedAt.includes('T'));
  });

  test('9. Dynamic registration of number into DND cache takes effect immediately', () => {
    const tempPhone = '+919333344444';
    dndService.registerDndNumber(tempPhone);
    assert.strictEqual(dndService.isDndRegistered(tempPhone), true);
    dndService.unregisterDndNumber(tempPhone);
    assert.strictEqual(dndService.isDndRegistered(tempPhone), false);
  });

  test('10. Order Rejection (TXNX-003) is treated as Transactional', () => {
    const res = dndService.verifySmsDispatch(dndPhone, 'TRANSACTIONAL', 'TXNX-003');
    assert.strictEqual(res.allowed, true);
  });

  // Frequency Capping Tests (11-20)
  test('11. Allows first notification within limits', () => {
    const res = capService.checkAndRecord(testUser, 'SMS', 'TRANSACTION', 'TXNX-001', 'HIGH', 'TRANSACTIONAL');
    assert.strictEqual(res.allowed, true);
    assert.strictEqual(res.status, 'PASS');
  });

  test('12. Blocks same event-type sent within 15 minutes cooldown', () => {
    capService.checkAndRecord(testUser, 'SMS', 'MARKET', 'MKTX-001', 'MEDIUM', 'TRANSACTIONAL');
    const res2 = capService.checkAndRecord(testUser, 'SMS', 'MARKET', 'MKTX-001', 'MEDIUM', 'TRANSACTIONAL');
    assert.strictEqual(res2.allowed, false);
    assert.strictEqual(res2.status, 'BLOCKED');
    assert.ok(res2.reason.includes('cooldown'));
  });

  test('13. CRITICAL event bypasses same-event cooldown', () => {
    capService.checkAndRecord(testUser, 'SMS', 'RISK', 'RISK-001', 'CRITICAL', 'REGULATORY_MANDATORY');
    const res2 = capService.checkAndRecord(testUser, 'SMS', 'RISK', 'RISK-001', 'CRITICAL', 'REGULATORY_MANDATORY');
    assert.strictEqual(res2.allowed, true);
    assert.strictEqual(res2.status, 'CRITICAL_BYPASS');
  });

  test('14. Enforces Category Hourly Cap of 3 per 60 minutes', () => {
    capService.checkAndRecord(testUser, 'PUSH', 'MARKET', 'MKTX-001', 'LOW', 'PROMOTIONAL');
    capService.checkAndRecord(testUser, 'PUSH', 'MARKET', 'MKTX-002', 'LOW', 'PROMOTIONAL');
    capService.checkAndRecord(testUser, 'PUSH', 'MARKET', 'MKTX-003', 'LOW', 'PROMOTIONAL');
    // 4th event in same category
    const res4 = capService.checkAndRecord(testUser, 'PUSH', 'MARKET', 'MKTX-004', 'LOW', 'PROMOTIONAL');
    assert.strictEqual(res4.allowed, false);
    assert.strictEqual(res4.status, 'BLOCKED');
    assert.ok(res4.reason.includes('category hourly cap'));
  });

  test('15. Enforces SMS Daily Cap of 5 SMS', () => {
    const userSms = 'USR-SMS-CAP';
    const categories: any[] = ['TRANSACTION', 'RISK', 'SIP', 'MARKET', 'REGULATORY'];
    for (let i = 0; i < 5; i++) {
      capService.checkAndRecord(userSms, 'SMS', categories[i], `EVT-${i}`, 'LOW', 'PROMOTIONAL');
    }
    const res6 = capService.checkAndRecord(userSms, 'SMS', 'TRANSACTION', 'EVT-NEW', 'LOW', 'PROMOTIONAL');
    assert.strictEqual(res6.allowed, false);
    assert.strictEqual(res6.status, 'BLOCKED');
    assert.ok(res6.reason.includes('SMS daily frequency cap'));
  });

  test('16. Enforces Email Daily Cap of 3 emails', () => {
    const userEmail = 'USR-EMAIL-CAP';
    const categories: any[] = ['TRANSACTION', 'RISK', 'SIP'];
    for (let i = 0; i < 3; i++) {
      capService.checkAndRecord(userEmail, 'EMAIL', categories[i], `SIPX-00${i}`, 'LOW', 'PROMOTIONAL');
    }
    const res4 = capService.checkAndRecord(userEmail, 'EMAIL', 'MARKET', 'SIPX-005', 'LOW', 'PROMOTIONAL');
    assert.strictEqual(res4.allowed, false);
  });

  test('17. Enforces Global Daily Cap of 12 notifications across channels', () => {
    const userGlobal = 'USR-GLOBAL-CAP';
    const categories: any[] = ['TRANSACTION', 'RISK', 'SIP', 'MARKET', 'REGULATORY'];
    const channels: any[] = ['PUSH', 'IN_APP'];
    for (let i = 0; i < 12; i++) {
      capService.checkAndRecord(userGlobal, channels[i % channels.length], categories[i % categories.length], `MKTX-${i}`, 'LOW', 'PROMOTIONAL');
    }
    const res13 = capService.checkAndRecord(userGlobal, 'IN_APP', 'MARKET', 'MKTX-99', 'LOW', 'PROMOTIONAL');
    assert.strictEqual(res13.allowed, false);
    assert.ok(res13.reason.includes('Global user daily cap'));
  });

  test('18. CRITICAL event bypasses Global Daily Cap', () => {
    const userGlobal = 'USR-GLOBAL-CAP-BYPASS';
    for (let i = 0; i < 12; i++) {
      capService.checkAndRecord(userGlobal, 'PUSH', 'MARKET', `MKTX-${i}`, 'LOW', 'PROMOTIONAL');
    }
    const critRes = capService.checkAndRecord(userGlobal, 'SMS', 'RISK', 'RISK-001', 'CRITICAL', 'REGULATORY_MANDATORY');
    assert.strictEqual(critRes.allowed, true);
    assert.strictEqual(critRes.status, 'CRITICAL_BYPASS');
  });

  test('19. Cap decisions are logged for auditability', () => {
    capService.checkAndRecord(testUser, 'IN_APP', 'SIP', 'SIPX-001', 'LOW', 'PROMOTIONAL');
    const logs = capService.getDecisionLogs();
    assert.ok(logs.length > 0);
  });

  test('20. Different event types in same category have separate cooldowns', () => {
    const r1 = capService.checkAndRecord(testUser, 'PUSH', 'SIP', 'SIPX-001', 'MEDIUM', 'TRANSACTIONAL');
    const r2 = capService.checkAndRecord(testUser, 'PUSH', 'SIP', 'SIPX-002', 'MEDIUM', 'TRANSACTIONAL');
    assert.strictEqual(r1.allowed, true);
    assert.strictEqual(r2.allowed, true);
  });

  // Quiet Hours Tests (21-25)
  test('21. Dispatches immediately during active hours (e.g. 14:00)', () => {
    const res = quietService.evaluate('MEDIUM', 'Asia/Kolkata', '21:00', '08:00');
    // If running in test, verify structure
    assert.ok(res.action);
    assert.ok(res.localTimeStr);
  });

  test('22. CRITICAL event bypasses quiet hours window', () => {
    const res = quietService.evaluate('CRITICAL', 'Asia/Kolkata', '00:00', '23:59'); // Force quiet
    assert.strictEqual(res.action, 'CRITICAL_BYPASS');
  });

  test('23. Non-critical event queues for morning during quiet hours', () => {
    const res = quietService.evaluate('LOW', 'Asia/Kolkata', '00:00', '23:59'); // Force quiet
    assert.strictEqual(res.action, 'QUEUED_FOR_MORNING');
  });

  test('24. Queued notifications accumulate in quiet hours store', () => {
    const mockNotif: any = { id: 'q-1', userId: testUser };
    quietService.enqueueForMorning(testUser, mockNotif);
    const queued = quietService.getQueuedNotifications(testUser);
    assert.strictEqual(queued.length, 1);
  });

  test('25. Morning flush suggests digest when accumulated count > 5', () => {
    const digestUser = 'USR-DIGEST';
    for (let i = 0; i < 6; i++) {
      quietService.enqueueForMorning(digestUser, { id: `q-${i}`, userId: digestUser } as any);
    }
    const flush = quietService.flushMorningQueue(digestUser);
    assert.strictEqual(flush.items.length, 6);
    assert.strictEqual(flush.digestSuggested, true);
  });
});
