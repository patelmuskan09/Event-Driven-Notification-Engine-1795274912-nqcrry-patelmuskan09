import crypto from 'crypto';
import { config } from '../config/env';

/**
 * Derives a 32-byte AES-256 key deterministically from PII_ENCRYPTION_KEY.
 */
function getAesKey(): Buffer {
  return crypto.createHash('sha256').update(config.piiEncryptionKey).digest();
}

/**
 * Encrypts sensitive PII (phone, email) at rest using AES-256-GCM.
 * Returns formatted payload: `enc:v1:<ivHex>:<authTagHex>:<cipherHex>`.
 */
export function encryptPii(plaintext: string): string {
  if (!plaintext) return plaintext;
  if (plaintext.startsWith('enc:v1:')) return plaintext;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getAesKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `enc:v1:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts AES-256-GCM encrypted PII values.
 */
export function decryptPii(ciphertext: string): string {
  if (!ciphertext || !ciphertext.startsWith('enc:v1:')) return ciphertext;
  const parts = ciphertext.split(':');
  if (parts.length !== 5) return ciphertext;

  const [, , ivHex, tagHex, dataHex] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', getAesKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Masks phone numbers for logs and compliance audits (e.g., +9198XXXX3210).
 */
export function maskPhoneNumber(phone: string): string {
  if (!phone) return phone;
  if (/^\+\d{4}\d{4}\d{4}$/.test(phone)) {
    return phone.replace(/(\+\d{4})(\d{4})(\d{4})/, '$1XXXX$3');
  }
  if (phone.length >= 8) {
    return `${phone.slice(0, 4)}XXXX${phone.slice(-4)}`;
  }
  return 'XXXX';
}

/**
 * Masks email addresses for logs and compliance audits (e.g., s***@domain.com).
 */
export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  const firstChar = local.slice(0, 1) || '*';
  return `${firstChar}***@${domain}`;
}

/**
 * Masks financial account IDs (e.g., ACC-XXXXXX9934).
 */
export function maskAccountId(accountId: string): string {
  if (!accountId) return accountId;
  return accountId.replace(/(ACC-)(\d+)(\d{4})$/, '$1XXXXXX$3');
}

/**
 * Generates an HMAC-SHA256 signature for provider webhook verification.
 */
export function signWebhookPayload(payload: string, secret: string = config.webhookHmacSecret): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verifies an HMAC-SHA256 webhook signature using timing-safe comparison.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string | undefined,
  secret: string = config.webhookHmacSecret
): boolean {
  if (!signature) return false;
  const normalizedSig = signature.replace(/^sha256=/, '');
  const expected = signWebhookPayload(payload, secret);
  const sigBuf = Buffer.from(normalizedSig, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

/**
 * Escapes HTML special characters to neutralize XSS / HTML injection in user-supplied strings.
 */
export function sanitizeTextInput(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
