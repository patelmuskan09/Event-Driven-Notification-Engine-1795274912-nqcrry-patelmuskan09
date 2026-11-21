# System Architecture & Diagrams — Event-Driven Notification Engine (BE-6B)

## End-to-End Event Flow (Mermaid)

```mermaid
flowchart LR
    Producers["Trading Engine / RMS / SIP Engine / Compliance"] -->|POST /api/v1/events + JWT| API["Express Ingestion API + Zod Validator"]
    API -->|SET NX EX Dedup| Redis[("Redis 7+ Cache & Lua Windows")]
    API -->|Topic: notification-critical / events| Kafka[("Apache Kafka KRaft")]
    Kafka --> Engine["Notification Engine + 4-Level Preferences"]
    Engine -->|Quiet Hours ZSET| Redis
    Engine -->|Atomic Cap Check| Redis
    Engine -->|SMS Last-Mile Guard| DND["TRAI DND Registry Scrub"]
    Engine --> Rabbit["RabbitMQ Priority Queues (CRITICAL / HIGH / STANDARD)"]
    Rabbit --> Providers["Provider Manager & Circuit Breakers"]
    Providers -->|SMS Primary| MSG91["MSG91"]
    Providers -->|SMS Failover| Twilio["Twilio"]
    Providers -->|Push iOS/Android| Push["APNS (iOS) / FCM (Cross-Platform)"]
    Providers -->|Email / WA / InApp| Channels["Nodemailer / Meta WA / Socket.io"]
    Providers -->|Permanent / Max Retries| DLQ["Dead Letter Queue (Postgres + Kafka/RabbitMQ DLX)"]
```

## Notification State Machine Transitions

```mermaid
stateDiagram-v2
    [*] --> CREATED
    CREATED --> ENRICHED
    ENRICHED --> ROUTED
    ROUTED --> QUIET: Non-critical during Quiet Hours
    ROUTED --> CAPPED: Exceeded Redis frequency cap
    ROUTED --> DND: Blocked promotional SMS on NCPR
    ROUTED --> QUEUED: Passed all compliance checks
    QUEUED --> SENT: Provider gateway accepted
    SENT --> DELIVERED: Provider confirmation / webhook
    DELIVERED --> READ: Webhook READ / client receipt
    QUEUED --> RETRYING: Transient failure -> Redis ZSET backoff
    RETRYING --> SENT: Retry worker succeeded
    RETRYING --> FAILED: Retries exhausted
    QUEUED --> FAILED: Permanent failure (HTTP 4xx)
    FAILED --> DLQ: Operator review / replay
```

## Key Architectural Guarantees

- **Fallback Honesty**: PostgreSQL, Redis, Kafka, and RabbitMQ use real drivers (`pg`, `ioredis`, `kafkajs`, `amqplib`) when brokers are reachable and transparently degrade to synchronized in-memory adapters (`IN_MEMORY_FALLBACK` reported on `/health`) if external containers are offline.
- **No Unattended Live Carrier Spend**: Outbound REST calls to MSG91, Twilio, FCM, WhatsApp, and live SMTP are gated behind `ENABLE_REAL_PROVIDERS=true` and non-test credentials.
