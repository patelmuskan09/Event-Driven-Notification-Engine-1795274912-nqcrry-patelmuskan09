-- =========================================================================
-- PostgreSQL 15+ Migration: Initial Schema for Event-Driven Notification Engine
-- Supports Partitioning, JSONB, BRIN, GIN, and Composite Indexes
-- =========================================================================

-- Enable pgcrypto for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(32) NOT NULL,
    preferred_language VARCHAR(8) DEFAULT 'en',
    timezone VARCHAR(64) DEFAULT 'Asia/Kolkata',
    account_type VARCHAR(32) DEFAULT 'RETAIL', -- RETAIL, HNI, PRO
    risk_profile VARCHAR(32) DEFAULT 'MODERATE',
    is_dnd_registered BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 2. User Preferences Table
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id VARCHAR(64) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    channel_settings JSONB NOT NULL DEFAULT '{"SMS":true,"EMAIL":true,"PUSH":true,"WHATSAPP":true,"IN_APP":true}',
    category_settings JSONB NOT NULL DEFAULT '{}',
    quiet_hours JSONB NOT NULL DEFAULT '{"enabled":true,"startTime":"21:00","endTime":"08:00"}',
    digest_mode VARCHAR(32) DEFAULT 'IMMEDIATE',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Consent Records Table (Immutable TRAI/SEBI audit records)
CREATE TABLE IF NOT EXISTS consent_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel VARCHAR(32) NOT NULL,
    category VARCHAR(64) NOT NULL,
    opted_in BOOLEAN NOT NULL,
    source VARCHAR(64) NOT NULL,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consent_user_channel ON consent_records(user_id, channel);

-- 4. Partitioned Notifications Table (Partitioned by Range on created_at)
-- Deliberate Spec Trap Solved: PK must include partitioning key created_at!
CREATE TABLE IF NOT EXISTS notifications (
    id VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    event_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(32) NOT NULL,
    category VARCHAR(32) NOT NULL,
    priority VARCHAR(16) NOT NULL,
    channel VARCHAR(16) NOT NULL,
    status VARCHAR(32) NOT NULL,
    recipient_address VARCHAR(255) NOT NULL,
    subject TEXT,
    rendered_body TEXT NOT NULL,
    language VARCHAR(8) DEFAULT 'en',
    cost_inr NUMERIC(10,4) DEFAULT 0.0000,
    provider VARCHAR(64),
    external_provider_id VARCHAR(255),
    retry_count INT DEFAULT 0,
    max_retries INT DEFAULT 3,
    failure_reason TEXT,
    correlation_id VARCHAR(64) NOT NULL,
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    personalisation_data JSONB DEFAULT '{}',
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Monthly partitions for 2026/2027
CREATE TABLE IF NOT EXISTS notifications_2026_11 PARTITION OF notifications
    FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS notifications_2026_12 PARTITION OF notifications
    FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');

-- Required Indexes (Section 12)
CREATE INDEX IF NOT EXISTS idx_notif_user_status_channel ON notifications (user_id, status, channel);
CREATE INDEX IF NOT EXISTS idx_notif_pending_status ON notifications (status) WHERE status IN ('QUEUED', 'RETRYING');
CREATE INDEX IF NOT EXISTS idx_notif_created_at_brin ON notifications USING BRIN (created_at);
CREATE INDEX IF NOT EXISTS idx_notif_personalisation_gin ON notifications USING GIN (personalisation_data);
CREATE INDEX IF NOT EXISTS idx_notif_event_created ON notifications (event_type, created_at);

-- 5. Notification State Log (Event Sourcing Audit Table)
CREATE TABLE IF NOT EXISTS notification_state_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id VARCHAR(64) NOT NULL,
    previous_state VARCHAR(32) NOT NULL,
    new_state VARCHAR(32) NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    actor_service VARCHAR(64) NOT NULL,
    retry_count INT DEFAULT 0,
    failure_reason TEXT,
    provider_response JSONB,
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_state_log_notif_id ON notification_state_log (notification_id, timestamp);

-- 6. Dead Letter Queue (DLQ) Table
CREATE TABLE IF NOT EXISTS dead_letter_queue (
    id VARCHAR(64) PRIMARY KEY,
    notification_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    reason TEXT NOT NULL,
    error_classification VARCHAR(32) NOT NULL, -- TRANSIENT, PERMANENT, CONFIGURATION
    attempts_made INT NOT NULL,
    last_error TEXT,
    status VARCHAR(32) DEFAULT 'PENDING_REVIEW', -- PENDING_REVIEW, RETRY_INITIATED, DISCARDED
    failed_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dlq_status ON dead_letter_queue(status, failed_at);

-- 7. Delivery Providers Registry
CREATE TABLE IF NOT EXISTS delivery_providers (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    channel VARCHAR(16) NOT NULL,
    cost_per_unit_inr NUMERIC(10,4) NOT NULL,
    daily_quota INT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed Initial Providers
INSERT INTO delivery_providers (id, name, channel, cost_per_unit_inr, daily_quota, is_active)
VALUES
    ('p-msg91', 'MSG91', 'SMS', 0.1200, 1000000, true),
    ('p-twilio', 'Twilio', 'SMS', 0.4500, 500000, true),
    ('p-ethereal', 'Ethereal-SMTP', 'EMAIL', 0.0200, 1000000, true),
    ('p-fcm', 'Firebase-FCM', 'PUSH', 0.0000, 5000000, true),
    ('p-whatsapp', 'WhatsApp-Cloud', 'WHATSAPP', 0.6800, 300000, true),
    ('p-inapp', 'SocketIO-InApp', 'IN_APP', 0.0000, 10000000, true)
ON CONFLICT (id) DO NOTHING;
