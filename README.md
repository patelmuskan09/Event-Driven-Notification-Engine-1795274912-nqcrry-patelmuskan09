# Event-Driven Financial Notification Engine (Project BE-6B)

> Production-grade, high-throughput financial notification engine built with Node.js, TypeScript, Express, PostgreSQL 15+, Redis 7+, Apache Kafka, and RabbitMQ 3.12+ — featuring 25 financial event types, 5 delivery channels, dispatch-time TRAI DND enforcement, atomic Redis sliding-window frequency capping, circuit-breaking failovers, and real-time operations observability.

---

## Core Capabilities

- **25 Financial Event Types**: Full strict Zod taxonomy across Transactions (`TXNX-001..005`), Risk & Margin (`RISK-001..005`), SIPs (`SIPX-001..005`), Market Alerts (`MKTX-001..005`), and Regulatory Directives (`REGX-001..005`).
- **5 Delivery Channels & 7 Provider Adapters**:
  - **SMS**: Primary `MSG91` with automated circuit-breaker failover to `Twilio` (and optional `WhatsApp` fallback for non-critical traffic). Live REST calls gated behind `ENABLE_REAL_PROVIDERS=true`.
  - **Email**: `Nodemailer` (`Ethereal-SMTP` / live SMTP transport).
  - **Push**: OS-aware Push routing — iOS (`apns_token_*`) via `Apple-APNS` -> `Firebase-FCM`; Android (`fcm_token_*`) via `Firebase-FCM` only (never failed over to APNS).
  - **WhatsApp**: `Meta WhatsApp Cloud API` adapter (with separate OTT opt-in checks).
  - **In-App**: Live `Socket.io` WebSocket broadcaster.
- **Security & Compliance**:
  - JWT Bearer authentication (`<= 1 hour` short-lived access tokens) + single-use SHA-256 hashed refresh token rotation + RBAC (`ADMIN`, `OPERATOR`, `SERVICE`).
  - AES-256-GCM encryption at rest for user PII (`phone`, `email`, `recipient_address`).
  - Timing-safe HMAC-SHA256 webhook signature verification (`X-Webhook-Signature`).
  - Dispatch-time TRAI DND scrub (`TCCCPR` UCC 2018 transactional/regulatory exemptions), atomic Redis Lua frequency capping, Right-to-Erasure (`DELETE /api/v1/users/:userId/data`), and 90-day personalisation retention scrubbing.

---

## Technology Stack

| Component | Technology | Role |
|---|---|---|
| Runtime & Language | Node.js 22 LTS + TypeScript (Strict) | Core backend & Vite React Operations UI |
| API & Security | Express, Helmet, Zod, JWT, Pino | Ingestion API, RBAC, sliding-window rate limiting, structured JSON logs |
| Database | PostgreSQL 15+ (`pg` pool) | Monthly partitioned `notifications` (`PRIMARY KEY (id, created_at)`), BRIN/GIN indexes, audit logs |
| Cache & State | Redis 7+ (`ioredis` + Lua) | Idempotency (`SET NX EX`), atomic frequency caps, DND cache, ZSET retries & quiet queues |
| Event Streaming | Apache Kafka KRaft (`kafkajs`) | Idempotent producer, `notification-critical` (32p), `notification-events` (16p), `notification-dlq` |
| Priority Routing | RabbitMQ 3.12+ (`amqplib`) | `notifications.direct` & `notifications.dlx` priority queues |
| Templates | Handlebars (precompiled) | 5 languages (`en`, `hi`, `mr`, `ta`, `te`), A/B variants, HTML escaping, 160-char SMS truncation |

---

## Installation & Environment Configuration

1. **Clone & Install Dependencies**:
```bash
npm install
```

2. **Create Environment File**:
```bash
cp .env.example .env
```
Configure all required secrets before production deployment (`APP_SECRET`, `REFRESH_TOKEN_SECRET`, `PII_ENCRYPTION_KEY`, `WEBHOOK_HMAC_SECRET`, `AUTH_ADMIN_PASSWORD`, `AUTH_OPERATOR_PASSWORD`, `AUTH_SERVICE_KEY`, `DATABASE_URL`, `REDIS_URL`, `KAFKA_BROKERS`, `RABBITMQ_URL`). Never commit `.env` to Git (`.gitignore` excludes `.env*` except `.env.example`).

3. **Adapter Modes (Live Infrastructure vs. Local Fallback)**:
   - When PostgreSQL, Redis, Kafka, or RabbitMQ are reachable via their configured URLs/brokers (`ENABLE_POSTGRES=true`, `ENABLE_REDIS=true`, `ENABLE_KAFKA=true`, `ENABLE_RABBITMQ=true`), the server connects live, runs PostgreSQL migrations, and seeds 1,000 encrypted user profiles automatically.
   - If any external broker/database is offline in a local sandbox, its infrastructure client cleanly enters `IN_MEMORY_FALLBACK` mode and reports that exact state honestly in `GET /health`.
   - External SMS/Push/WhatsApp/SMTP HTTP calls remain in `SANDBOX` mode unless `ENABLE_REAL_PROVIDERS=true` and non-placeholder credentials are supplied.

---

## Startup & Database Commands

### Option A: Full Stack via Docker Compose (Recommended Production Topology)
Starts PostgreSQL 15, Redis 7, Kafka KRaft, RabbitMQ 3.12, and the multi-stage Node container:
```bash
docker compose up --build -d
```

### Option B: Local Development Server
```bash
# Optional when local PostgreSQL is running:
npm run db:migrate
npm run db:seed

# Start backend + Vite UI on port 3000:
npm run dev
```

### Production Build & Start
```bash
npm run build   # Builds dist/ client and dist-server/server.mjs
npm start       # Runs node dist-server/server.mjs
```

- **Operations Cockpit UI**: `http://localhost:3000`
- **Swagger / OpenAPI 3.0 UI**: `http://localhost:3000/api-docs`
- **OpenAPI Spec JSON**: `http://localhost:3000/api/v1/swagger.json`
- **Health Check**: `http://localhost:3000/health` (`/health/live`, `/health/ready`)
- **Prometheus Metrics**: `http://localhost:3000/metrics`

---

## Testing & Verification Commands

```bash
# Strict TypeScript type-checking
npm run lint:strict

# Execute unit, security, resilience, compliance & HTTP E2E suites
npm test

# Execute test suite with c8 line/statement/branch coverage
npm run test:coverage

# Execute authenticated concurrent HTTP load benchmark against running server
npx tsx tests/load/node-bench.ts

# Run k6 load tests (normal, peak, and stress scenarios)
k6 run tests/load/k6-load-test.js
```

---

## Document Error Log

As required by Section 25 of the technical specification, the following **5 deliberate specification errors** were identified during architecture review and resolved in code and database migrations:

1. **Partitioning Primary Key Mismatch (Section 12)**
   - **Specification Error**: Mandated declarative monthly partitioning on `notifications` by `created_at` while defining a standalone `id UUID PRIMARY KEY`. PostgreSQL forbids unique/primary keys on partitioned tables that omit any partition key column.
   - **Engineering Resolution**: Updated the PostgreSQL schema (`001_initial_schema.sql` & `002_auth_dedup_analytics_tables.sql`) to declare `PRIMARY KEY (id, created_at)` and added explicit `notifications_2027_01` and `notifications_default` safety partitions.

2. **TRAI DND Window & OTT Scope Discrepancy (Sections 8 & 10)**
   - **Specification Error**: Specified promotional blackout as `21:00–08:00` and conflated TRAI DND registry rules with OTT messaging channels such as WhatsApp. Under TRAI TCCCPR regulations, commercial SMS quiet hours run `21:00–09:00` and DND applies strictly to telecom carriers—not IP OTT channels governed by explicit channel opt-in (e.g. Meta WhatsApp 24-hr opt-in).
   - **Engineering Resolution**: Decoupled `DndService.verifySmsDispatch()` (telecom carrier SMS) from `DndService.verifyOttConsent()` (`WHATSAPP`/`EMAIL` explicit consent), enforced in `NotificationRouter`.

3. **FCM ➔ APNS Failover Fallacy (Section 5)**
   - **Specification Error**: Prescribed global push failover from `FCM ➔ APNS`. Because FCM is cross-platform while Apple Push Notification Service (APNS) strictly serves iOS device tokens, failing an Android push token over to APNS causes 100% permanent delivery failure.
   - **Engineering Resolution**: Implemented OS-aware routing in `ProviderManager.dispatchPushOsAware()` + `ApnsPushProvider`: only `apns_token_*` iOS tokens route through APNS (`APNS -> FCM`), while Android (`fcm_token_*`) tokens strictly route via FCM and never fall back to APNS.

4. **Indiscriminate 15-Minute Same-Event Cooldown on Critical Margin Calls (Section 9)**
   - **Specification Error**: Applied a uniform 15-minute same-event cooldown across all events, which suppresses escalating `RISK-001` / `RISK-002` margin call warnings during rapid intraday selloffs and exposes retail traders to unnotified forced liquidation.
   - **Engineering Resolution**: Enforced `CRITICAL_BYPASS` in `FrequencyCapService` and `QuietHoursService` for `CRITICAL` priority and `REGULATORY_MANDATORY` classifications.

5. **Critical Retry Backoff vs. 10-Second SEBI SLA Conflict (Sections 13 & 24)**
   - **Specification Error**: Required 10 retries with exponential backoff up to 60 seconds on `CRITICAL` failures while simultaneously requiring P99 latency `< 10 seconds` for critical margin calls. Blocking on a 60s backoff loop on a degraded provider breaks the SLA.
   - **Engineering Resolution**: `ProviderManager.dispatchSmsWithFailover()` triggers immediate circuit-breaker failover from primary `MSG91` to `Twilio` within milliseconds when a primary gateway fails, reserving exponential backoff retries (`RetryEngine` + Redis ZSET) only when all active channel gateways fail transiently.

---

## Documentation Index

- [Architecture Design (ARCHITECTURE.md)](./ARCHITECTURE.md) & [Detailed System Diagrams (docs/architecture.md)](./docs/architecture.md)
- [Database Schema & EXPLAIN ANALYZE (docs/database-schema.md)](./docs/database-schema.md)
- [Performance Benchmarks (docs/performance-benchmarks.md)](./docs/performance-benchmarks.md)
- [15-Day Delivery Log (docs/daily-progress-log.md)](./docs/daily-progress-log.md)
- [OpenAPI 3.0 Spec (docs/api-spec.json)](./docs/api-spec.json) & [Postman Collection (docs/postman-collection.json)](./docs/postman-collection.json)
- [Event Taxonomy (docs/event-taxonomy.yaml)](./docs/event-taxonomy.yaml)
- [Deployment Checklist (DEPLOYMENT.md)](./DEPLOYMENT.md) & [Changelog (CHANGELOG.md)](./CHANGELOG.md)
