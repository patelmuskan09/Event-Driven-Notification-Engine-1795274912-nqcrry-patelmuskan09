import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { config } from './src/config/env';
import { apiRouter } from './src/api/routes/api-router';
import { AnalyticsService } from './src/analytics/analytics-service';
import { ProviderManager } from './src/delivery/providers/provider-manager';
import { DatabaseClient } from './src/database/db-client';
import { RedisClient } from './src/infrastructure/redis-client';
import { KafkaClient } from './src/infrastructure/kafka-client';
import { RabbitMqClient } from './src/infrastructure/rabbitmq-client';
import { RetryEngine } from './src/delivery/retry/retry-engine';
import { logger } from './src/utils/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const providerManager = ProviderManager.getInstance();
const dbClient = DatabaseClient.getInstance();
const redisClient = RedisClient.getInstance();
const kafkaClient = KafkaClient.getInstance();
const rabbitClient = RabbitMqClient.getInstance();

// Security & Parsing Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(
  express.json({
    limit: '10mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);
app.use(express.urlencoded({ extended: true }));

// Wire Socket.io to InApp Delivery Provider
providerManager.inAppProvider.setSocketBroadcaster((userId, notification) => {
  io.emit(`notification:${userId}`, notification);
  io.emit('notification:all', notification);
});

io.on('connection', (socket) => {
  socket.on('subscribe', (userId) => {
    socket.join(`user:${userId}`);
  });
});

// Structured Request Logging Middleware with UUID v4 Correlation ID
app.use((req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();
  req.headers['x-correlation-id'] = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);

  const startedAt = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api/') || req.path === '/health') {
      logger.info(`${req.method} ${req.path} ${res.statusCode}`, {
        service: 'HttpServer',
        correlationId,
        durationMs: Date.now() - startedAt,
      });
    }
  });
  next();
});

// Mount /api/v1
app.use('/api/v1', apiRouter);

// Honest Health & Probe Endpoints (Section 17)
app.get('/health', (_req: Request, res: Response) => {
  const dbStatus = dbClient.getStatus();
  const redisStatus = redisClient.getStatus();
  const kafkaStatus = kafkaClient.getStatus();
  const rabbitStatus = rabbitClient.getStatus();

  const allBackingConnected =
    dbClient.isConnected() &&
    redisClient.isConnected() &&
    kafkaClient.isConnected() &&
    rabbitClient.isConnected();

  return res.json({
    status: allBackingConnected ? 'healthy' : 'degraded_fallback_active',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.round(process.uptime()),
    environment: config.nodeEnv,
    provider_mode: config.enableRealProviders ? 'LIVE_APIS_ENABLED' : 'SANDBOX_SAFE_MODE',
    components: {
      api: 'UP',
      event_engine: 'UP',
      postgres_db: dbStatus.state,
      redis_cluster: redisStatus.state,
      kafka_cluster: kafkaStatus.state,
      rabbitmq_cluster: rabbitStatus.state,
    },
    component_modes: {
      postgres: dbStatus.mode,
      redis: redisStatus.mode,
      kafka: kafkaStatus.mode,
      rabbitmq: rabbitStatus.mode,
    },
    circuit_breakers: providerManager.getCircuitBreakerStatuses(),
    alerts_count: AnalyticsService.getInstance().getActiveAlerts().length,
  });
});

app.get('/health/live', (_req: Request, res: Response) => {
  return res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
});

app.get('/health/ready', (_req: Request, res: Response) => {
  return res.status(200).json({
    status: 'ready',
    postgres: dbClient.getStatus().state,
    redis: redisClient.getStatus().state,
    kafka: kafkaClient.getStatus().state,
    rabbitmq: rabbitClient.getStatus().state,
  });
});

// Prometheus Metrics Endpoint (Section 15 & 17)
app.get('/metrics', (_req: Request, res: Response) => {
  const metrics = AnalyticsService.getInstance().getPrometheusMetrics();
  res.setHeader('Content-Type', 'text/plain; version=0.0.4');
  return res.send(metrics);
});

// Swagger UI (/api-docs)
app.get('/api-docs', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html');
  return res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Notification Engine OpenAPI Specification</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <style>
    body { margin: 0; background: #faf9f6; font-family: 'Plus Jakarta Sans', sans-serif; color: #22211e; }
    .swagger-ui .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api/v1/swagger.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: "BaseLayout"
    });
  </script>
</body>
</html>`);
});

// Complete OpenAPI 3.0 JSON Specification
export function buildOpenApiSpec() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Event-Driven Financial Notification Engine API (BE-6B)',
      version: '1.0.0',
      description:
        'Enterprise financial notification infrastructure with 25 event types, multi-channel routing, TRAI DND dispatch checks, atomic Redis frequency capping, and JWT RBAC.',
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      '/api/v1/auth/login': {
        post: {
          tags: ['Authentication'],
          security: [],
          summary: 'Issue short-lived JWT access token (<=1h) and refresh token',
        },
      },
      '/api/v1/auth/refresh': {
        post: {
          tags: ['Authentication'],
          security: [],
          summary: 'Rotate single-use refresh token and obtain fresh token pair',
        },
      },
      '/api/v1/auth/logout': {
        post: {
          tags: ['Authentication'],
          security: [],
          summary: 'Revoke active refresh token session',
        },
      },
      '/api/v1/events': {
        post: {
          tags: ['Ingestion'],
          summary: 'Ingest and validate financial event (25 strict event schemas)',
          responses: {
            '202': { description: 'Accepted for asynchronous processing' },
            '401': { description: 'Unauthorized' },
            '422': { description: 'Schema validation error' },
          },
        },
      },
      '/api/v1/events/taxonomy': {
        get: { tags: ['Ingestion'], summary: 'Retrieve catalog of all 25 financial event definitions' },
      },
      '/api/v1/events/sample/{eventType}': {
        get: { tags: ['Ingestion'], summary: 'Retrieve schema-valid sample payload for eventType' },
      },
      '/api/v1/users/{userId}/preferences': {
        get: { tags: ['Preferences'], summary: 'Get 4-level resolved user notification preferences' },
        put: { tags: ['Preferences'], summary: 'Update user preferences (rate limited 10 req/min)' },
      },
      '/api/v1/users/{userId}/consent': {
        get: { tags: ['Compliance'], summary: 'List immutable consent records for user' },
        post: { tags: ['Compliance'], summary: 'Record SMS/WhatsApp/Email opt-in or opt-out decision' },
      },
      '/api/v1/users/{userId}/data': {
        delete: {
          tags: ['Compliance'],
          summary: 'Right-to-Erasure: Anonymise user PII across stores (ADMIN)',
        },
      },
      '/api/v1/notifications': {
        get: { tags: ['Tracking'], summary: 'List paginated notification records' },
      },
      '/api/v1/notifications/{notificationId}': {
        get: { tags: ['Tracking'], summary: 'Get full state machine history and compliance audit trail' },
      },
      '/api/v1/notifications/{notificationId}/read': {
        post: { tags: ['Tracking'], summary: 'Record notification READ engagement event' },
      },
      '/api/v1/notifications/{notificationId}/click': {
        post: { tags: ['Tracking'], summary: 'Record notification CLICKED engagement event' },
      },
      '/api/v1/webhooks/{provider}': {
        post: {
          tags: ['Webhooks'],
          security: [],
          summary: 'HMAC-SHA256 verified provider delivery receipt webhook (DELIVERED/READ/BOUNCED/CLICKED)',
        },
      },
      '/api/v1/analytics/delivery-rates': {
        get: {
          tags: ['Analytics'],
          summary: 'Delivery rates, critical P50/P95/P99 latency, open & CTR metrics',
        },
      },
      '/api/v1/analytics/channel-performance': {
        get: { tags: ['Analytics'], summary: 'Per-channel, per-provider, per-language, and event breakdown' },
      },
      '/api/v1/analytics/opt-out-trends': {
        get: {
          tags: ['Analytics'],
          summary: 'DND blocks, opt-out trends, cap hits, quiet queues & INR cost',
        },
      },
      '/api/v1/alerts': {
        get: { tags: ['Operations'], summary: 'Evaluate live Section 17 operational alerts' },
      },
      '/api/v1/templates': {
        get: { tags: ['Templates'], summary: 'List registered multi-lingual template coverage' },
      },
      '/api/v1/dlq': {
        get: { tags: ['Operations'], summary: 'List Dead Letter Queue entries' },
      },
      '/api/v1/dlq/{dlqId}/retry': {
        post: { tags: ['Operations'], summary: 'Initiate manual retry for DLQ entry (ADMIN/OPERATOR)' },
      },
      '/api/v1/dlq/{dlqId}/discard': {
        post: { tags: ['Operations'], summary: 'Discard permanent failure from DLQ (ADMIN/OPERATOR)' },
      },
      '/api/v1/providers/health': {
        get: {
          tags: ['Operations'],
          summary: 'Provider statuses, SANDBOX/LIVE modes & circuit breaker states',
        },
      },
      '/api/v1/providers/{provider}/toggle-failure': {
        post: { tags: ['Operations'], summary: 'Toggle simulated failure on provider for failover testing' },
      },
      '/api/v1/maintenance/scrub-pii': {
        post: { tags: ['Compliance'], summary: 'Scrub personalisation payloads older than 90 days (ADMIN)' },
      },
      '/api/v1/simulations/market-crash': {
        post: { tags: ['Simulations'], summary: 'Run Challenge 1: Market Crash Simulation' },
      },
      '/api/v1/simulations/provider-outage': {
        post: { tags: ['Simulations'], summary: 'Run Challenge 2: Provider Outage & Failover' },
      },
      '/api/v1/simulations/compliance-audit': {
        get: { tags: ['Simulations'], summary: 'Run Challenge 3: 90-Day Compliance Audit Export' },
      },
      '/api/v1/simulations/notification-storm': {
        post: { tags: ['Simulations'], summary: 'Run Challenge 4: 500 Duplicate Notification Storm' },
      },
      '/api/v1/simulations/multilingual-emergency': {
        post: { tags: ['Simulations'], summary: 'Run Challenge 5: Multilingual Emergency Broadcast' },
      },
      '/health': {
        get: {
          tags: ['Health'],
          security: [],
          summary: 'Detailed component connectivity & mode health check',
        },
      },
      '/metrics': {
        get: { tags: ['Health'], security: [], summary: 'Prometheus text exposition metrics' },
      },
    },
  };
}

app.get('/api/v1/swagger.json', (_req: Request, res: Response) => {
  return res.json(buildOpenApiSpec());
});

// Global error handler (handles malformed JSON bodies without leaking internals)
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  const status = err.status || err.statusCode || 500;
  logger.error('Unhandled request error', {
    service: 'HttpServer',
    correlationId: req.headers['x-correlation-id'] as string,
    error: err.message,
  });
  res.status(status).json({
    error: status === 400 ? 'Bad Request' : 'Internal Server Error',
    message: status === 400 ? 'Malformed request payload.' : 'An unexpected error occurred.',
    requestId: req.headers['x-correlation-id'],
  });
});

async function bootstrapInfrastructure(): Promise<void> {
  const pgConnected = await dbClient.connect();
  if (pgConnected) {
    await dbClient.runMigrations();
    await dbClient.seedUsersIfEmpty();
  }

  await redisClient.connect();
  await kafkaClient.connect(async (topic, _payload, correlationId) => {
    logger.debug('Kafka consumer acknowledged event frame', {
      service: 'KafkaConsumer',
      topic,
      correlationId,
    });
  });
  await rabbitClient.connect();
}

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}; shutting down Notification Engine gracefully...`, {
    service: 'HttpServer',
  });
  RetryEngine.getInstance().stopRetryWorker();
  await Promise.allSettled([
    kafkaClient.disconnect(),
    rabbitClient.disconnect(),
    redisClient.disconnect(),
    dbClient.disconnect(),
  ]);
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

async function startServer() {
  await bootstrapInfrastructure();

  if (config.nodeEnv !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = fsPathToDist();
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(config.port, () => {
    logger.info(`Notification Engine backend listening on http://0.0.0.0:${config.port}`, {
      service: 'HttpServer',
      environment: config.nodeEnv,
    });
  });
}

function fsPathToDist(): string {
  // Works both when run via tsx in repo root or bundled into dist-server/server.mjs
  return path.resolve(process.cwd(), 'dist');
}

const isDirectExecution =
  process.argv[1] && (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.mjs'));

if (isDirectExecution && config.nodeEnv !== 'test') {
  startServer().catch((err) => {
    logger.error('Failed to start server', { service: 'HttpServer', error: err.message });
    process.exit(1);
  });
}
