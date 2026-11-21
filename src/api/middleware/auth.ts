import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config/env';
import { DatabaseClient } from '../../database/db-client';

export type UserRole = 'ADMIN' | 'OPERATOR' | 'SERVICE';

export interface AuthPayload {
  userId: string;
  email: string;
  role: UserRole;
  tokenType: 'access' | 'refresh';
  jti: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthPayload;
}

interface StoredRefreshToken {
  jti: string;
  userId: string;
  email: string;
  role: UserRole;
  tokenHash: string;
  expiresAt: number;
  revoked: boolean;
}

const refreshTokenStore = new Map<string, StoredRefreshToken>();

/**
 * Environment-configured accounts or development-only session accounts.
 * Production deployments must set AUTH_ADMIN_SECRET / AUTH_SERVICE_SECRET via environment variables.
 */
function getConfiguredAccounts(): Array<{
  userId: string;
  email: string;
  secret: string;
  role: UserRole;
}> {
  const adminSecret =
    process.env.AUTH_ADMIN_PASSWORD || (config.nodeEnv !== 'production' ? 'admin-local-dev' : '');
  const operatorSecret =
    process.env.AUTH_OPERATOR_PASSWORD || (config.nodeEnv !== 'production' ? 'operator-local-dev' : '');
  const serviceSecret =
    process.env.AUTH_SERVICE_KEY || (config.nodeEnv !== 'production' ? 'service-local-dev' : '');

  const list: Array<{ userId: string; email: string; secret: string; role: UserRole }> = [];
  if (adminSecret) {
    list.push({ userId: 'ADMIN-001', email: 'admin@brokerage.local', secret: adminSecret, role: 'ADMIN' });
  }
  if (operatorSecret) {
    list.push({
      userId: 'OP-001',
      email: 'operator@brokerage.local',
      secret: operatorSecret,
      role: 'OPERATOR',
    });
  }
  if (serviceSecret) {
    list.push({
      userId: 'SVC-TRADING-01',
      email: 'service@brokerage.local',
      secret: serviceSecret,
      role: 'SERVICE',
    });
  }
  return list;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function issueTokenPair(user: { userId: string; email: string; role: UserRole }) {
  const accessJti = crypto.randomUUID();
  const refreshJti = crypto.randomUUID();

  const accessToken = jwt.sign(
    {
      userId: user.userId,
      email: user.email,
      role: user.role,
      tokenType: 'access',
      jti: accessJti,
    },
    config.jwtSecret,
    { expiresIn: config.tokenExpirySeconds }
  );

  const refreshToken = jwt.sign(
    {
      userId: user.userId,
      email: user.email,
      role: user.role,
      tokenType: 'refresh',
      jti: refreshJti,
    },
    config.refreshSecret,
    { expiresIn: config.refreshExpirySeconds }
  );

  const record: StoredRefreshToken = {
    jti: refreshJti,
    userId: user.userId,
    email: user.email,
    role: user.role,
    tokenHash: hashToken(refreshToken),
    expiresAt: Date.now() + config.refreshExpirySeconds * 1000,
    revoked: false,
  };
  refreshTokenStore.set(refreshJti, record);

  const db = DatabaseClient.getInstance();
  if (db.isConnected()) {
    void db.query(
      `INSERT INTO refresh_tokens (token_id, user_id, role, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0))
       ON CONFLICT (token_id) DO NOTHING`,
      [refreshJti, user.userId, user.role, record.tokenHash, record.expiresAt]
    );
  }

  return {
    accessToken,
    refreshToken,
    expiresInSeconds: config.tokenExpirySeconds,
    role: user.role,
    userId: user.userId,
  };
}

export function authenticateCredentials(
  email: string,
  password: string
): { userId: string; email: string; role: UserRole } | null {
  const accounts = getConfiguredAccounts();
  const matched = accounts.find((a) => a.email === email && a.secret === password);
  if (!matched) return null;
  return { userId: matched.userId, email: matched.email, role: matched.role };
}

export function rotateRefreshToken(refreshToken: string) {
  let decoded: AuthPayload;
  try {
    decoded = jwt.verify(refreshToken, config.refreshSecret) as AuthPayload;
  } catch {
    return null;
  }

  if (decoded.tokenType !== 'refresh' || !decoded.jti) return null;
  const stored = refreshTokenStore.get(decoded.jti);
  if (!stored || stored.revoked || stored.tokenHash !== hashToken(refreshToken)) {
    return null;
  }

  // Revoke old token (single-use rotation)
  stored.revoked = true;
  const db = DatabaseClient.getInstance();
  if (db.isConnected()) {
    void db.query(`UPDATE refresh_tokens SET revoked = TRUE WHERE token_id = $1`, [decoded.jti]);
  }

  return issueTokenPair({
    userId: stored.userId,
    email: stored.email,
    role: stored.role,
  });
}

export function revokeRefreshToken(refreshToken: string): boolean {
  try {
    const decoded = jwt.verify(refreshToken, config.refreshSecret) as AuthPayload;
    const stored = refreshTokenStore.get(decoded.jti);
    if (stored) {
      stored.revoked = true;
      return true;
    }
  } catch {
    // Ignore invalid token on logout
  }
  return false;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or malformed Bearer JWT access token.',
      requestId: req.headers['x-correlation-id'],
    });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as AuthPayload;
    if (decoded.tokenType !== 'access') {
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid token type.' });
      return;
    }
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Expired or invalid JWT access token.',
      requestId: req.headers['x-correlation-id'],
    });
  }
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required.' });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: 'Forbidden',
        message: `Role '${req.user.role}' is not permitted for this operation. Required: ${allowedRoles.join(', ')}`,
        requestId: req.headers['x-correlation-id'],
      });
      return;
    }
    next();
  };
}
