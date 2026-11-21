-- =========================================================================
-- PostgreSQL 15+ Migration 002: Additional Tables, Default Partition, Auth & Audit
-- =========================================================================

-- Add 2027 monthly partitions + default safety partition for notifications
CREATE TABLE IF NOT EXISTS notifications_2027_01 PARTITION OF notifications
    FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2027-02-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS notifications_default PARTITION OF notifications DEFAULT;

-- 8. User Devices Table (OS-aware push token routing: FCM vs APNS)
CREATE TABLE IF NOT EXISTS user_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_token TEXT NOT NULL,
    platform VARCHAR(16) NOT NULL CHECK (platform IN ('ANDROID', 'IOS', 'WEB')),
    provider VARCHAR(16) NOT NULL CHECK (provider IN ('FCM', 'APNS')),
    is_active BOOLEAN DEFAULT TRUE,
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_devices_user ON user_devices(user_id, is_active);

-- 9. Refresh Tokens Table (JWT Refresh-Token Rotation & Revocation)
CREATE TABLE IF NOT EXISTS refresh_tokens (
    token_id VARCHAR(128) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    role VARCHAR(32) NOT NULL,
    token_hash VARCHAR(128) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked BOOLEAN DEFAULT FALSE,
    replaced_by VARCHAR(128),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id, revoked);

-- 10. Event Deduplication Log Table
CREATE TABLE IF NOT EXISTS event_deduplication (
    idempotency_key VARCHAR(255) PRIMARY KEY,
    event_type VARCHAR(32) NOT NULL,
    source_entity_id VARCHAR(128) NOT NULL,
    duplicate_count INT DEFAULT 1,
    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dedup_expires ON event_deduplication(expires_at);

-- 11. Provider Callbacks & Webhook Receipts Table
CREATE TABLE IF NOT EXISTS provider_callbacks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id VARCHAR(64) NOT NULL,
    provider VARCHAR(64) NOT NULL,
    external_id VARCHAR(255),
    event_status VARCHAR(32) NOT NULL,
    raw_payload JSONB NOT NULL,
    signature_verified BOOLEAN DEFAULT FALSE,
    received_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_callbacks_notif ON provider_callbacks(notification_id, received_at);

-- 12. Frequency Cap & Compliance Audit Decisions Table
CREATE TABLE IF NOT EXISTS compliance_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(32) NOT NULL,
    channel VARCHAR(16) NOT NULL,
    dnd_status VARCHAR(32),
    dnd_checked_at TIMESTAMPTZ,
    cap_status VARCHAR(32),
    cap_reason TEXT,
    quiet_hours_action VARCHAR(32),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_audit_user ON compliance_audit_log(user_id, created_at);

-- 13. Analytics Daily Rollup Snapshots Table
CREATE TABLE IF NOT EXISTS analytics_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    window_start TIMESTAMPTZ NOT NULL,
    window_type VARCHAR(16) NOT NULL CHECK (window_type IN ('HOURLY', 'DAILY', 'WEEKLY')),
    channel VARCHAR(16) NOT NULL,
    total_sent INT DEFAULT 0,
    total_delivered INT DEFAULT 0,
    total_read INT DEFAULT 0,
    total_failed INT DEFAULT 0,
    total_cost_inr NUMERIC(12,4) DEFAULT 0,
    p99_latency_ms NUMERIC(10,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
