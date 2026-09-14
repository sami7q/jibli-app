import { createRequire } from 'node:module';
import type { FastifyRequest } from 'fastify';
import { Redis } from 'ioredis';
import type { ApiEnv } from '@jibli/config';
import type { Logger } from '@jibli/logger';
import type { Database } from '@jibli/db';
import type { Principal } from '@jibli/auth';
import type { PushProvider, SmsProvider } from '@jibli/notifications';

/**
 * Application context — the dependencies every route handler needs.
 *
 * Assembled once at boot and attached to the Fastify instance, so handlers
 * receive their collaborators rather than reaching for module-level singletons.
 * That is what makes the use cases testable without a live server.
 */
export interface AppContext {
  readonly env: ApiEnv;
  readonly db: Database;
  readonly redis: Redis;
  readonly logger: Logger;
  readonly sms: SmsProvider;
  readonly push: PushProvider;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    /** Present once the auth plugin has verified a bearer token. */
    principal?: Principal;
    /** Correlates logs, audit rows, outbox events and error responses (plan §89). */
    requestId: string;
  }
}

/** Client IP, honouring the proxy header only when the deployment trusts one. */
export function clientIp(request: FastifyRequest): string {
  return request.ip;
}

export function userAgent(request: FastifyRequest): string | null {
  const value = request.headers['user-agent'];
  return typeof value === 'string' ? value.slice(0, 512) : null;
}

export function createRedis(env: ApiEnv, logger: Logger): Redis {
  /*
   * `memory://` — an in-process Redis, for development only.
   *
   * Without it the API cannot start on a machine with no Docker, which is what
   * a developer on Windows usually has, and "run the API locally" becomes an
   * infrastructure project. The substitute implements the same client
   * interface, so nothing downstream knows the difference.
   *
   * What it is not: rate limiting or realtime. Counters live in one process
   * and vanish on restart, and a publish reaches only the instance that made
   * it. Both are correct for one developer on one machine and wrong for
   * anything else, which is why the env schema refuses this in production.
   */
  if (env.REDIS_URL.startsWith('memory:')) {
    logger.warn(
      { event: 'redis.in_memory' },
      'Using the in-process Redis substitute: rate limits and realtime are per-process and not durable',
    );
    /*
     * Loaded here rather than imported at the top, so the dependency is never
     * pulled into a production bundle — `createRequire` because this module is
     * ESM and a static import would defeat the point.
     */
    const load = createRequire(import.meta.url);
    const RedisMock = load('ioredis-mock') as new (options?: unknown) => Redis;
    return new RedisMock({ keyPrefix: `${env.REDIS_NAMESPACE}:` });
  }

  const redis = new Redis(env.REDIS_URL, {
    keyPrefix: `${env.REDIS_NAMESPACE}:`,
    maxRetriesPerRequest: 3,
    // Fail fast rather than queueing commands during an outage: a rate-limit
    // check that hangs is worse than one that errors and is handled.
    enableOfflineQueue: false,
    lazyConnect: true,
  });
  redis.on('error', (error: Error) => {
    logger.error({ event: 'redis.error', err: error.message }, 'Redis connection error');
  });
  return redis;
}
