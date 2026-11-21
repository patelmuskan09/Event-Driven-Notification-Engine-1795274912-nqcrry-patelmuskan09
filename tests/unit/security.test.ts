import { test, describe } from 'node:test';
import assert from 'node:assert';
import jwt from 'jsonwebtoken';
import { validateEventPayload } from '../../src/events/validators/event-validator';
import {
  authenticateCredentials,
  issueTokenPair,
  rotateRefreshToken,
  revokeRefreshToken,
} from '../../src/api/middleware/auth';
import {
  encryptPii,
  decryptPii,
  maskPhoneNumber,
  maskEmail,
  maskAccountId,
  signWebhookPayload,
  verifyWebhookSignature,
  sanitizeTextInput,
} from '../../src/utils/crypto';
import { config } from '../../src/config/env';

describe('Security, Cryptography, Auth Rotation & Input Defense Test Suite', () => {
  describe('1. JWT Authentication & Single-Use Refresh Token Rotation', () => {
    test('Authenticates valid configured accounts and rejects wrong passwords', () => {
      const admin = authenticateCredentials('admin@brokerage.local', 'admin-local-dev');
      assert.ok(admin);
      assert.strictEqual(admin!.role, 'ADMIN');

      const bad = authenticateCredentials('admin@brokerage.local', 'wrong-password');
      assert.strictEqual(bad, null);
    });

    test('Issues short-lived access token (<= 1 hour TTL) and single-use refresh token', () => {
      const user = authenticateCredentials('operator@brokerage.local', 'operator-local-dev')!;
      const pair1 = issueTokenPair(user);
      assert.ok(pair1.expiresInSeconds <= 3600);

      const decoded = jwt.verify(pair1.accessToken, config.jwtSecret) as any;
      assert.strictEqual(decoded.role, 'OPERATOR');
      assert.strictEqual(decoded.tokenType, 'access');

      // Rotate refresh token once -> succeeds
      const pair2 = rotateRefreshToken(pair1.refreshToken);
      assert.ok(pair2);
      assert.notStrictEqual(pair2!.refreshToken, pair1.refreshToken);

      // Reusing old refresh token -> rejected (single-use rotation enforced)
      const reuseAttempt = rotateRefreshToken(pair1.refreshToken);
      assert.strictEqual(reuseAttempt, null);

      // Revoke pair2 on logout -> subsequent refresh fails
      assert.strictEqual(revokeRefreshToken(pair2!.refreshToken), true);
      assert.strictEqual(rotateRefreshToken(pair2!.refreshToken), null);
    });

    test('Rejects expired or tampered JWT access token', () => {
      const expired = jwt.sign({ userId: 'U-1' }, config.jwtSecret, { expiresIn: '-1s' });
      assert.throws(() => jwt.verify(expired, config.jwtSecret), /jwt expired/);

      const valid = jwt.sign({ userId: 'U-1', role: 'OPERATOR' }, config.jwtSecret);
      const [h, , s] = valid.split('.');
      const tamperedPayload = Buffer.from(JSON.stringify({ userId: 'U-1', role: 'ADMIN' })).toString('base64url');
      assert.throws(() => jwt.verify(`${h}.${tamperedPayload}.${s}`, config.jwtSecret), /invalid signature/);
    });
  });

  describe('2. AES-256-GCM PII Encryption & Webhook HMAC Verification', () => {
    test('Encrypts and decrypts PII phone and email cleanly with random IVs', () => {
      const phone = '+919876543210';
      const c1 = encryptPii(phone);
      const c2 = encryptPii(phone);
      assert.ok(c1.startsWith('enc:v1:'));
      assert.notStrictEqual(c1, c2); // Unique 12-byte IV per encryption
      assert.strictEqual(decryptPii(c1), phone);
      assert.strictEqual(decryptPii(c2), phone);
    });

    test('Verifies timing-safe HMAC-SHA256 webhook signatures', () => {
      const raw = JSON.stringify({ notificationId: 'notif_1', status: 'DELIVERED' });
      const sig = signWebhookPayload(raw);
      assert.strictEqual(verifyWebhookSignature(raw, sig), true);
      assert.strictEqual(verifyWebhookSignature(raw, `sha256=${sig}`), true);
      assert.strictEqual(verifyWebhookSignature(raw, '0'.repeat(sig.length)), false);
      assert.strictEqual(verifyWebhookSignature(raw, undefined), false);
    });

    test('Sanitizes HTML/XSS characters and masks phone, email, and account IDs', () => {
      assert.strictEqual(sanitizeTextInput('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
      assert.strictEqual(maskPhoneNumber('+919876543210'), '+9198XXXX3210');
      assert.strictEqual(maskEmail('investor@brokerage.in'), 'i***@brokerage.in');
      assert.strictEqual(maskAccountId('ACC-8941209934'), 'ACC-XXXXXX9934');
    });
  });

  describe('3. Injection Defense in Strict Event Validation', () => {
    test('Rejects NoSQL-style operator object in numeric fields', () => {
      const result = validateEventPayload('TXNX-001', {
        order_id: 'ORD-SEC-01',
        symbol: 'TCS',
        quantity: { $gt: 0 } as any,
        price: 3500,
        total_amount: 35000,
        execution_time: new Date().toISOString(),
        exchange: 'NSE',
      });
      assert.strictEqual(result.success, false);
    });
  });
});
