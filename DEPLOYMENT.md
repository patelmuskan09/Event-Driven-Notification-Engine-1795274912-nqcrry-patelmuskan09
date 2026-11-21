# Production Deployment Checklist & Infrastructure Guide

## Pre-Deployment Verification

- [x] Multi-stage Docker image built and verified (<200MB Alpine target).
- [x] Non-root container user configured (`USER node`).
- [x] Strict TypeScript compilation passes with zero type errors.
- [x] PostgreSQL 15+ declarative monthly partitioning configured.
- [x] BRIN, GIN, and composite indexes applied to database schema.
- [x] Redis AUTH enabled with connection timeout and sentinel/cluster replication.
- [x] Apache Kafka KRaft cluster topics configured with idempotent producer setting (`enable.idempotence=true`).
- [x] RabbitMQ priority exchange and dead letter exchange (`notifications.delivery.dlq`) configured.
- [x] TRAI DND registry cache pre-loaded with local sync mechanism.
- [x] Circuit breaker failure thresholds tuned (5 failures within 60s, 60s cooldown).
- [x] Prometheus metrics scraper target added for `/metrics`.

## Environment Variable Secrets Checklist

Verify all keys are present in production secrets manager (AWS Secrets Manager / GCP Secret Manager / Vault):
- `DATABASE_URL` (SSL mode enabled)
- `REDIS_URL` & `REDIS_PASSWORD`
- `KAFKA_BROKERS`
- `RABBITMQ_URL`
- `APP_SECRET` & `REFRESH_TOKEN_SECRET` (Minimum 256-bit entropy)
- Provider credentials: `MSG91_AUTH_KEY`, `TWILIO_AUTH_TOKEN`, `FCM_SERVER_KEY`, `WHATSAPP_TOKEN`

## Rollout & Rollback Strategy

- Blue/Green or Canary Deployment: Route 5% traffic to new container cluster, monitor DLQ depth and circuit breaker states for 10 minutes, then graduate to 100%.
- Rollback Trigger: Automatic rollback if P99 critical latency exceeds 10,000 ms or failure rate exceeds 1%.
