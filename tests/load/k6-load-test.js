import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

// Custom Latency Trends
const criticalLatencyTrend = new Trend('critical_delivery_latency_ms');
const standardLatencyTrend = new Trend('standard_delivery_latency_ms');

export const options = {
  scenarios: {
    // 1. Normal Load (2 million/day ~ 25 req/s)
    normal_load: {
      executor: 'constant-vus',
      vus: 10,
      duration: '30s',
      startTime: '0s',
    },
    // 2. Peak Load (10x ~ 250 req/s)
    peak_load: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 10 },
      ],
      startTime: '35s',
    },
    // 3. Market Crash Scenario (20x spike ~ 450,000 in 30 mins)
    market_crash_spike: {
      executor: 'per-vu-iterations',
      vus: 100,
      iterations: 50,
      maxDuration: '2m',
      startTime: '2m40s',
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<100', 'p(99)<250'],
    'critical_delivery_latency_ms': ['p(99)<500'], // SEBI compliance < 10,000ms SLA
    'http_req_failed': ['rate<0.01'], // < 1% error rate
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000/api/v1';

export default function () {
  // Alternate between Critical Margin Calls (RISK-001) and Buy Orders (TXNX-001)
  const isCritical = Math.random() > 0.6;
  const eventType = isCritical ? 'RISK-001' : 'TXNX-001';
  const userId = `USR-${Math.floor(100000 + Math.random() * 900000)}`;

  const payload = JSON.stringify({
    eventType,
    userId,
    timestamp: new Date().toISOString(),
    sourceSystem: isCritical ? 'RMS' : 'TRADING_ENGINE',
    payload: isCritical
      ? {
          account_id: `ACC-${userId}`,
          required_margin: 250000,
          available_margin: 180000,
          shortfall: 70000,
          deadline_time: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
        }
      : {
          order_id: `ORD-${Date.now()}-${__VU}`,
          symbol: 'RELIANCE',
          quantity: 25,
          price: 2950.0,
          total_amount: 73750.0,
          execution_time: new Date().toISOString(),
          exchange: 'NSE',
        },
  });

  const headers = {
    'Content-Type': 'application/json',
    'X-Correlation-ID': `k6-run-${__VU}-${Date.now()}`,
  };

  const start = Date.now();
  const res = http.post(`${BASE_URL}/events`, payload, { headers });
  const latency = Date.now() - start;

  if (isCritical) {
    criticalLatencyTrend.add(latency);
  } else {
    standardLatencyTrend.add(latency);
  }

  check(res, {
    'status is 202': (r) => r.status === 202,
    'has notification_id': (r) => JSON.parse(r.body).notification_id !== undefined,
  });

  sleep(0.05); // High throughput pacing
}
