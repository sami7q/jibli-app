import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';
import { parseCsv } from '@jibli/config';
import { pingDatabase } from '@jibli/db';
import { success } from '@jibli/contracts';
import type { AppContext } from './lib/context.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerAuth } from './plugins/auth.js';
import { registerPortalAuthRoutes } from './routes/portal-auth.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerMfaRoutes } from './routes/mfa.js';
import { registerGeographyRoutes } from './routes/geography.js';
import { registerProfileRoutes } from './routes/profile.js';
import { registerCatalogRoutes } from './routes/catalog.js';
import { registerFavoriteRoutes } from './routes/favorites.js';
import { registerAssetRoutes } from './routes/assets.js';
import { registerPublicApplicationRoutes } from './routes/applications.js';
import { registerOrderRoutes } from './routes/orders.js';
import { registerReviewRoutes } from './routes/reviews.js';
import { registerDriverRoutes } from './routes/driver.js';
import { registerRestaurantPortalRoutes } from './routes/restaurant/index.js';
import { registerAdminRoutes } from './routes/admin/index.js';
import { registerRealtimeGateway, type RealtimeGateway } from './realtime/gateway.js';

/**
 * HTTP server assembly (plan §66, §81, §82, §89, §90).
 */

export interface BuiltServer {
  readonly app: FastifyInstance;
  readonly realtime: RealtimeGateway;
}

export async function buildServer(ctx: AppContext): Promise<BuiltServer> {
  const app = Fastify({
    /*
     * `loggerInstance`, not `logger`.
     *
     * Fastify 5 split the option in two: `logger` takes pino *options* and
     * builds a logger from them, `loggerInstance` takes one already built.
     * Handing our configured pino instance to `logger` throws
     * FST_ERR_LOG_INVALID_LOGGER_CONFIG at boot — the server never listens.
     *
     * TypeScript does not catch the mistake: pino's `Logger` is structurally
     * assignable to `PinoLoggerOptions`, because every field of the options
     * type is optional. Only `server.test.ts` catches it, which is why that
     * file exists.
     *
     * And it must be the instance, not options: the redaction paths in
     * @jibli/logger are what keep tokens, OTPs, phone numbers and addresses
     * out of the request log. A logger Fastify built for itself would carry
     * none of them, and every request line would leak.
     *
     * The cast is not a shortcut. Fastify carries its logger as a generic
     * parameter, and inferring it from pino's concrete `Logger` makes every
     * `registerX(app, ctx)` below reject the instance: the plugin signatures
     * take `FastifyInstance<..., FastifyBaseLogger, ...>`, and the two are not
     * mutually assignable (pino's type requires `msgPrefix`; Fastify's does
     * not). Widening here pins the generic to the interface the rest of the
     * codebase speaks, which pino satisfies.
     */
    loggerInstance: ctx.logger as FastifyBaseLogger,
    // Only honour X-Forwarded-* where a trusted proxy actually terminates TLS;
    // otherwise a client could spoof its own IP past the rate limiter.
    trustProxy: ctx.env.TRUST_PROXY,
    bodyLimit: ctx.env.REQUEST_BODY_LIMIT_BYTES,
    // `disableRequestLogging` is not set: false is already the default, and
    // passing it at all raises FSTDEP023 — Fastify 6 removes the top-level
    // option in favour of `logController`.
    genReqId: () => randomUUID(),
  });

  app.decorate('ctx', ctx);

  /**
   * Request ID propagation (plan §89).
   *
   * One ID flows through logs, audit rows, outbox events and the error envelope,
   * so a customer complaint can be traced end to end.
   */
  app.addHook('onRequest', async (request, reply) => {
    const inbound = request.headers['x-request-id'];
    request.requestId =
      typeof inbound === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(inbound)
        ? inbound
        : String(request.id);
    void reply.header('x-request-id', request.requestId);
  });

  // ── Security headers (plan §82) ───────────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // The API serves JSON only; nothing should ever be framed or scripted.
        scriptSrc: ["'none'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    hsts: ctx.env.APP_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });

  // ── CORS (plan §81) ───────────────────────────────────────────────────────
  const allowedOrigins = parseCsv(ctx.env.CORS_ALLOWED_ORIGINS);
  await app.register(cors, {
    origin: (origin, callback) => {
      // Same-origin and native mobile requests send no Origin header.
      if (!origin) return callback(null, true);
      callback(null, allowedOrigins.includes(origin));
    },
    // Credentials plus a wildcard origin is prohibited; the allowlist above is
    // what makes `credentials: true` safe here.
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-Id',
      'X-App-Version',
      'X-Idempotency-Key',
      'X-Restaurant-Id',
    ],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });

  await app.register(cookie, {
    secret: ctx.env.JWT_ACCESS_SECRET,
    parseOptions: {
      httpOnly: true,
      secure: ctx.env.APP_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      ...(ctx.env.SESSION_COOKIE_DOMAIN ? { domain: ctx.env.SESSION_COOKIE_DOMAIN } : {}),
    },
  });

  await app.register(sensible);

  // Realtime transport. Frames are small by design (plan §138): an event
  // carries IDs and a version, and the client re-fetches what it needs.
  await app.register(websocket, {
    options: { maxPayload: 64 * 1024, clientTracking: false },
  });

  // ── Rate limiting (plan §78) ──────────────────────────────────────────────
  await app.register(rateLimit, {
    global: true,
    max: ctx.env.RATE_LIMIT_GLOBAL_PER_MINUTE,
    timeWindow: '1 minute',
    // Redis-backed so the limit holds across API instances, not per process.
    redis: ctx.redis,
    nameSpace: 'ratelimit:',
    keyGenerator: (request) => request.principal?.userId ?? request.ip,
    // A limiter that fails open is better than one that takes the API down with
    // Redis; abuse is still caught by the per-endpoint OTP counters.
    skipOnError: true,
  });

  /*
   * A holder, not a reassigned binding: the readiness route closes over this
   * before the gateway exists and reads it only when a probe actually arrives,
   * by which time it is filled in.
   */
  const realtimeRef: { current: RealtimeGateway | undefined } = { current: undefined };

  registerErrorHandler(app);
  registerAuth(app, ctx);

  // ── Health checks (plan §90) ──────────────────────────────────────────────

  /** Liveness: is the process alive? Never touches a dependency. */
  app.get('/health/live', async (_request, reply) => reply.send({ status: 'ok' }));

  /**
   * Readiness: can this instance serve traffic? Checks critical dependencies
   * with a cheap query — never an analytics query (plan §90).
   */
  app.get('/health/ready', async (_request, reply) => {
    const [dbOk, redisOk] = await Promise.all([
      pingDatabase(ctx.db),
      ctx.redis
        .ping()
        .then(() => true)
        .catch(() => false),
    ]);

    const ready = dbOk && redisOk;
    return reply.status(ready ? 200 : 503).send({
      status: ready ? 'ok' : 'degraded',
      checks: { database: dbOk, redis: redisOk },
      // Operational visibility, not a health signal: zero connections is
      // normal at 4am and must never fail the probe.
      realtime_connections: realtimeRef.current?.connectionCount() ?? 0,
    });
  });

  app.get('/api/v1', async (request, reply) =>
    reply.send(
      success(
        { name: 'Jibli API', version: 'v1', environment: ctx.env.APP_ENV },
        { request_id: request.requestId },
      ),
    ),
  );

  // ── Routes ────────────────────────────────────────────────────────────────
  registerAuthRoutes(app, ctx);
  registerPortalAuthRoutes(app, ctx);
  registerMfaRoutes(app, ctx);
  registerGeographyRoutes(app, ctx);
  registerProfileRoutes(app, ctx);
  registerCatalogRoutes(app, ctx);
  registerFavoriteRoutes(app, ctx);
  registerAssetRoutes(app, ctx);
  registerPublicApplicationRoutes(app, ctx);
  registerOrderRoutes(app, ctx);
  registerReviewRoutes(app, ctx);
  registerDriverRoutes(app, ctx);
  registerRestaurantPortalRoutes(app, ctx);
  registerAdminRoutes(app, ctx);

  const realtime = await registerRealtimeGateway(app, ctx);
  realtimeRef.current = realtime;

  return { app, realtime };
}
