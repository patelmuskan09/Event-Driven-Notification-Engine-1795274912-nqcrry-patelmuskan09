# Changelog — Event-Driven Notification Engine (BE-6B)

All notable changes and milestones across the 15-day internship deliverables:

## [1.0.0] - 2026-11-07

### Days 1–3: Core Architecture, Database & Event Ingestion
- Configured Node 20 LTS + Strict TypeScript 5.x project structure.
- Defined 25+ event financial taxonomy (`docs/event-taxonomy.yaml`).
- Configured PostgreSQL 15+ declarative monthly partitioning and composite BRIN/GIN indexes.
- Built EventFactory and Zod payload schema validators.
- Built Kafka idempotent streaming topology (`notification-events`, `notification-critical`, `notification-dlq`).
- Created 1,000 test user seed profile generator.

### Days 4–6: Multi-Lingual Templates, Preferences & TRAI Compliance
- Built database/file-backed Handlebars template engine supporting 5 languages (English, Hindi, Marathi, Tamil, Telugu).
- Implemented intelligent SMS 160-character truncation preserving essential links.
- Built 4-level user preference hierarchy (System, Segment, User, Regulatory overrides).
- Built pre-dispatch TRAI DND scrub with UCC 2018 statutory exemptions for margin calls.
- Implemented multi-dimensional atomic frequency capping in Redis sliding windows with `CRITICAL_BYPASS`.
- Implemented timezone-aware Quiet Hours queueing and morning digest aggregator.

### Days 7–9: Delivery Providers, Circuit Breakers & Dead Letter Queue
- Built unified `DeliveryProvider` interface for SMS, Email, Push, WhatsApp, and In-App WebSockets.
- Implemented MSG91 primary SMS with autonomous Twilio failover.
- Implemented 3-state autonomous Circuit Breaker (`CLOSED` ➔ `OPEN` ➔ `HALF_OPEN`).
- Implemented non-critical SMS rerouting to WhatsApp upon SMS carrier outage.
- Built exponential backoff with jitter retry engine and DLQ management APIs.

### Days 10–12: Real-Time Analytics, Logging & Observability
- Implemented real-time sliding-window analytics and Prometheus `/metrics` exposition.
- Added structured JSON logging with correlation ID propagation.
- Built `/health` endpoint with liveness and readiness probes.

### Days 13–15: Benchmarks, OpenAPI & Documentation
- Built Swagger UI at `/api-docs` and OpenAPI 3.0 specification.
- Built k6 load testing suite for normal, peak, and 450,000 market-crash loads.
- Implemented and verified all 5 simulation challenges.
- Formally identified and remediated all 5 deliberate technical specification errors in `ARCHITECTURE.md`.
- Built interactive Operations Cockpit frontend UI.
