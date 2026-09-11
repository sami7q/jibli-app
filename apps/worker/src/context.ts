import { Redis } from 'ioredis';
import type { WorkerEnv } from '@jibli/config';
import type { Database } from '@jibli/db';
import type { Logger } from '@jibli/logger';
import type { PushProvider } from '@jibli/notifications';

/** Dependencies shared by every worker job. */
export interface WorkerContext {
  readonly env: WorkerEnv;
  readonly db: Database;
  readonly redis: Redis;
  readonly logger: Logger;
  readonly push: PushProvider;
}

export function createWorkerRedis(env: WorkerEnv, logger: Logger): Redis {
  const redis = new Redis(env.REDIS_URL, {
    keyPrefix: `${env.REDIS_NAMESPACE}:`,
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
  redis.on('error', (error: Error) => {
    logger.error({ event: 'redis.error', err: error.message }, 'Worker Redis error');
  });
  return redis;
}
