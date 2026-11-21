import fs from 'fs';
import path from 'path';
import { Pool, QueryResult } from 'pg';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { encryptPii } from '../utils/crypto';
import { generate1000Users } from './seeds/seed_1000_users';

export type DbConnectionState = 'CONNECTED' | 'IN_MEMORY_FALLBACK' | 'DISCONNECTED';

export class DatabaseClient {
  private static instance: DatabaseClient;
  private pool: Pool | null = null;
  private state: DbConnectionState = 'DISCONNECTED';
  private lastError: string | null = null;

  private constructor() {}

  public static getInstance(): DatabaseClient {
    if (!DatabaseClient.instance) {
      DatabaseClient.instance = new DatabaseClient();
    }
    return DatabaseClient.instance;
  }

  public async connect(): Promise<boolean> {
    if (!config.database.enabled) {
      this.state = 'IN_MEMORY_FALLBACK';
      return false;
    }

    try {
      this.pool = new Pool({
        connectionString: config.database.url,
        max: config.database.poolMax,
        idleTimeoutMillis: config.database.idleTimeoutMs,
        connectionTimeoutMillis: 2500,
        ssl: config.database.ssl ? { rejectUnauthorized: false } : undefined,
      });

      this.pool.on('error', (err) => {
        this.lastError = err.message;
        logger.error('PostgreSQL pool error', { service: 'DatabaseClient', error: err.message });
      });

      await this.pool.query('SELECT 1');
      this.state = 'CONNECTED';
      this.lastError = null;
      logger.info('Connected to PostgreSQL 15+ pool', {
        service: 'DatabaseClient',
        poolMax: config.database.poolMax,
        ssl: config.database.ssl,
      });
      return true;
    } catch (err: any) {
      this.lastError = err.message;
      this.state = 'IN_MEMORY_FALLBACK';
      if (this.pool) {
        await this.pool.end().catch(() => undefined);
        this.pool = null;
      }
      logger.warn('PostgreSQL unavailable; operating with in-memory fallback adapter', {
        service: 'DatabaseClient',
        reason: err.message,
      });
      return false;
    }
  }

  public isConnected(): boolean {
    return this.state === 'CONNECTED' && this.pool !== null;
  }

  public getStatus(): { state: DbConnectionState; mode: string; lastError: string | null } {
    return {
      state: this.state,
      mode: this.isConnected() ? 'POSTGRESQL_LIVE' : 'IN_MEMORY_FALLBACK',
      lastError: this.lastError,
    };
  }

  public async query<T extends Record<string, any> = any>(
    sql: string,
    params: unknown[] = []
  ): Promise<QueryResult<T> | null> {
    if (!this.isConnected() || !this.pool) return null;
    try {
      return await this.pool.query<T>(sql, params);
    } catch (err: any) {
      this.lastError = err.message;
      logger.error('PostgreSQL query failure', {
        service: 'DatabaseClient',
        error: err.message,
      });
      return null;
    }
  }

  /**
   * Executes SQL migration files sequentially when connected to PostgreSQL.
   */
  public async runMigrations(): Promise<void> {
    if (!this.isConnected() || !this.pool) return;

    const migrationsDir = path.resolve(process.cwd(), 'src/database/migrations');
    if (!fs.existsSync(migrationsDir)) return;

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await this.pool.query(sql);
      logger.info(`Executed PostgreSQL migration: ${file}`, { service: 'DatabaseClient' });
    }
  }

  /**
   * Seeds 1,000 test users with AES-256-GCM encrypted PII columns into PostgreSQL.
   */
  public async seedUsersIfEmpty(): Promise<number> {
    if (!this.isConnected() || !this.pool) return 0;

    const countRes = await this.pool.query<{ count: string }>('SELECT COUNT(*) AS count FROM users');
    const existingCount = parseInt(countRes.rows[0]?.count || '0', 10);
    if (existingCount >= 1000) return existingCount;

    const users = generate1000Users();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const u of users) {
        await client.query(
          `INSERT INTO users (id, full_name, email, phone, preferred_language, timezone, account_type, risk_profile, is_dnd_registered)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO NOTHING`,
          [
            u.id,
            u.fullName,
            encryptPii(u.email),
            encryptPii(u.phone),
            u.preferredLanguage,
            u.timezone,
            u.accountType,
            u.riskProfile,
            u.isDndRegistered,
          ]
        );
        await client.query(
          `INSERT INTO user_preferences (user_id, quiet_hours)
           VALUES ($1, $2)
           ON CONFLICT (user_id) DO NOTHING`,
          [u.id, JSON.stringify(u.quietHours)]
        );
      }
      await client.query('COMMIT');
      logger.info(`Seeded ${users.length} users into PostgreSQL`, { service: 'DatabaseClient' });
      return users.length;
    } catch (err: any) {
      await client.query('ROLLBACK');
      logger.error('Failed seeding users', { service: 'DatabaseClient', error: err.message });
      return 0;
    } finally {
      client.release();
    }
  }

  /**
   * Runs EXPLAIN ANALYZE on the daily delivery-rate aggregation query (Section 12 & 25).
   */
  public async explainDailyDeliveryQuery(): Promise<string[] | null> {
    if (!this.isConnected() || !this.pool) return null;
    const res = await this.pool.query<{ 'QUERY PLAN': string }>(`
      EXPLAIN ANALYZE
      SELECT
        date_trunc('day', created_at) AS delivery_day,
        channel,
        COUNT(*) AS total_notifications,
        COUNT(*) FILTER (WHERE status IN ('DELIVERED', 'READ')) AS delivered_count
      FROM notifications
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY 1, 2
      ORDER BY 1 DESC, 2;
    `);
    return res.rows.map((r) => r['QUERY PLAN']);
  }

  public async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end().catch(() => undefined);
      this.pool = null;
      this.state = 'DISCONNECTED';
    }
  }
}
