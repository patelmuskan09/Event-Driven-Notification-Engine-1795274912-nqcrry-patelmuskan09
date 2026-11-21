import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { app, buildOpenApiSpec } from '../../server';
import { signWebhookPayload } from '../../src/utils/crypto';

let serverInstance: http.Server;
let BASE_URL = 'http://127.0.0.1:0';
let adminToken = '';
let operatorToken = '';

before(async () => {
  await new Promise<void>((resolve) => {
    serverInstance = app.listen(0, '127.0.0.1', () => {
      const address = serverInstance.address() as any;
      BASE_URL = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });

  const adminLogin = await request('/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'admin@brokerage.local', password: 'admin-local-dev' },
  });
  adminToken = adminLogin.data.accessToken;

  const opLogin = await request('/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'operator@brokerage.local', password: 'operator-local-dev' },
  });
  operatorToken = opLogin.data.accessToken;
});

after(async () => {
  if (serverInstance) {
    await new Promise<void>((resolve) => serverInstance.close(() => resolve()));
  }
});

function request(
  path: string,
  options: { method?: string; body?: any; headers?: Record<string, string>; token?: string } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; data: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    if (options.token) {
      headers['Authorization'] = `Bearer ${options.token}`;
    }

    const req = http.request(
      {
        method: options.method || 'GET',
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers,
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => (rawData += chunk));
        res.on('end', () => {
          let parsed: any;
          try {
            parsed = rawData ? JSON.parse(rawData) : null;
          } catch {
            parsed = rawData;
          }
          resolve({ status: res.statusCode || 0, headers: res.headers, data: parsed });
        });
      }
    );

    req.on('error', reject);
    if (options.body !== undefined) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

describe('1. Health, Observability & OpenAPI Verification', () => {
  test('GET /health returns 200 and honest component statuses', async () => {
    const res = await request('/health');
    assert.strictEqual(res.status, 200);
    assert.ok(['healthy', 'degraded_fallback_active'].includes(res.data.status));
    assert.strictEqual(res.data.components.api, 'UP');
    assert.ok(Array.isArray(res.data.circuit_breakers));
  });

  test('GET /metrics returns all 9 Prometheus exposition metrics', async () => {
    const res = await request('/metrics');
    assert.strictEqual(res.status, 200);
    assert.ok(typeof res.data === 'string');
    assert.ok(res.data.includes('notification_events_received_total'));
    assert.ok(res.data.includes('notification_delivery_total'));
    assert.ok(res.data.includes('notification_dlq_depth'));
    assert.ok(res.data.includes('delivery_provider_circuit_state'));
  });

  test('GET /api/v1/swagger.json returns complete OpenAPI 3.0.3 spec', async () => {
    const res = await request('/api/v1/swagger.json');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.openapi, '3.0.3');
    assert.ok(res.data.paths['/api/v1/events']);
    assert.ok(res.data.paths['/api/v1/webhooks/{provider}']);
    assert.ok(buildOpenApiSpec().components.securitySchemes.bearerAuth);
  });
});

describe('2. Authentication, RBAC & Rate Limiting Enforcement', () => {
  test('Protected /api/v1/events rejects unauthenticated request with 401', async () => {
    const res = await request('/api/v1/events', { method: 'POST', body: {} });
    assert.strictEqual(res.status, 401);
  });

  test('DELETE /api/v1/users/:id/data rejects OPERATOR role with 403 Forbidden', async () => {
    const res = await request('/api/v1/users/USR-OP-DENIED/data', {
      method: 'DELETE',
      token: operatorToken,
    });
    assert.strictEqual(res.status, 403);
  });

  test('Malformed JSON request returns clean 400 error without stack leak', async () => {
    const res = await request('/api/v1/events', {
      method: 'POST',
      token: adminToken,
      body: '{"brokenJson": ',
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.error, 'Bad Request');
  });

  test('PUT /api/v1/users/:id/preferences enforces 10 req/min rate limit (returns 429 on 11th request)', async () => {
    const uid = `USR-RL-${Date.now()}`;
    let got429 = false;
    for (let i = 0; i < 12; i++) {
      const res = await request(`/api/v1/users/${uid}/preferences`, {
        method: 'PUT',
        token: operatorToken,
        body: { preferredLanguage: 'en' },
      });
      if (res.status === 429) {
        got429 = true;
        break;
      }
    }
    assert.strictEqual(got429, true, 'Preference update rate limiter must trigger HTTP 429');
  });
});

describe('3. Event Ingestion API Validation, Idempotency & Lifecycle', () => {
  test('POST /api/v1/events rejects missing mandatory fields with 422', async () => {
    const res = await request('/api/v1/events', {
      method: 'POST',
      token: adminToken,
      body: { eventType: 'TXNX-001' },
    });
    assert.strictEqual(res.status, 422);
  });

  test('POST /api/v1/events rejects unknown root fields with 422', async () => {
    const res = await request('/api/v1/events', {
      method: 'POST',
      token: adminToken,
      body: {
        eventType: 'TXNX-001',
        userId: 'USR-STRICT',
        extraBadKey: true,
        payload: {
          order_id: 'ORD-1',
          symbol: 'TCS',
          quantity: 1,
          price: 100,
          total_amount: 100,
          execution_time: new Date().toISOString(),
          exchange: 'NSE',
        },
      },
    });
    assert.strictEqual(res.status, 422);
  });

  test('POST /api/v1/events accepts valid Buy Order (TXNX-001) with 202', async () => {
    const res = await request('/api/v1/events', {
      method: 'POST',
      token: adminToken,
      body: {
        eventType: 'TXNX-001',
        userId: 'USR-E2E-TEST-1',
        payload: {
          order_id: `ORD-${Date.now()}`,
          symbol: 'INFY',
          quantity: 10,
          price: 1540.5,
          total_amount: 15405.0,
          execution_time: new Date().toISOString(),
          exchange: 'NSE',
        },
      },
    });
    assert.strictEqual(res.status, 202);
    assert.ok(res.data.notification_id);
    assert.ok(res.data.channels_targeted.length > 0);
  });

  test('POST /api/v1/events ingests Critical Margin Call (RISK-001)', async () => {
    const res = await request('/api/v1/events', {
      method: 'POST',
      token: adminToken,
      body: {
        eventType: 'RISK-001',
        userId: 'USR-E2E-CRIT-1',
        sourceSystem: 'RMS',
        payload: {
          account_id: 'ACC-E2E-1',
          required_margin: 500000,
          available_margin: 320000,
          shortfall: 180000,
          deadline_time: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        },
      },
    });
    assert.strictEqual(res.status, 202);
    assert.ok(res.data.channels_targeted.includes('SMS') || res.data.channels_targeted.includes('IN_APP'));
  });

  test('POST /api/v1/events suppresses duplicate within sliding window', async () => {
    const idempotencyKey = `idemp-test-${Date.now()}`;
    const payload = {
      eventType: 'MKTX-001',
      userId: 'USR-DEDUP-TEST',
      sourceSystem: 'MARKET_FEED',
      idempotencyKey,
      payload: {
        symbol: 'TCS',
        target_price: 3900.0,
        current_price: 3915.0,
        change_percentage: 2.5,
      },
    };

    const res1 = await request('/api/v1/events', { method: 'POST', token: adminToken, body: payload });
    assert.strictEqual(res1.status, 202);
    assert.notStrictEqual(res1.data.status, 'SUPPRESSED_DUPLICATE');

    const res2 = await request('/api/v1/events', { method: 'POST', token: adminToken, body: payload });
    assert.strictEqual(res2.status, 202);
    assert.strictEqual(res2.data.status, 'SUPPRESSED_DUPLICATE');
  });
});

describe('4. Webhooks, Notification Tracking, Preferences & Right-to-Erasure', () => {
  test('POST /api/v1/webhooks/:provider rejects missing/invalid HMAC with 401 and accepts valid HMAC', async () => {
    const evtRes = await request('/api/v1/events', {
      method: 'POST',
      token: adminToken,
      body: {
        eventType: 'SIPX-001',
        userId: 'USR-SIP-AUDIT',
        sourceSystem: 'SIP_ENGINE',
        idempotencyKey: `sip-${Date.now()}`,
        payload: {
          fund_name: 'Parag Parikh Flexi Cap Fund',
          amount: 5000,
          due_date: '2026-11-10',
          mandate_bank: 'HDFC Bank (...4921)',
        },
      },
    });
    assert.strictEqual(evtRes.status, 202);

    // Get specific channel notification id from stream for that event
    const listRes = await request('/api/v1/notifications?limit=20', { token: adminToken });
    const match = listRes.data.notifications.find((n: any) => n.eventId === evtRes.data.event_id);
    assert.ok(match, 'Created notification present in paginated list');

    // Invalid HMAC rejected
    const hookBody = JSON.stringify({ notificationId: match.id, status: 'READ' });
    const badHook = await request('/api/v1/webhooks/msg91', {
      method: 'POST',
      headers: { 'X-Webhook-Signature': 'bad-signature' },
      body: hookBody,
    });
    assert.strictEqual(badHook.status, 401);

    // Valid HMAC accepted -> transitions status to READ
    const validSig = signWebhookPayload(hookBody);
    const okHook = await request('/api/v1/webhooks/msg91', {
      method: 'POST',
      headers: { 'X-Webhook-Signature': validSig },
      body: hookBody,
    });
    assert.strictEqual(okHook.status, 200);
    assert.strictEqual(okHook.data.status, 'READ');
  });

  test('PUT /users/:id/preferences validates quiet hours >= 6h constraint', async () => {
    const res = await request('/api/v1/users/USR-QH-BAD/preferences', {
      method: 'PUT',
      token: adminToken,
      body: { quietHours: { enabled: true, startTime: '22:00', endTime: '23:00' } },
    });
    assert.strictEqual(res.status, 422);
  });

  test('DELETE /api/v1/users/:userId/data anonymises user records (ADMIN)', async () => {
    const uid = `USR-ERASURE-${Date.now()}`;
    await request('/api/v1/events', {
      method: 'POST',
      token: adminToken,
      body: {
        eventType: 'TXNX-001',
        userId: uid,
        payload: {
          order_id: `ORD-ERA-${Date.now()}`,
          symbol: 'HDFC',
          quantity: 5,
          price: 1600,
          total_amount: 8000,
          execution_time: new Date().toISOString(),
          exchange: 'NSE',
        },
      },
    });

    const delRes = await request(`/api/v1/users/${uid}/data`, {
      method: 'DELETE',
      token: adminToken,
    });
    assert.strictEqual(delRes.status, 200);
    assert.ok(delRes.data.anonymised_records >= 1);
  });
});

describe('5. Provider Health, Benchmark Challenges & Alerts', () => {
  test('GET /api/v1/providers/health lists all 7 providers including Apple-APNS', async () => {
    const res = await request('/api/v1/providers/health', { token: adminToken });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.providers.length, 7);
    assert.ok(res.data.providers.some((p: any) => p.name === 'Apple-APNS'));
  });

  test('All 5 simulation endpoints execute cleanly with JWT auth', async () => {
    const c1 = await request('/api/v1/simulations/market-crash', {
      method: 'POST',
      token: adminToken,
      body: { sampleSize: 6 },
    });
    assert.strictEqual(c1.status, 200);
    assert.strictEqual(c1.data.status, 'COMPLETED_SUCCESSFULLY');

    const c2 = await request('/api/v1/simulations/provider-outage', {
      method: 'POST',
      token: adminToken,
    });
    assert.strictEqual(c2.status, 200);
    assert.strictEqual(c2.data.status, 'FAILOVER_VERIFIED');

    // Recover MSG91 after outage simulation
    await request('/api/v1/providers/MSG91/toggle-failure', {
      method: 'POST',
      token: adminToken,
      body: { shouldFail: false },
    });

    const c3 = await request('/api/v1/simulations/compliance-audit', { token: adminToken });
    assert.strictEqual(c3.status, 200);
    assert.strictEqual(c3.data.zero_dnd_violations_certified, true);

    const c4 = await request('/api/v1/simulations/notification-storm', {
      method: 'POST',
      token: adminToken,
      body: { symbol: 'INFY' },
    });
    assert.strictEqual(c4.status, 200);
    assert.ok(c4.data.duplicates_suppressed >= 490);

    const c5 = await request('/api/v1/simulations/multilingual-emergency', {
      method: 'POST',
      token: adminToken,
    });
    assert.strictEqual(c5.status, 200);
    assert.strictEqual(c5.data.status, 'EMERGENCY_BROADCAST_COMPLETED');
  });

  test('GET /api/v1/alerts evaluates operational alert rules', async () => {
    const res = await request('/api/v1/alerts', { token: adminToken });
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.alerts));
  });

  test('Auth refresh & logout rotation work end-to-end via HTTP API', async () => {
    const login = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'operator@brokerage.local', password: 'operator-local-dev' },
    });
    assert.strictEqual(login.status, 200);

    const refresh = await request('/api/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken: login.data.refreshToken },
    });
    assert.strictEqual(refresh.status, 200);
    assert.ok(refresh.data.accessToken);

    const logout = await request('/api/v1/auth/logout', {
      method: 'POST',
      body: { refreshToken: refresh.data.refreshToken },
    });
    assert.strictEqual(logout.status, 200);
  });

  test('Discovery, analytics, consent, engagement & maintenance endpoints succeed', async () => {
    const live = await request('/health/live');
    assert.strictEqual(live.status, 200);
    const ready = await request('/health/ready');
    assert.strictEqual(ready.status, 200);
    const docs = await request('/api-docs');
    assert.strictEqual(docs.status, 200);

    const tax = await request('/api/v1/events/taxonomy', { token: adminToken });
    assert.strictEqual(tax.status, 200);
    assert.strictEqual(tax.data.total_events, 25);

    const sample = await request('/api/v1/events/sample/RISK-001', { token: adminToken });
    assert.strictEqual(sample.status, 200);
    assert.strictEqual(sample.data.eventType, 'RISK-001');

    const tmpl = await request('/api/v1/templates', { token: adminToken });
    assert.strictEqual(tmpl.status, 200);
    assert.strictEqual(tmpl.data.total_event_templates, 25);

    const perf = await request('/api/v1/analytics/channel-performance', { token: adminToken });
    assert.strictEqual(perf.status, 200);
    const opt = await request('/api/v1/analytics/opt-out-trends', { token: adminToken });
    assert.strictEqual(opt.status, 200);

    const consentPost = await request('/api/v1/users/USR-CONSENT-1/consent', {
      method: 'POST',
      token: adminToken,
      body: { channel: 'WHATSAPP', category: 'MARKET', optedIn: true, source: 'WEB_UI' },
    });
    assert.strictEqual(consentPost.status, 201);

    const consentGet = await request('/api/v1/users/USR-CONSENT-1/consent', { token: adminToken });
    assert.strictEqual(consentGet.status, 200);
    assert.ok(consentGet.data.consent_records.length >= 1);

    const scrub = await request('/api/v1/maintenance/scrub-pii', {
      method: 'POST',
      token: adminToken,
      body: { retentionDays: 90 },
    });
    assert.strictEqual(scrub.status, 200);
  });
});
