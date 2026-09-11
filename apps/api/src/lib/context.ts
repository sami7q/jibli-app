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
