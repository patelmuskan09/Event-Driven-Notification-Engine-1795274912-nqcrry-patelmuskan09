import http from 'node:http';

const BASE_URL = process.env.BENCH_BASE_URL || 'http://127.0.0.1:3000';

async function getAccessToken(): Promise<string> {
  const email = process.env.BENCH_AUTH_EMAIL || 'service@brokerage.local';
  const password = process.env.BENCH_AUTH_PASSWORD || 'service-local-dev';

  return new Promise((resolve, reject) => {
    const req = http.request(
      `${BASE_URL}/api/v1/auth/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw);
            if (!parsed.accessToken) return reject(new Error(`Login failed: ${raw}`));
            resolve(parsed.accessToken);
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(JSON.stringify({ email, password }));
    req.end();
  });
}

function postEvent(body: unknown, token: string): Promise<{ latency: number; status: number }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = http.request(
      `${BASE_URL}/api/v1/events`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        res.on('data', () => undefined);
        res.on('end', () => {
          resolve({ latency: Date.now() - start, status: res.statusCode || 0 });
        });
      }
    );
    req.on('error', () => resolve({ latency: -1, status: 0 }));
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function runBenchmark() {
  console.log(`=== RUNNING CONCURRENT BENCHMARK LOAD TEST (${BASE_URL}) ===`);
  const token = await getAccessToken();
  const CONCURRENT_REQUESTS = Number(process.env.BENCH_REQUESTS || 200);

  const startTime = Date.now();
  const promises: Promise<{ latency: number; status: number }>[] = [];

  for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
    const isCritical = i % 3 === 0;
    const body = {
      eventType: isCritical ? 'RISK-001' : 'TXNX-001',
      userId: `USR-PERF-${1000 + i}`,
      sourceSystem: isCritical ? 'RMS' : 'TRADING_ENGINE',
      idempotencyKey: `BENCH:${Date.now()}:${i}`,
      payload: isCritical
        ? {
            account_id: `ACC-PERF-${i}`,
            required_margin: 250000,
            available_margin: 180000,
            shortfall: 70000,
            deadline_time: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          }
        : {
            order_id: `ORD-PERF-${Date.now()}-${i}`,
            symbol: 'RELIANCE',
            quantity: 50,
            price: 2950.0,
            total_amount: 147500.0,
            execution_time: new Date().toISOString(),
            exchange: 'NSE',
          },
    };
    promises.push(postEvent(body, token));
  }

  const results = await Promise.all(promises);
  const totalDurationMs = Date.now() - startTime;
  const accepted = results.filter((r) => r.status === 202).map((r) => r.latency).sort((a, b) => a - b);
  const rateLimited = results.filter((r) => r.status === 429).length;
  const otherErrors = results.filter((r) => r.status !== 202 && r.status !== 429).length;

  const p50 = accepted.length > 0 ? accepted[Math.floor(accepted.length * 0.5)] : null;
  const p95 = accepted.length > 0 ? accepted[Math.floor(accepted.length * 0.95)] : null;
  const p99 = accepted.length > 0 ? accepted[Math.floor(accepted.length * 0.99)] : null;
  const throughput = (CONCURRENT_REQUESTS / Math.max(0.001, totalDurationMs / 1000)).toFixed(1);

  console.log(`[RESULTS] Processed: ${CONCURRENT_REQUESTS} requests (HTTP 202: ${accepted.length}, HTTP 429 rate-limited: ${rateLimited}, Other: ${otherErrors})`);
  console.log(`[RESULTS] Total Duration: ${totalDurationMs} ms`);
  console.log(`[RESULTS] Overall Throughput: ${throughput} req/sec`);
  console.log(`[RESULTS] Latency P50: ${p50 !== null ? `${p50} ms` : 'N/A (all rate-limited)'}`);
  console.log(`[RESULTS] Latency P95: ${p95 !== null ? `${p95} ms` : 'N/A (all rate-limited)'}`);
  console.log(`[RESULTS] Latency P99: ${p99 !== null ? `${p99} ms` : 'N/A'} (SEBI SLA target < 10,000 ms)`);
  console.log(`[RESULTS] Accepted Rate: ${((accepted.length / CONCURRENT_REQUESTS) * 100).toFixed(1)}%`);
}

runBenchmark().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
