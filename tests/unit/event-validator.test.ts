import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  validateEventPayload,
  validateBaseIngestEvent,
} from '../../src/events/validators/event-validator';
import { EventFactory } from '../../src/events/factory';
import { FINANCIAL_EVENTS_REGISTRY } from '../../src/events/taxonomy';

describe('Financial Event Taxonomy & Strict Validation Test Suite (20+ Tests)', () => {
  const allEventCodes = Object.keys(FINANCIAL_EVENTS_REGISTRY);

  test('1. All 25 financial event types across 5 categories are registered', () => {
    assert.strictEqual(allEventCodes.length, 25);
    for (let i = 1; i <= 5; i++) {
      assert.ok(allEventCodes.includes(`TXNX-00${i}`));
      assert.ok(allEventCodes.includes(`RISK-00${i}`));
      assert.ok(allEventCodes.includes(`SIPX-00${i}`));
      assert.ok(allEventCodes.includes(`MKTX-00${i}`));
      assert.ok(allEventCodes.includes(`REGX-00${i}`));
    }
  });

  test('2. Every single one of the 25 EventFactory payloads passes strict schema validation', () => {
    for (const code of allEventCodes) {
      const evt = EventFactory.createEvent(code);
      const baseRes = validateBaseIngestEvent(evt);
      assert.strictEqual(baseRes.success, true, `Base envelope invalid for ${code}: ${baseRes.error}`);
      const payloadRes = validateEventPayload(code, evt.payload);
      assert.strictEqual(payloadRes.success, true, `Payload invalid for ${code}: ${payloadRes.error}`);
    }
  });

  test('3. Rejects unknown eventType cleanly', () => {
    const res = validateEventPayload('UNKNOWN-999', { foo: 'bar' });
    assert.strictEqual(res.success, false);
    assert.ok(res.error?.includes('Unsupported eventType'));
  });

  test('4. Rejects unexpected unknown fields in strict payload schema (TXNX-001)', () => {
    const evt = EventFactory.createEvent('TXNX-001');
    const res = validateEventPayload('TXNX-001', { ...evt.payload, unexpectedField: 123 });
    assert.strictEqual(res.success, false);
  });

  test('5. Rejects unexpected unknown fields on BaseIngestEventSchema', () => {
    const evt = EventFactory.createEvent('RISK-001');
    const res = validateBaseIngestEvent({ ...evt, hackerRootKey: true });
    assert.strictEqual(res.success, false);
  });

  test('6. Rejects invalid sourceSystem enum on BaseIngestEventSchema', () => {
    const evt = EventFactory.createEvent('RISK-001');
    const res = validateBaseIngestEvent({ ...evt, sourceSystem: 'ROGUE_BOT' });
    assert.strictEqual(res.success, false);
  });

  test('7. Rejects negative quantity in Buy Order Executed (TXNX-001)', () => {
    const evt = EventFactory.createEvent('TXNX-001');
    const res = validateEventPayload('TXNX-001', { ...evt.payload, quantity: -10 });
    assert.strictEqual(res.success, false);
  });

  test('8. Rejects invalid exchange code in Sell Order Executed (TXNX-002)', () => {
    const evt = EventFactory.createEvent('TXNX-002');
    const res = validateEventPayload('TXNX-002', { ...evt.payload, exchange: 'NASDAQ' });
    assert.strictEqual(res.success, false);
  });

  test('9. Rejects empty rejection_reason in Order Rejected (TXNX-003)', () => {
    const evt = EventFactory.createEvent('TXNX-003');
    const res = validateEventPayload('TXNX-003', { ...evt.payload, rejection_reason: '' });
    assert.strictEqual(res.success, false);
  });

  test('10. Rejects zero/negative dividend amount in TXNX-004', () => {
    const evt = EventFactory.createEvent('TXNX-004');
    const res = validateEventPayload('TXNX-004', { ...evt.payload, amount: 0 });
    assert.strictEqual(res.success, false);
  });

  test('11. Rejects unsupported payment_mode in Funds Deposited (TXNX-005)', () => {
    const evt = EventFactory.createEvent('TXNX-005');
    const res = validateEventPayload('TXNX-005', { ...evt.payload, payment_mode: 'CRYPTO' });
    assert.strictEqual(res.success, false);
  });

  test('12. Validates Margin Call (RISK-001) even when available_margin is negative (overdraft)', () => {
    const evt = EventFactory.createEvent('RISK-001');
    const res = validateEventPayload('RISK-001', { ...evt.payload, available_margin: -5000 });
    assert.strictEqual(res.success, true);
  });

  test('13. Rejects Position Squared Off (RISK-003) with empty positions array', () => {
    const evt = EventFactory.createEvent('RISK-003');
    const res = validateEventPayload('RISK-003', { ...evt.payload, positions: [] });
    assert.strictEqual(res.success, false);
  });

  test('14. Rejects Concentration Alert (RISK-005) above 100%', () => {
    const evt = EventFactory.createEvent('RISK-005');
    const res = validateEventPayload('RISK-005', { ...evt.payload, concentration_percent: 140 });
    assert.strictEqual(res.success, false);
  });

  test('15. Validates SIPX-001 through SIPX-005 payloads cleanly', () => {
    for (let i = 1; i <= 5; i++) {
      const evt = EventFactory.createEvent(`SIPX-00${i}`);
      assert.strictEqual(validateEventPayload(`SIPX-00${i}`, evt.payload).success, true);
    }
  });

  test('16. Rejects invalid circuit_type in MKTX-002', () => {
    const evt = EventFactory.createEvent('MKTX-002');
    const res = validateEventPayload('MKTX-002', { ...evt.payload, circuit_type: 'MIDDLE' });
    assert.strictEqual(res.success, false);
  });

  test('17. Rejects invalid session enum in Market Open/Close (MKTX-003)', () => {
    const evt = EventFactory.createEvent('MKTX-003');
    const res = validateEventPayload('MKTX-003', { ...evt.payload, session: 'MIDNIGHT' });
    assert.strictEqual(res.success, false);
  });

  test('18. Rejects malformed download_url in REGX-001 & REGX-003', () => {
    const kyc = EventFactory.createEvent('REGX-001');
    assert.strictEqual(validateEventPayload('REGX-001', { ...kyc.payload, rekyc_portal_url: 'not-a-url' }).success, false);
    const cn = EventFactory.createEvent('REGX-003');
    assert.strictEqual(validateEventPayload('REGX-003', { ...cn.payload, download_url: 'javascript:alert(1)' }).success, false);
  });

  test('19. Rejects unauthorized issuing_authority in REGX-005', () => {
    const evt = EventFactory.createEvent('REGX-005');
    const res = validateEventPayload('REGX-005', { ...evt.payload, issuing_authority: 'RANDOM_BLOG' });
    assert.strictEqual(res.success, false);
  });

  test('20. Rejects missing mandatory fields in TAX Statement (REGX-004)', () => {
    const res = validateEventPayload('REGX-004', { financial_year: 'FY 2025-26' });
    assert.strictEqual(res.success, false);
  });
});
